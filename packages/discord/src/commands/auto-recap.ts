import { InteractionResponseType } from "discord-interactions";
import { createLogger, serializeError } from "@wcl/shared";
import { parseReportUrl } from "@wcl/wcl-client";
import type { ParsedReportUrl } from "@wcl/wcl-client";
import { randomUUID } from "node:crypto";
import type {
    AutoRecapDuplicateTrackingRecord,
    DiscordInteraction,
    HandleOptions,
    SavePreviewStateInput,
} from "../types.js";
import {
    buildRecapArtifact,
    getRecapFailureMessage,
} from "./recap.js";
import {
    createFollowupInteractionResponse,
    safeEditOriginalInteractionResponse,
} from "../infrastructure/discord-api.js";

const logger = createLogger("discord");
const EPHEMERAL_MESSAGE_FLAG = 64;
const DEFAULT_PREVIEW_STATE_TTL_SECONDS = 900;
const PROMPT_PREVIEW_PREFIX = "ar:p:";
const PROMPT_IGNORE_PREFIX = "ar:i:";
const DUPLICATE_PREFIX = "ar:d:";
const PROMPT_EXPIRED_MESSAGE =
    "This auto recap prompt has expired. Paste the Warcraft Logs URL again if you still want a recap.";
const AUTO_RECAP_UNAVAILABLE_MESSAGE =
    "Auto recap is temporarily unavailable. Please try again later.";
const SAFE_ALLOWED_MENTIONS = { parse: [] as string[] };
const DEFAULT_DUPLICATE_TTL_MS = 15 * 60 * 1000;

type AutoRecapComponent =
    | { action: "prompt_preview"; sourceMessageId: string }
    | { action: "prompt_ignore"; sourceMessageId: string }
    | { action: "duplicate_preview"; confirmationNonce: string }
    | { action: "duplicate_try"; confirmationNonce: string }
    | { action: "duplicate_post"; confirmationNonce: string }
    | { action: "duplicate_ignore"; confirmationNonce: string };

export interface AutoRecapInboundMessage {
    guildId?: string | null;
    channelId: string;
    messageId: string;
    authorId: string;
    authorBot?: boolean;
    content?: string | null;
}

export interface AutoRecapSendableChannel {
    send(body: Record<string, unknown>): Promise<{ id: string }>;
}

export interface AutoRecapFailureThrottle {
    shouldPostFailure(key: string, ttlMs: number): boolean;
}

export interface AutoRecapMessageCreateOptions {
    message: AutoRecapInboundMessage;
    channel: AutoRecapSendableChannel | null;
    handleOptions: HandleOptions;
    duplicateTtlMs?: number;
    failureTtlMs?: number;
    failureThrottle?: AutoRecapFailureThrottle;
}

export const makeAutoRecapPromptPreviewCustomId = (sourceMessageId: string): string =>
    `${PROMPT_PREVIEW_PREFIX}${sourceMessageId}`;

export const makeAutoRecapPromptIgnoreCustomId = (sourceMessageId: string): string =>
    `${PROMPT_IGNORE_PREFIX}${sourceMessageId}`;

export const makeAutoRecapDuplicateCustomId = (
    action: "p" | "t" | "o" | "i",
    confirmationNonce: string,
): string => `${DUPLICATE_PREFIX}${action}:${confirmationNonce}`;

export const parseAutoRecapComponentCustomId = (
    customId: string,
): AutoRecapComponent | undefined => {
    if (customId.startsWith(PROMPT_PREVIEW_PREFIX)) {
        const sourceMessageId = customId.slice(PROMPT_PREVIEW_PREFIX.length);
        return sourceMessageId ? { action: "prompt_preview", sourceMessageId } : undefined;
    }
    if (customId.startsWith(PROMPT_IGNORE_PREFIX)) {
        const sourceMessageId = customId.slice(PROMPT_IGNORE_PREFIX.length);
        return sourceMessageId ? { action: "prompt_ignore", sourceMessageId } : undefined;
    }
    if (customId.startsWith(DUPLICATE_PREFIX)) {
        const [, , action, confirmationNonce] = customId.split(":");
        if (!confirmationNonce) return undefined;
        if (action === "p") return { action: "duplicate_preview", confirmationNonce };
        if (action === "t") return { action: "duplicate_try", confirmationNonce };
        if (action === "o") return { action: "duplicate_post", confirmationNonce };
        if (action === "i") return { action: "duplicate_ignore", confirmationNonce };
    }
    return undefined;
};

