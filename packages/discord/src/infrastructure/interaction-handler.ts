import { InteractionResponseType, InteractionType } from "discord-interactions";
import { createLogger } from "@wcl/shared";
import type { HandleOptions } from "../types.js";
import {
    handleApproveCharacterCommand,
    handleClaimCharacterCommand,
    handleComparePrivacyCommand,
    handleMyCharactersCommand,
    handleRejectCharacterCommand,
} from "../commands/character-claims.js";
import { handleCompareCommand } from "../commands/compare.js";
import { handleConfigCommand } from "../commands/config.js";
import {
    handleRecapComponentInteraction,
    processRecapInteraction,
} from "../commands/recap.js";

const logger = createLogger("discord");
const EPHEMERAL_MESSAGE_FLAG = 64;

export const handleInteraction = async (
    interaction: unknown,
    options: HandleOptions,
): Promise<unknown> => {
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
            const url = getStringCommandOption(typedInteraction.data.options, "url");
            logger.info(
                { interactionId: typedInteraction.id, rawUrl: url ?? null },
                "recap url received",
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

            const backgroundTask = () => {
                void processRecapInteraction(typedInteraction, options, url);
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
        const recapResponse = await handleRecapComponentInteraction(
            typedInteraction,
            options,
        );
        if (recapResponse) {
            return recapResponse;
        }
    }

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Unsupported interaction in MVP.", flags: 64 },
    };
};

const getStringCommandOption = (options: unknown, name: string): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find(
        (option) => typeof option === "object" && option !== null && (option as { name?: unknown }).name === name,
    ) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};
