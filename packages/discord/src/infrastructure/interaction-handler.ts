import { InteractionResponseType, InteractionType } from "discord-interactions";
import { createLogger } from "@wcl/shared";
import type { HandleOptions } from "../types.js";
import { handleApproveCharacterCommand, handleClaimCharacterCommand, handleComparePrivacyCommand, handleMyCharactersCommand, handleRejectCharacterCommand } from "../commands/character-claims.js";
import { handleCompareCommand } from "../commands/compare.js";
import { handleConfigCommand } from "../commands/config.js";
import { handleAddOfficerCommand, handleListOfficersCommand, handleRemoveOfficerCommand } from "../commands/officer-management.js";
import { handleAutoReportComponentInteraction } from "../commands/auto-report.js";
import { processReportInteraction } from "../commands/report.js";

const logger = createLogger("discord");
const EPHEMERAL_MESSAGE_FLAG = 64;
const RECAP_RETIRED_MESSAGE = "`/recap` has been retired. Use `/report <wcl_report_url>`.";

export const handleInteraction = async (interaction: unknown, options: HandleOptions): Promise<unknown> => {
    const typedInteraction = interaction as import("../types.js").DiscordInteraction;

    if (typedInteraction.type === InteractionType.PING) {
        return { type: InteractionResponseType.PONG };
    }

    if (typedInteraction.type === InteractionType.APPLICATION_COMMAND) {
        if (typedInteraction.data?.name === "health") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "OK", flags: EPHEMERAL_MESSAGE_FLAG },
            };
        }

        if (typedInteraction.data?.name === "config") {
            return handleConfigCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "add_officer") {
            return handleAddOfficerCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "remove_officer") {
            return handleRemoveOfficerCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "list_officers") {
            return handleListOfficersCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "compare") {
            return handleCompareCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "claim_character") {
            return handleClaimCharacterCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "approve_character") {
            return handleApproveCharacterCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "reject_character") {
            return handleRejectCharacterCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "my_characters") {
            return handleMyCharactersCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "compare_privacy") {
            return handleComparePrivacyCommand(typedInteraction, options);
        }

        if (typedInteraction.data?.name === "recap") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: RECAP_RETIRED_MESSAGE,
                    flags: EPHEMERAL_MESSAGE_FLAG,
                },
            };
        }

        if (typedInteraction.data?.name === "report") {
            const url = getStringCommandOption(typedInteraction.data.options, "wcl_report_url");
            logger.info({ interactionId: typedInteraction.id, rawUrl: url ?? null }, "report url received");
            if (!url || typeof url !== "string") {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "Missing URL",
                        flags: EPHEMERAL_MESSAGE_FLAG,
                    },
                };
            }

            const backgroundTask = () => {
                void processReportInteraction(typedInteraction, options, url);
            };
            if (options.scheduleBackgroundTask) {
                options.scheduleBackgroundTask(backgroundTask);
            } else {
                queueMicrotask(backgroundTask);
            }
            return {
                type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
                data: { flags: EPHEMERAL_MESSAGE_FLAG },
            };
        }
    }

    if (typedInteraction.type === InteractionType.MESSAGE_COMPONENT) {
        const autoReportResponse = await handleAutoReportComponentInteraction(typedInteraction, options);
        if (autoReportResponse) {
            return autoReportResponse;
        }

        const customId = typedInteraction.data?.custom_id;
        if (typeof customId === "string" && customId.startsWith("recap:")) {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: RECAP_RETIRED_MESSAGE,
                    flags: EPHEMERAL_MESSAGE_FLAG,
                },
            };
        }
    }

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Unsupported interaction in MVP.", flags: 64 },
    };
};

const getStringCommandOption = (options: unknown, name: string): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};