const stripUrlCandidate = (candidate: string): string =>
    candidate
        .trim()
        .replace(/^<+/, "")
        .replace(/>+$/, "")
        .replace(/[)\].,!?;:]+$/u, "");

const isSupportedWarcraftLogsHost = (hostname: string): boolean => {
    const lowerHost = hostname.toLowerCase();
    return lowerHost === "www.warcraftlogs.com" || lowerHost === "classic.warcraftlogs.com";
};

export const extractFirstWarcraftLogsReportUrl = (
    content: string,
): ParsedReportUrl | null => {
    const candidates = content.match(/https?:\/\/[^\s<>\]]+/giu) ?? [];
    for (const rawCandidate of candidates) {
        const candidate = stripUrlCandidate(rawCandidate);
        let url: URL;
        try {
            url = new URL(candidate);
        } catch {
            continue;
        }
        if (!isSupportedWarcraftLogsHost(url.hostname)) continue;
        try {
            return parseReportUrl(candidate);
        } catch {
            continue;
        }
    }
    return null;
};

export const buildAutoRecapPromptBody = (sourceMessageId: string) => ({
    content: "Detected a Warcraft Logs report.\nGenerate a recap?",
    allowed_mentions: SAFE_ALLOWED_MENTIONS,
    components: [
        {
            type: 1,
            components: [
                {
                    type: 2,
                    style: 1,
                    custom_id: makeAutoRecapPromptPreviewCustomId(sourceMessageId),
                    label: "Preview recap",
                },
                {
                    type: 2,
                    style: 2,
                    custom_id: makeAutoRecapPromptIgnoreCustomId(sourceMessageId),
                    label: "Ignore",
                },
            ],
        },
    ],
});

const stripEphemeralFlag = <TBody extends Record<string, unknown>>(body: TBody): TBody => {
    const { flags: _flags, ...rest } = body;
    return rest as TBody;
};

const toPublicPreviewBody = (previewBody: Record<string, unknown>): Record<string, unknown> => ({
    ...stripEphemeralFlag(previewBody),
    allowed_mentions: SAFE_ALLOWED_MENTIONS,
});

const statusMessage = (status: string): string => {
    switch (status) {
        case "preview_posted":
            return "A preview for this Warcraft Logs report was already posted here recently.";
        case "final_posted":
            return "A recap for this Warcraft Logs report was already posted here recently.";
        case "ignored":
            return "This Warcraft Logs report was recently ignored here.";
        case "failed":
            return "This Warcraft Logs report recently failed to process.";
        case "processing":
            return "This Warcraft Logs report is already being processed here.";
        case "prompted":
        default:
            return "This Warcraft Logs report was already detected here recently.";
    }
};

const duplicateActionsForStatus = (
    status: string,
): Array<{ label: string; action: "p" | "t" | "o" | "i"; style: number }> => {
    if (status === "final_posted") {
        return [
            { label: "Post again", action: "o", style: 1 },
            { label: "Ignore", action: "i", style: 2 },
        ];
    }
    if (status === "ignored" || status === "failed") {
        return [
            { label: "Try again", action: "t", style: 1 },
            { label: "Ignore", action: "i", style: 2 },
        ];
    }
    return [
        { label: "Preview again", action: "p", style: 1 },
        { label: "Ignore", action: "i", style: 2 },
    ];
};

