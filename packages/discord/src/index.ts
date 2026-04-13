import {
    InteractionResponseType,
    InteractionType,
    MessageComponentTypes,
} from "discord-interactions";
import { createLogger } from "@wcl/shared";
import type {
    AccountabilityViewService,
    CoachingViewService,
    GuildConfigStore,
    PreviousRaidLookup,
    TrendTrackingService,
} from "@wcl/domain";
import { buildRecapSummary } from "@wcl/domain";
import type { WclClient } from "@wcl/wcl-client";

interface HandleOptions {
    wclClient: WclClient & Partial<PreviousRaidLookup>;
    guildConfigStore: GuildConfigStore;
    recapPreviewStateService: RecapPreviewStateService;
    previewStateTtlSeconds?: number;
    coachingViewService?: CoachingViewService;
    accountabilityViewService?: AccountabilityViewService;
    trendTrackingService?: TrendTrackingService;
}

type RecapSummary = ReturnType<typeof buildRecapSummary>;

type RecapPreviewSummary = RecapSummary;

interface SavePreviewStateInput {
    guildId: string;
    channelId: string;
    reportCode: string;
    sourceUrl: string;
    summaryPayload: RecapPreviewSummary;
    createdByUserId: string;
    createdAt: Date;
    expiresAt: Date;
    interactionId?: string;
    messageId?: string;
}

interface PreviewStateLookup {
    reportCode: string;
    guildId: string;
}

type PreviewStateRecord = SavePreviewStateInput;

export interface RecapPreviewStateService {
    savePreviewState(input: SavePreviewStateInput): Promise<PreviewStateRecord>;
    getValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<PreviewStateRecord | null>;
    consumeValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<PreviewStateRecord | null>;
    deletePreviewState(lookup: PreviewStateLookup): Promise<void>;
}

export interface DiscordCommandOptionChoice {
    name: string;
    value: string | number;
}

export interface DiscordCommandOption {
    type: number;
    name: string;
    description?: string;
    required?: boolean;
    choices?: DiscordCommandOptionChoice[];
    options?: DiscordCommandOption[];
}

export type ChatInputCommandDefinition = {
    type: 1;
    name: string;
    description: string;
    options?: DiscordCommandOption[];
    integration_types?: number[];
    contexts?: number[];
    default_member_permissions?: string;
    nsfw?: boolean;
};

export type UserCommandDefinition = {
    type: 2;
    name: string;
    integration_types?: number[];
    contexts?: number[];
    default_member_permissions?: string;
    nsfw?: boolean;
};

export type MessageCommandDefinition = {
    type: 3;
    name: string;
    integration_types?: number[];
    contexts?: number[];
    default_member_permissions?: string;
    nsfw?: boolean;
};

export type CommandDefinition =
    | ChatInputCommandDefinition
    | UserCommandDefinition
    | MessageCommandDefinition;

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DISCORD_USER_AGENT =
    "DiscordBot (https://github.com/yay5a/wclogs.recap, 0.1.0)";
const MAX_RATE_LIMIT_RETRIES = 1;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;
const logger = createLogger("discord");
const EPHEMERAL_MESSAGE_FLAG = 64;
const STRING_OPTION_TYPE = 3;
const INTEGER_OPTION_TYPE = 4;
const NUMBER_OPTION_TYPE = 10;
const slashCommandNameRegex = /^[\p{Ll}\p{N}_-]{1,32}$/u;

const RECAP_COMPONENT_PREFIX = "recap:v1";
const POST_RECAP_ACTION = "post";
const OFFICERS_RECAP_ACTION = "officers";
const DEFAULT_PREVIEW_STATE_TTL_SECONDS = 900;

const toTitleCase = (value: string): string =>
    value
        .split(/[_-]/g)
        .map((part) =>
            part.length > 0
                ? part.charAt(0).toUpperCase() + part.slice(1)
                : part,
        )
        .join(" ");

const makeRecapComponentCustomId = (
    action: string,
    reportCode: string,
    guildId: string,
): string => `${RECAP_COMPONENT_PREFIX}:${action}:${reportCode}:${guildId}`;

