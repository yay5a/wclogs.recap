import { InteractionResponseType, InteractionType } from "discord-interactions";
import { createLogger } from "@wcl/shared";
import type { HandleOptions } from "../types.js";
import { handleConfigCommand, getNestedStringOption } from "../commands/config.js";
import {
    handleRecapComponentInteraction,
    processReportRecapInteraction,
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

        if (typedInteraction.data?.name === "report") {
            const url = getNestedStringOption(
                typedInteraction.data.options,
                "recap",
                "url",
            );
            logger.info(
                { interactionId: typedInteraction.id, rawUrl: url ?? null },
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

            const backgroundTask = () => {
                void processReportRecapInteraction(typedInteraction, options, url);
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