const buildDuplicateConfirmationBody = (status: string, confirmationNonce: string) => ({
    content: statusMessage(status),
    allowed_mentions: SAFE_ALLOWED_MENTIONS,
    components: [
        {
            type: 1,
            components: duplicateActionsForStatus(status).map((action) => ({
                type: 2,
                style: action.style,
                custom_id: makeAutoRecapDuplicateCustomId(action.action, confirmationNonce),
                label: action.label,
            })),
        },
    ],
});

const isDuplicateComponent = (
    component: AutoRecapComponent,
): component is Extract<AutoRecapComponent, { confirmationNonce: string }> =>
    "confirmationNonce" in component;

const getRequesterDiscordUserId = (interaction: DiscordInteraction): string =>
    interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";

const autoRecapUnavailableResponse = (
    interaction: DiscordInteraction,
    details: Record<string, unknown>,
): unknown => {
    logger.error(
        {
            interactionId: interaction.id,
            guildId: interaction.guild_id,
            channelId: interaction.channel_id,
            ...details,
        },
        "auto recap component configuration error",
    );
    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
            content: AUTO_RECAP_UNAVAILABLE_MESSAGE,
            flags: EPHEMERAL_MESSAGE_FLAG,
        },
    };
};

const runPromptPreview = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
    sourceMessageId: string,
): Promise<void> => {
    const applicationId = interaction.application_id;
    const interactionToken = interaction.token;
    if (!applicationId || !interactionToken) return;

    try {
        const promptState =
            await options.autoRecapPromptStateService?.getValidPromptState(sourceMessageId);
        if (!promptState) {
            await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
                content: PROMPT_EXPIRED_MESSAGE,
                flags: EPHEMERAL_MESSAGE_FLAG,
            });
            return;
        }

        const previewStateTtlMs =
            (options.previewStateTtlSeconds ?? DEFAULT_PREVIEW_STATE_TTL_SECONDS) * 1000;
        const artifact = await buildRecapArtifact({
            guildId: promptState.guildId,
            channelId: promptState.channelId,
            createdByUserId: getRequesterDiscordUserId(interaction),
            ...(interaction.id ? { interactionId: interaction.id } : {}),
            options,
            url: promptState.sourceUrl,
        });
        const createdAt = new Date();
        const previewStateInput: SavePreviewStateInput = {
            ...artifact.previewStateInputBase,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + previewStateTtlMs),
        };
        await options.recapPreviewStateService.savePreviewState(previewStateInput);
        await safeEditOriginalInteractionResponse(
            applicationId,
            interactionToken,
            artifact.previewBody,
        );
    } catch (error) {
        logger.error(
            {
                interactionId: interaction.id,
                sourceMessageId,
                error: serializeError(error),
            },
            "auto recap prompt preview failed",
        );
        await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
            content: getRecapFailureMessage(error),
            flags: EPHEMERAL_MESSAGE_FLAG,
        });
    }
};

const scheduleTask = (options: HandleOptions, task: () => void): void => {
    if (options.scheduleBackgroundTask) {
        options.scheduleBackgroundTask(task);
        return;
    }
    queueMicrotask(task);
};

const savePreviewStateForArtifact = async (
    artifact: Awaited<ReturnType<typeof buildRecapArtifact>>,
    options: HandleOptions,
): Promise<void> => {
    const previewStateTtlMs =
        (options.previewStateTtlSeconds ?? DEFAULT_PREVIEW_STATE_TTL_SECONDS) * 1000;
    const createdAt = new Date();
    await options.recapPreviewStateService.savePreviewState({
        ...artifact.previewStateInputBase,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + previewStateTtlMs),
    });
};