const parseRecapComponentCustomId = (
    customId: string,
): { action: string; reportCode: string; guildId: string } | undefined => {
    const [prefix, version, action, reportCode, guildId] = customId.split(":");
    if (`${prefix}:${version}` !== RECAP_COMPONENT_PREFIX) return undefined;
    if (!action || !reportCode || !guildId) return undefined;
    return { action, reportCode, guildId };
};

type OfficerDetailCapableSummary = Pick<
    RecapPreviewSummary,
    "accountabilityVisibility" | "coachingShareability"
>;

const requiresOfficerDetails = (
    summary: OfficerDetailCapableSummary,
): boolean =>
    summary.accountabilityVisibility === "officers-only" ||
    summary.coachingShareability === "private";

const buildOfficerDetailsBody = (
    summary: Pick<
        RecapPreviewSummary,
        "reportTitle" | "accountabilityVisibility" | "coachingShareability"
    >,
) => ({
    flags: EPHEMERAL_MESSAGE_FLAG,
    embeds: [
        {
            title: `Officers: ${summary.reportTitle}`,
            fields: [
                {
                    name: "Accountability Visibility",
                    value: toTitleCase(summary.accountabilityVisibility),
                    inline: true,
                },
                {
                    name: "Coaching Shareability",
                    value: toTitleCase(summary.coachingShareability),
                    inline: true,
                },
                {
                    name: "Restricted Notes",
                    value: "Use accountability/coaching exports for officer review only.",
                },
            ],
        },
    ],
});

interface DiscordInteractionData {
    name?: string;
    options?: unknown;
    custom_id?: string;
}

interface DiscordInteraction {
    id?: string;
    application_id?: string;
    token?: string;
    type?: number;
    guild_id?: string;
    channel_id?: string;
    member?: { user?: { id?: string } };
    user?: { id?: string };
    data?: DiscordInteractionData;
}

const toDurationMs = (startedAt: number): number => Date.now() - startedAt;
const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

interface DiscordRateLimitMetadata {
    retryAfterMs: number;
    global: boolean | null;
    source: "header" | "body";
}

const parseRetryAfterSeconds = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        return value;
    }
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return null;
};

const readDiscordRateLimitMetadata = async (
    response: Response,
): Promise<DiscordRateLimitMetadata | null> => {
    const retryAfterFromHeader = parseRetryAfterSeconds(
        response.headers.get("Retry-After") ??
            response.headers.get("X-RateLimit-Reset-After"),
    );

    if (retryAfterFromHeader !== null) {
        return {
            retryAfterMs: Math.ceil(retryAfterFromHeader * 1000),
            global: null,
            source: "header",
        };
    }

    try {
        const body = (await response.clone().json()) as unknown;
        if (!isObjectRecord(body)) return null;
        const retryAfterValue = parseRetryAfterSeconds(body.retry_after);
        const globalValue = body.global;
        if (retryAfterValue !== null) {
            return {
                retryAfterMs: Math.ceil(retryAfterValue * 1000),
                global: typeof globalValue === "boolean" ? globalValue : null,
                source: "body",
            };
        }
    } catch {
        return null;
    }

    return null;
};

interface DiscordApiRequestOptions {
    endpoint: string;
    method: "PATCH" | "PUT";
    route: string;
    botToken?: string;
    body?: unknown;
    maxRateLimitRetries?: number;
}

const discordApiRequest = async ({
    endpoint,
    method,
    route,
    botToken,
    body,
    maxRateLimitRetries = MAX_RATE_LIMIT_RETRIES,
}: DiscordApiRequestOptions): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
        const response = await fetch(endpoint, {
            method,
            headers: {
                "User-Agent": DISCORD_USER_AGENT,
                ...(botToken ? { Authorization: `Bot ${botToken}` } : {}),
                ...(body !== undefined
                    ? { "Content-Type": "application/json" }
                    : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });

        if (response.status !== 429) return response;
        if (attempt >= maxRateLimitRetries) return response;

        const rateLimitMetadata = await readDiscordRateLimitMetadata(response);
        if (!rateLimitMetadata) {
            logger.warn(
                {
                    route,
                    attempt: attempt + 1,
                    status: response.status,
                },
                "discord API rate limit hit without retry timing; skipping retry",
            );
            return response;
        }

        const retryAfterMs = Math.min(
            rateLimitMetadata.retryAfterMs,
            MAX_RATE_LIMIT_WAIT_MS,
        );

        logger.warn(
            {
                route,
                attempt: attempt + 1,
                status: response.status,
                retryAfterMs,
                retryAfterSource: rateLimitMetadata.source,
                global: rateLimitMetadata.global,
            },
            "discord API rate limit hit; retrying request",
        );

        await delay(retryAfterMs);
    }
};