const runDuplicatePreview = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
    confirmationNonce: string,
    postPublicly: boolean,
): Promise<void> => {
    const applicationId = interaction.application_id;
    const interactionToken = interaction.token;
    if (!applicationId || !interactionToken) return;

    try {
        const duplicateState =
            await options.autoRecapDuplicateTrackingService?.getByConfirmationNonce?.(
                confirmationNonce,
            );
        if (!duplicateState) {
            await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
                content: "This duplicate confirmation has expired.",
                flags: EPHEMERAL_MESSAGE_FLAG,
            });
            return;
        }
        const artifact = await buildRecapArtifact({
            guildId: duplicateState.guildId,
            channelId: duplicateState.channelId,
            createdByUserId: getRequesterDiscordUserId(interaction),
            ...(interaction.id ? { interactionId: interaction.id } : {}),
            options,
            url: duplicateState.sourceUrl,
        });

        if (postPublicly) {
            const publicMessage = await createFollowupInteractionResponse(
                applicationId,
                interactionToken,
                {
                    embeds: [artifact.publicEmbed],
                    allowed_mentions: SAFE_ALLOWED_MENTIONS,
                },
            );
            await options.autoRecapDuplicateTrackingService?.updateTracking({
                guildId: duplicateState.guildId,
                channelId: duplicateState.channelId,
                reportCode: duplicateState.reportCode,
                status: "final_posted",
                latestOutputMessageId: publicMessage.id,
                latestOutputKind: "public_final_recap",
            });
            await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
                content: "Recap posted to this channel.",
                flags: EPHEMERAL_MESSAGE_FLAG,
            });
            return;
        }

        await savePreviewStateForArtifact(artifact, options);
        await safeEditOriginalInteractionResponse(
            applicationId,
            interactionToken,
            artifact.previewBody,
        );
    } catch (error) {
        logger.error(
            {
                interactionId: interaction.id,
                confirmationNonce,
                error: serializeError(error),
            },
            "auto recap duplicate action failed",
        );
        await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
            content: getRecapFailureMessage(error),
            flags: EPHEMERAL_MESSAGE_FLAG,
        });
    }
};

const sendPublicFailure = async (
    input: {
        key: string;
        channel: AutoRecapSendableChannel;
        reportCode: string;
        error: unknown;
        failureTtlMs: number;
        failureThrottle?: AutoRecapFailureThrottle;
    },
): Promise<string | null> => {
    if (input.failureThrottle && !input.failureThrottle.shouldPostFailure(input.key, input.failureTtlMs)) {
        return null;
    }
    try {
        const sent = await input.channel.send({
            content: "Could not build recap for that Warcraft Logs report. Please try again.",
            allowed_mentions: SAFE_ALLOWED_MENTIONS,
        });
        return sent.id;
    } catch (sendError) {
        logger.error(
            {
                reportCode: input.reportCode,
                error: serializeError(sendError),
            },
            "auto recap public failure message could not be sent",
        );
        return null;
    }
};

const handleDuplicatePassiveDetection = async (
    input: {
        existing: AutoRecapDuplicateTrackingRecord;
        channel: AutoRecapSendableChannel;
        duplicateService: NonNullable<HandleOptions["autoRecapDuplicateTrackingService"]>;
    },
): Promise<void> => {
    if (input.existing.duplicateConfirmationMessageId) return;
    const confirmationNonce = input.existing.confirmationNonce ?? randomUUID();
    try {
        const sent = await input.channel.send(
            buildDuplicateConfirmationBody(input.existing.status, confirmationNonce),
        );
        await input.duplicateService.updateTracking({
            guildId: input.existing.guildId,
            channelId: input.existing.channelId,
            reportCode: input.existing.reportCode,
            confirmationNonce,
            duplicateConfirmationMessageId: sent.id,
            latestOutputMessageId: sent.id,
            latestOutputKind: "duplicate_confirmation",
        });
    } catch (error) {
        logger.error(
            {
                guildId: input.existing.guildId,
                channelId: input.existing.channelId,
                reportCode: input.existing.reportCode,
                error: serializeError(error),
            },
            "auto recap duplicate confirmation could not be sent",
        );
    }
};

export const handleAutoRecapMessageCreate = async ({
    message,
    channel,
    handleOptions,
    duplicateTtlMs = DEFAULT_DUPLICATE_TTL_MS,
    failureTtlMs = DEFAULT_DUPLICATE_TTL_MS,
    failureThrottle,
}: AutoRecapMessageCreateOptions): Promise<void> => {
    if (message.authorBot) return;
    if (!message.guildId) return;
    if (!message.content) return;

    const guildConfig = await handleOptions.guildConfigStore.getGuildConfig(message.guildId);
    if (guildConfig.autoRecapMode === "off") return;
    if (guildConfig.autoRecapChannelIds.length === 0) return;
    if (!guildConfig.autoRecapChannelIds.includes(message.channelId)) return;

    const parsed = extractFirstWarcraftLogsReportUrl(message.content);
    if (!parsed) return;
    if (!channel) {
        logger.info(
            {
                guildId: message.guildId,
                channelId: message.channelId,
                reportCode: parsed.reportCode,
            },
            "auto recap skipped because channel is not sendable",
        );
        return;
    }

    const duplicateService = handleOptions.autoRecapDuplicateTrackingService;
    if (!duplicateService) return;
    const expiresAt = new Date(Date.now() + duplicateTtlMs);
    const claim = await duplicateService.claimPassiveDetection({
        guildId: message.guildId,
        channelId: message.channelId,
        reportCode: parsed.reportCode,
        gameFamily: parsed.gameFamily,
        sourceUrl: parsed.rawUrl,
        sourceMessageId: message.messageId,
        sourceAuthorId: message.authorId,
        mode: guildConfig.autoRecapMode,
        expiresAt,
    });

    if (!claim.claimed) {
        if (claim.record) {
            await handleDuplicatePassiveDetection({
                existing: claim.record,
                channel,
                duplicateService,
            });
        }
        return;
    }

    const key = `${message.guildId}:${message.channelId}:${parsed.reportCode}`;
    let channelSendFailed = false;
    const sendChannelMessage = async (body: Record<string, unknown>): Promise<{ id: string }> => {
        try {
            return await channel.send(body);
        } catch (error) {
            channelSendFailed = true;
            throw error;
        }
    };
    try {
        if (guildConfig.autoRecapMode === "prompt") {
            const sent = await sendChannelMessage(buildAutoRecapPromptBody(message.messageId));
            await handleOptions.autoRecapPromptStateService?.savePromptState({
                guildId: message.guildId,
                channelId: message.channelId,
                reportCode: parsed.reportCode,
                gameFamily: parsed.gameFamily,
                sourceUrl: parsed.rawUrl,
                sourceMessageId: message.messageId,
                sourceAuthorId: message.authorId,
                promptMessageId: sent.id,
                expiresAt,
            });
            await duplicateService.updateTracking({
                guildId: message.guildId,
                channelId: message.channelId,
                reportCode: parsed.reportCode,
                status: "prompted",
                latestOutputMessageId: sent.id,
                latestOutputKind: "prompt",
            });
            return;
        }

        const artifact = await buildRecapArtifact({
            guildId: message.guildId,
            channelId: message.channelId,
            createdByUserId: message.authorId,
            options: handleOptions,
            url: parsed.rawUrl,
        });

        if (guildConfig.autoRecapMode === "auto_preview") {
            await savePreviewStateForArtifact(artifact, handleOptions);
            const sent = await sendChannelMessage(toPublicPreviewBody(artifact.previewBody));
            await duplicateService.updateTracking({
                guildId: message.guildId,
                channelId: message.channelId,
                reportCode: parsed.reportCode,
                status: "preview_posted",
                latestOutputMessageId: sent.id,
                latestOutputKind: "public_preview",
            });
            return;
        }

        const sent = await sendChannelMessage({
            embeds: [artifact.publicEmbed],
            allowed_mentions: SAFE_ALLOWED_MENTIONS,
        });
        await duplicateService.updateTracking({
            guildId: message.guildId,
            channelId: message.channelId,
            reportCode: parsed.reportCode,
            status: "final_posted",
            latestOutputMessageId: sent.id,
            latestOutputKind: "public_final_recap",
        });
    } catch (error) {
        logger.error(
            {
                guildId: message.guildId,
                channelId: message.channelId,
                reportCode: parsed.reportCode,
                error: serializeError(error),
            },
            "auto recap passive handling failed",
        );
        const failureMessageId = channelSendFailed
            ? null
            : await sendPublicFailure({
                  key,
                  channel,
                  reportCode: parsed.reportCode,
                  error,
                  failureTtlMs,
                  ...(failureThrottle ? { failureThrottle } : {}),
              });
        await duplicateService.updateTracking({
            guildId: message.guildId,
            channelId: message.channelId,
            reportCode: parsed.reportCode,
            status: "failed",
            ...(failureMessageId
                ? {
                      latestOutputMessageId: failureMessageId,
                      latestOutputKind: "public_failure" as const,
                  }
                : {}),
        });
    }
};