const logReportRecapStep = (
    interactionId: string | undefined,
    step: string,
    startedAt: number,
) => {
    logger.info(
        {
            interactionId,
            step,
            durationMs: toDurationMs(startedAt),
        },
        "report recap step complete",
    );
};

export const buildRecapPreviewBody = (
    summary: ReturnType<typeof buildRecapSummary>,
    reportCode: string,
    guildId: string,
) => ({
    flags: EPHEMERAL_MESSAGE_FLAG,
    embeds: [
        {
            title: `Preview: ${summary.titleLine}`,
            description: [
                summary.secondaryLine,
                `Kill Time: ${summary.killTimeLabel} (${summary.pullCount} Pulls)`,
                `Date: ${summary.reportDateLabel}`,
                summary.bestPlayerParses[0]
                    ? `Best Parse: ${summary.bestPlayerParses[0].playerName} (${summary.bestPlayerParses[0].parse.toFixed(1)})`
                    : undefined,
            ]
                .filter((line): line is string => Boolean(line))
                .join("\n"),
        },
    ],
    components: [
        {
            type: 1,
            components: [
                {
                    type: MessageComponentTypes.BUTTON,
                    style: 1,
                    custom_id: makeRecapComponentCustomId(
                        POST_RECAP_ACTION,
                        reportCode,
                        guildId,
                    ),
                    label: "Post Recap",
                },
            ],
        },
    ],
});

const toRecapPreviewSummary = (summary: RecapSummary): RecapPreviewSummary =>
    summary;