export const handleAutoRecapComponentInteraction = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
): Promise<unknown | undefined> => {
    const id = interaction.data?.custom_id;
    if (typeof id !== "string") return undefined;
    const parsed = parseAutoRecapComponentCustomId(id);
    if (!parsed) return undefined;

    if (isDuplicateComponent(parsed)) {
        if (!options.autoRecapDuplicateTrackingService?.getByConfirmationNonce) {
            return autoRecapUnavailableResponse(interaction, {
                componentAction: parsed.action,
                missingStore: "autoRecapDuplicateTrackingService",
            });
        }

        if (parsed.action === "duplicate_ignore") {
            const duplicateState =
                await options.autoRecapDuplicateTrackingService.getByConfirmationNonce(
                    parsed.confirmationNonce,
                );
            if (!duplicateState) {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "This duplicate confirmation has expired.",
                        flags: EPHEMERAL_MESSAGE_FLAG,
                    },
                };
            }
            await options.autoRecapDuplicateTrackingService.updateTracking({
                guildId: duplicateState.guildId,
                channelId: duplicateState.channelId,
                reportCode: duplicateState.reportCode,
                status: "ignored",
            });
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Duplicate recap action ignored.", flags: EPHEMERAL_MESSAGE_FLAG },
            };
        }

        if (!interaction.application_id || !interaction.token) {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: "Could not prepare recap action. Please try again.",
                    flags: EPHEMERAL_MESSAGE_FLAG,
                },
            };
        }

        scheduleTask(options, () => {
            void runDuplicatePreview(
                interaction,
                options,
                parsed.confirmationNonce,
                parsed.action === "duplicate_post",
            );
        });
        return {
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
            data: { flags: EPHEMERAL_MESSAGE_FLAG },
        };
    }

    if (!options.autoRecapPromptStateService) {
        return autoRecapUnavailableResponse(interaction, {
            componentAction: parsed.action,
            missingStore: "autoRecapPromptStateService",
        });
    }

    if (parsed.action === "prompt_ignore") {
        const promptState = await options.autoRecapPromptStateService.consumeValidPromptState(
            parsed.sourceMessageId,
        );
        if (!promptState) {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: PROMPT_EXPIRED_MESSAGE,
                    flags: EPHEMERAL_MESSAGE_FLAG,
                },
            };
        }
        await options.autoRecapDuplicateTrackingService?.updateTracking({
            guildId: promptState.guildId,
            channelId: promptState.channelId,
            reportCode: promptState.reportCode,
            status: "ignored",
        });
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: { content: "Auto recap prompt ignored.", flags: EPHEMERAL_MESSAGE_FLAG },
        };
    }

    const promptState = await options.autoRecapPromptStateService.getValidPromptState(
        parsed.sourceMessageId,
    );
    if (!promptState) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: PROMPT_EXPIRED_MESSAGE,
                flags: EPHEMERAL_MESSAGE_FLAG,
            },
        };
    }

    if (!interaction.application_id || !interaction.token) {
        return {
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
                content: "Could not prepare recap preview. Please try again.",
                flags: EPHEMERAL_MESSAGE_FLAG,
            },
        };
    }

    scheduleTask(options, () => {
        void runPromptPreview(interaction, options, parsed.sourceMessageId);
    });
    return {
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        data: { flags: EPHEMERAL_MESSAGE_FLAG },
    };
};