export const editOriginalInteractionResponse = async (
    applicationId: string,
    token: string,
    body: unknown,
): Promise<void> => {
    const endpoint = `${DISCORD_API_BASE_URL}/webhooks/${applicationId}/${token}/messages/@original`;
    const response = await discordApiRequest({
        endpoint,
        method: "PATCH",
        route: "/webhooks/{applicationId}/{token}/messages/@original",
        body,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Failed to edit original interaction response: ${response.status} ${response.statusText} ${errorBody}`,
        );
    }
};

export const safeEditOriginalInteractionResponse = async (
    applicationId: string,
    token: string,
    body: unknown,
): Promise<void> => {
    try {
        await editOriginalInteractionResponse(applicationId, token, body);
    } catch (error) {
        logger.error(
            {
                error,
                applicationId,
            },
            "failed to edit original interaction response",
        );
    }
};

const processReportRecapInteraction = async (
    interaction: DiscordInteraction,
    options: HandleOptions,
    url: string,
): Promise<void> => {
    const previewStateTtlMs =
        (options.previewStateTtlSeconds ?? DEFAULT_PREVIEW_STATE_TTL_SECONDS) *
        1000;
    const interactionId = interaction.id;
    const guildId = interaction.guild_id ?? "dm";
    const channelId = interaction.channel_id ?? "unknown";
    const createdByUserId =
        interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";
    const applicationId = interaction.application_id;
    const interactionToken = interaction.token;

    if (!applicationId || !interactionToken) {
        logger.error(
            {
                interactionId,
                applicationIdPresent: Boolean(applicationId),
                tokenPresent: Boolean(interactionToken),
            },
            "report recap missing application id or token",
        );
        return;
    }

    try {
        const guildConfigStart = Date.now();
        const guildConfig =
            await options.guildConfigStore.getGuildConfig(guildId);
        logReportRecapStep(
            interactionId,
            "guild_config_load",
            guildConfigStart,
        );

        const reportFetchStart = Date.now();
        const report = await options.wclClient.fetchAndNormalizeReport(url);
        logReportRecapStep(
            interactionId,
            "report_fetch_normalize",
            reportFetchStart,
        );

        const previousLookupStart = Date.now();
        const previousPlayers = options.wclClient.findPreviousRaidSummaries
            ? await options.wclClient.findPreviousRaidSummaries(
                  guildId,
                  new Date(report.startTime),
              )
            : [];
        logReportRecapStep(
            interactionId,
            "previous_raid_summary_lookup",
            previousLookupStart,
        );

        const summaryBuildStart = Date.now();
        const summary = buildRecapSummary(report, previousPlayers, {
            guildConfig,
        });
        logReportRecapStep(interactionId, "summary_build", summaryBuildStart);

        const createdAt = new Date();
        const previewStateInput: SavePreviewStateInput = {
            guildId,
            channelId,
            reportCode: report.reportCode,
            sourceUrl: url,
            summaryPayload: toRecapPreviewSummary(summary),
            createdByUserId,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + previewStateTtlMs),
        };
        if (interactionId) {
            previewStateInput.interactionId = interactionId;
        }
        await options.recapPreviewStateService.savePreviewState(
            previewStateInput,
        );

        const editStart = Date.now();
        await editOriginalInteractionResponse(
            applicationId,
            interactionToken,
            buildRecapPreviewBody(summary, report.reportCode, guildId),
        );
        logReportRecapStep(interactionId, "original_response_edit", editStart);
    } catch (error) {
        logger.error(
            {
                error,
                interactionId,
                guildId,
            },
            "report recap processing failed",
        );
        const errorMessage =
            error instanceof Error ? error.message.toLowerCase() : "";
        const userFacingContent = errorMessage.includes("report code")
            ? "I couldn't find a Warcraft Logs report code in that URL. Paste the full report link."
            : "Could not build recap preview for that report. Please verify the URL and try again.";

        await safeEditOriginalInteractionResponse(
            applicationId,
            interactionToken,
            {
                flags: EPHEMERAL_MESSAGE_FLAG,
                content: userFacingContent,
            },
        );
    }
};

const commandTypeLabel = (type: CommandDefinition["type"]): string => {
    switch (type) {
        case 1:
            return "CHAT_INPUT";
        case 2:
            return "USER";
        case 3:
            return "MESSAGE";
    }
};

const validateCommandNameUniqueness = (commands: CommandDefinition[]) => {
    const seen = new Set<string>();
    for (const command of commands) {
        const key = `${command.type}:${command.name}`;
        if (seen.has(key)) {
            throw new Error(
                `Command validation failed for '${command.name}': duplicate command name '${command.name}' for type ${command.type}.`,
            );
        }
        seen.add(key);
    }
};

const validateOptionChoices = (
    commandName: string,
    option: DiscordCommandOption,
    optionPath: string,
): void => {
    if (!option.choices?.length) return;

    const allowedChoiceTypes = new Set<number>([
        STRING_OPTION_TYPE,
        INTEGER_OPTION_TYPE,
        NUMBER_OPTION_TYPE,
    ]);

    if (!allowedChoiceTypes.has(option.type)) {
        throw new Error(
            `Command validation failed for '${commandName}' at '${optionPath}': choices are only valid for STRING, INTEGER, or NUMBER options.`,
        );
    }

    for (const choice of option.choices) {
        if (
            option.type === STRING_OPTION_TYPE &&
            typeof choice.value !== "string"
        ) {
            throw new Error(
                `Command validation failed for '${commandName}' at '${optionPath}': STRING option choices must have string values.`,
            );
        }
        if (
            (option.type === INTEGER_OPTION_TYPE ||
                option.type === NUMBER_OPTION_TYPE) &&
            typeof choice.value !== "number"
        ) {
            throw new Error(
                `Command validation failed for '${commandName}' at '${optionPath}': numeric option choices must have number values.`,
            );
        }
    }
};

const validateAndNormalizeOptions = (
    commandName: string,
    options: DiscordCommandOption[],
    path = "options",
): DiscordCommandOption[] => {
    const seenNames = new Set<string>();
    let foundOptional = false;

    for (const [index, option] of options.entries()) {
        const optionPath = `${path}[${index}]`;

        if (!option.name) {
            throw new Error(
                `Command validation failed for '${commandName}' at '${optionPath}': option name is required.`,
            );
        }

        if (seenNames.has(option.name)) {
            throw new Error(
                `Command validation failed for '${commandName}' at '${optionPath}': duplicate option name '${option.name}'.`,
            );
        }
        seenNames.add(option.name);

        if (option.required === true) {
            if (foundOptional) {
                throw new Error(
                    `Command validation failed for '${commandName}' at '${optionPath}': required options must appear before optional options.`,
                );
            }
        } else {
            foundOptional = true;
        }

        validateOptionChoices(commandName, option, optionPath);

        if (Array.isArray(option.options) && option.options.length > 0) {
            option.options = validateAndNormalizeOptions(
                commandName,
                option.options,
                `${optionPath}.options`,
            );
        }
    }

    return options;
};

const validateCommandDefinition = (command: CommandDefinition): void => {
    if (!command.name || command.name.trim().length === 0) {
        throw new Error("Command validation failed: command name is required.");
    }

    if (command.type === 1) {
        if (!slashCommandNameRegex.test(command.name)) {
            throw new Error(
                `Command validation failed for '${command.name}': slash command names must be lowercase and use [a-z0-9_-] style characters.`,
            );
        }

        if (!command.description || command.description.trim().length === 0) {
            throw new Error(
                `Command validation failed for '${command.name}': description is required for chat input commands.`,
            );
        }

        if (command.options) {
            command.options = validateAndNormalizeOptions(
                command.name,
                command.options,
            );
        }
        return;
    }

    if (
        "description" in (command as unknown as Record<string, unknown>) &&
        typeof (command as unknown as { description?: unknown }).description !==
            "undefined"
    ) {
        throw new Error(
            `Command validation failed for '${command.name}': description is not allowed for ${commandTypeLabel(command.type)} commands.`,
        );
    }

    if (
        "options" in (command as unknown as Record<string, unknown>) &&
        Array.isArray((command as unknown as { options?: unknown }).options)
    ) {
        throw new Error(
            `Command validation failed for '${command.name}': options are not allowed for ${commandTypeLabel(command.type)} commands.`,
        );
    }
};

export const buildDiscordCommandPayload = (
    command: CommandDefinition,
): Record<string, unknown> => {
    validateCommandDefinition(command);

    const basePayload = {
        name: command.name,
        type: command.type,
        integration_types: command.integration_types,
        contexts: command.contexts,
        default_member_permissions: command.default_member_permissions,
        nsfw: command.nsfw,
    };

    if (command.type === 1) {
        return {
            ...basePayload,
            description: command.description,
            ...(command.options ? { options: command.options } : {}),
        };
    }

    return basePayload;
};

export const buildDiscordCommandPayloads = (
    commands: CommandDefinition[],
): Record<string, unknown>[] => {
    validateCommandNameUniqueness(commands);
    return commands.map(buildDiscordCommandPayload);
};

export const commandDefinitions: CommandDefinition[] = [
    { name: "health", description: "Check bot health", type: 1 },
    {
        name: "config",
        description: "Configure guild recap behavior",
        type: 1,
        options: [
            {
                name: "game_family",
                description: "Default game family",
                type: 3,
                required: false,
                choices: [
                    { name: "retail", value: "retail" },
                    { name: "mop_classic", value: "mop_classic" },
                ],
            },
            {
                name: "compare_mode",
                description: "Default compare mode",
                type: 3,
                required: false,
                choices: [
                    { name: "character", value: "character" },
                    { name: "mixed", value: "mixed" },
                ],
            },
            {
                name: "visibility",
                description: "Set accountability visibility",
                type: 3,
                required: false,
                choices: [
                    { name: "off", value: "off" },
                    { name: "officers-only", value: "officers-only" },
                    { name: "shareable", value: "shareable" },
                ],
            },
            {
                name: "coaching_shareability",
                description: "Default coaching shareability",
                type: 3,
                required: false,
                choices: [
                    { name: "private", value: "private" },
                    { name: "shareable", value: "shareable" },
                ],
            },
            {
                name: "recap_post_mode",
                description: "Default recap post mode",
                type: 3,
                required: false,
                choices: [
                    { name: "preview-and-post", value: "preview-and-post" },
                    { name: "preview-only", value: "preview-only" },
                ],
            },
        ],
    },
    {
        name: "report",
        description: "Report tools",
        type: 1,
        options: [
            {
                name: "recap",
                description: "Generate a recap preview from a WCL report URL",
                type: 1,
                options: [
                    {
                        name: "url",
                        description: "WCL report URL",
                        type: 3,
                        required: true,
                    },
                ],
            },
        ],
    },
    // Intentionally kept as a MESSAGE command because interaction handling keys on
    // the exact mixed-case name "Analyze Log" and this command is context-menu based.
    { name: "Analyze Log", type: 3 },
];

export class DiscordCommandRegistrationError extends Error {
    constructor(
        message: string,
        readonly details: {
            status: number;
            statusText: string;
            responseBody: string;
            targetScope: "global" | "guild";
            payloadSnippet: string;
        },
    ) {
        super(message);
        this.name = "DiscordCommandRegistrationError";
    }
}

const registerCommandSet = async (
    appId: string,
    botToken: string,
    targetScope: "global" | "guild",
    endpoint: string,
    guildId?: string,
): Promise<void> => {
    const payload = buildDiscordCommandPayloads(commandDefinitions);

    logger.info(
        {
            guildId: guildId ?? null,
            payloadCount: payload.length,
            commands: payload.map((command) => ({
                name: command.name,
                type: command.type,
            })),
        },
        "registering Discord commands",
    );

    const response = await discordApiRequest({
        endpoint,
        method: "PUT",
        route:
            targetScope === "global"
                ? "/applications/{applicationId}/commands"
                : "/applications/{applicationId}/guilds/{guildId}/commands",
        botToken,
        body: payload,
    });

    const text = await response.text();

    if (!response.ok) {
        const payloadSnippet = JSON.stringify(
            payload.map(({ name, type, description, options }) => ({
                name,
                type,
                ...(description ? { description } : {}),
                ...(options ? { options } : {}),
            })),
        ).slice(0, 2000);

        throw new DiscordCommandRegistrationError(
            `Discord command registration failed (${targetScope}): ${response.status} ${response.statusText}`,
            {
                status: response.status,
                statusText: response.statusText,
                responseBody: text,
                targetScope,
                payloadSnippet,
            },
        );
    }
};

export const registerGlobalCommands = async (
    appId: string,
    botToken: string,
): Promise<void> =>
    registerCommandSet(
        appId,
        botToken,
        "global",
        `${DISCORD_API_BASE_URL}/applications/${appId}/commands`,
    );

export const registerGuildCommands = async (
    appId: string,
    botToken: string,
    guildId: string,
): Promise<void> => {
    const normalizedGuildId = guildId.trim();
    if (!normalizedGuildId) {
        throw new Error(
            "Command validation failed: guildId is required for guild command registration.",
        );
    }

    return registerCommandSet(
        appId,
        botToken,
        "guild",
        `${DISCORD_API_BASE_URL}/applications/${appId}/guilds/${normalizedGuildId}/commands`,
        normalizedGuildId,
    );
};

const getStringOption = (
    options: unknown,
    name: string,
): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => {
        if (typeof option !== "object" || option === null) return false;
        return (option as { name?: unknown }).name === name;
    }) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};

export const handleInteraction = async (
    interaction: unknown,
    options: HandleOptions,
): Promise<unknown> => {
    const typedInteraction = interaction as DiscordInteraction;

    if (typedInteraction.type === InteractionType.PING) {
        return { type: InteractionResponseType.PONG };
    }

    if (typedInteraction.type === InteractionType.APPLICATION_COMMAND) {
        if (typedInteraction.data?.name === "health") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "OK", flags: 64 },
            };
        }

        if (typedInteraction.data?.name === "config") {
            const guildId = typedInteraction.guild_id;
            if (!guildId) {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "Guild context is required for /config.",
                        flags: 64,
                    },
                };
            }

            const configUpdate = {
                defaultGameFamily: getStringOption(
                    typedInteraction.data.options,
                    "game_family",
                ),
                compareModeDefault: getStringOption(
                    typedInteraction.data.options,
                    "compare_mode",
                ),
                accountabilityVisibility: getStringOption(
                    typedInteraction.data.options,
                    "visibility",
                ),
                coachingShareabilityDefault: getStringOption(
                    typedInteraction.data.options,
                    "coaching_shareability",
                ),
                recapPostModeDefault: getStringOption(
                    typedInteraction.data.options,
                    "recap_post_mode",
                ),
            };

            const updateEntries = Object.entries(configUpdate).filter(
                ([, value]) => typeof value === "string",
            );
            const updateObject = Object.fromEntries(updateEntries);
            const saved = await options.guildConfigStore.saveGuildConfig(
                guildId,
                updateObject,
            );

            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content:
                        `Config saved for guild ${guildId}: ` +
                        `game_family=${saved.defaultGameFamily}, ` +
                        `compare_mode=${saved.compareModeDefault}, ` +
                        `visibility=${saved.accountabilityVisibility}, ` +
                        `coaching_shareability=${saved.coachingShareabilityDefault}, ` +
                        `recap_post_mode=${saved.recapPostModeDefault}`,
                    flags: 64,
                },
            };
        }

        if (typedInteraction.data?.name === "Analyze Log") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: "Use /report recap <url> to analyze this log.",
                    flags: 64,
                },
            };
        }

        if (typedInteraction.data?.name === "report") {
            const recap = (
                Array.isArray(typedInteraction.data.options)
                    ? typedInteraction.data.options
                    : []
            ).find(
                (o) =>
                    typeof o === "object" &&
                    o !== null &&
                    (o as { name?: unknown }).name === "recap",
            ) as { options?: unknown } | undefined;
            const url = getStringOption(recap?.options, "url");
            logger.info(
                {
                    interactionId: typedInteraction.id,
                    rawUrl: url ?? null,
                },
                "report recap url received",
            );

            if (!url || typeof url !== "string") {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "Missing URL",
                        flags: EPHEMERAL_MESSAGE_FLAG,
                    },
                };
            }
            void processReportRecapInteraction(typedInteraction, options, url);
            return {
                type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    flags: EPHEMERAL_MESSAGE_FLAG,
                },
            };
        }
    }

    if (typedInteraction.type === InteractionType.MESSAGE_COMPONENT) {
        const id = typedInteraction.data?.custom_id;

        if (typeof id === "string") {
            const parsedCustomId = parseRecapComponentCustomId(id);
            if (!parsedCustomId) {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "Unsupported interaction in MVP.",
                        flags: 64,
                    },
                };
            }

            const { action, reportCode, guildId } = parsedCustomId;

            if (action === OFFICERS_RECAP_ACTION) {
                const previewState =
                    await options.recapPreviewStateService.getValidPreviewState(
                        {
                            reportCode,
                            guildId,
                        },
                    );

                if (!previewState) {
                    return {
                        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                        data: {
                            content:
                                "This recap preview is no longer available. Please run /report recap again.",
                            flags: 64,
                        },
                    };
                }

                const summary = previewState.summaryPayload;
                if (!requiresOfficerDetails(summary)) {
                    return {
                        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                        data: {
                            content:
                                "Officer details are not enabled for this recap.",
                            flags: EPHEMERAL_MESSAGE_FLAG,
                        },
                    };
                }

                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: buildOfficerDetailsBody(summary),
                };
            }

            if (action !== POST_RECAP_ACTION) {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: "Unsupported recap action.", flags: 64 },
                };
            }

            // Consume preview state before triggering side effects so duplicate
            // button presses/replayed interactions become a no-op.
            const previewState =
                await options.recapPreviewStateService.consumeValidPreviewState(
                    {
                        reportCode,
                        guildId,
                    },
                );

            if (!previewState) {
                logger.info(
                    {
                        action: "recap.post.consume_preview_state_noop",
                        guildId,
                        reportCode,
                        interactionId: typedInteraction.id,
                    },
                    "recap post ignored because preview state was already consumed or expired",
                );
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content:
                            "This recap preview has already been posted or expired. Please run /report recap again.",
                        flags: 64,
                    },
                };
            }

            const summary = previewState.summaryPayload;

            await options.coachingViewService?.buildShareableCoachingView(
                previewState.reportCode,
            );
            await options.accountabilityViewService?.buildAccountabilityView(
                previewState.reportCode,
                summary.accountabilityVisibility,
            );

            if (options.trendTrackingService) {
                await options.trendTrackingService.recomputeTrendsForGuild(
                    previewState.guildId,
                );
            }

            const components = requiresOfficerDetails(summary)
                ? [
                      {
                          type: 1,
                          components: [
                              {
                                  type: MessageComponentTypes.BUTTON,
                                  style: 2,
                                  custom_id: makeRecapComponentCustomId(
                                      OFFICERS_RECAP_ACTION,
                                      reportCode,
                                      guildId,
                                  ),
                                  label: "Officers: Coaching & Accountability",
                              },
                          ],
                      },
                  ]
                : undefined;

            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    embeds: [buildPublicRecapEmbed(summary)],
                    ...(components ? { components } : {}),
                },
            };
        }
    }
    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Unsupported interaction in MVP.", flags: 64 },
    };
};

export function buildPublicRecapEmbed(summary: RecapPreviewSummary) {
    const formatClassSpec = (value?: string): string =>
        value ? ` • ${value}` : "";
    const formatCompactNumber = (value: number): string =>
        new Intl.NumberFormat("en-US", {
            notation: "compact",
            maximumFractionDigits: 1,
        }).format(value);
    const toMetricLabel = (metricLabel?: string, metric?: string): string | undefined => {
        const candidate = metricLabel?.trim().toUpperCase() ?? metric?.trim().toUpperCase();
        if (!candidate) return undefined;
        if (candidate === "DPS" || candidate === "HPS" || candidate === "DTPS") {
            return candidate;
        }
        return undefined;
    };
    const formatBestParseRow = (entry: RecapPreviewSummary["bestPlayerParses"][number]): string => {
        const parseValue = Number.isInteger(entry.parse)
            ? entry.parse.toFixed(0)
            : entry.parse.toFixed(1);
        const metricLabel = toMetricLabel(entry.metricLabel, entry.metric);
        const amountSection =
            typeof entry.amount === "number"
                ? ` | ${formatCompactNumber(entry.amount)}${metricLabel ? ` ${metricLabel}` : ""}`
                : "";
        const classSpec =
            entry.classSpecLabel ??
            [entry.specName, entry.className]
                .filter((value): value is string => Boolean(value))
                .join(" ");
        const classSpecSection = classSpec ? ` - ${classSpec}` : "";
        return `• ${entry.playerName} ${parseValue}${amountSection}${classSpecSection}`;
    };
    const formatPhase = (durationMs: number): string => {
        const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    };
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
        {
            name: "Raid",
            value: [
                summary.secondaryLine,
                `Kill Time: ${summary.killTimeLabel} (${summary.pullCount} Pulls)`,
                `Date: ${summary.reportDateLabel}`,
            ]
                .filter((line): line is string => Boolean(line))
                .join("\n"),
        },
    ];

    if (summary.fastestPhaseTimes.length > 0) {
        fields.push({
            name: "Fastest Phase Times",
            value: summary.fastestPhaseTimes
                .map(
                    (phase) =>
                        `${phase.label}: ${formatPhase(phase.durationMs)}`,
                )
                .join("\n"),
        });
    }

    if (summary.bestPlayerParses.length > 0) {
        fields.push({
            name: "Best Player Parses",
            value: summary.bestPlayerParses.map((entry) => formatBestParseRow(entry)).join("\n"),
        });
    }

    if (summary.topDamageTaken.length > 0) {
        fields.push({
            name: "Top Damage Taken",
            value: summary.topDamageTaken
                .map(
                    (entry) =>
                        `• ${entry.playerName} (${formatCompactNumber(entry.value)})${formatClassSpec(entry.classSpecLabel)}`,
                )
                .join("\n"),
        });
    }

    if (summary.topHealers.length > 0) {
        fields.push({
            name: "Top Healers",
            value: summary.topHealers
                .map(
                    (entry) =>
                        `• ${entry.playerName} (${formatCompactNumber(entry.value)})${formatClassSpec(entry.classSpecLabel)}`,
                )
                .join("\n"),
        });
    }

    const totalLines = [
        typeof summary.totals.totalDeaths === "number"
            ? `Total deaths: ${summary.totals.totalDeaths}`
            : undefined,
        typeof summary.totals.raidDamageTaken === "number"
            ? `Raid damage taken: ${formatCompactNumber(summary.totals.raidDamageTaken)}`
            : undefined,
        typeof summary.totals.dispels === "number"
            ? `Dispels: ${summary.totals.dispels}`
            : undefined,
        typeof summary.totals.battleRezzes === "number"
            ? `Battle rezzes: ${summary.totals.battleRezzes}`
            : undefined,
        typeof summary.totals.kicks === "number"
            ? `Kicks: ${summary.totals.kicks}`
            : undefined,
    ].filter((line): line is string => Boolean(line));

    if (totalLines.length > 0) {
        fields.push({
            name: "Totals",
            value: totalLines.join("\n"),
        });
    }
    fields.push({ name: "Report", value: summary.reportLink });

    return {
        title: summary.titleLine,
        fields,
    };
}
