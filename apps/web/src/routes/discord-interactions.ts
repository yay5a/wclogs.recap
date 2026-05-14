import { verifyKey } from "discord-interactions";
import type { FastifyPluginAsync } from "fastify";
import type {
    AutoReportDuplicateTrackingService,
    AutoReportPromptStateService,
    CharacterClaimStore,
} from "@wcl/discord";
import type { BotActivityStore, GuildConfigStore } from "@wcl/domain";
import { handleInteraction } from "@wcl/discord";
import type { createLogger } from "@wcl/shared";
import type { WclClient } from "@wcl/wcl-client";
import type { WebEnv } from "../config.js";

type DiscordInteractionRouteOptions = {
    env: WebEnv;
    wclClient: WclClient;
    guildConfigStore: GuildConfigStore;
    autoReportPromptStateService: AutoReportPromptStateService;
    autoReportDuplicateTrackingService: AutoReportDuplicateTrackingService;
    characterClaimStore: CharacterClaimStore;
    botActivityStore?: BotActivityStore | undefined;
    logger: ReturnType<typeof createLogger>;
};

export const registerDiscordInteractionRoutes: FastifyPluginAsync<
    DiscordInteractionRouteOptions
> = async (app, options) => {
    app.post(
        "/discord/interactions",
        {
            config: {
                rawBody: true,
            },
        },
        async (req, reply) => {
            try {
                const signature = req.headers["x-signature-ed25519"];
                const timestamp = req.headers["x-signature-timestamp"];
                if (typeof signature !== "string" || typeof timestamp !== "string") {
                    return reply.code(401).send({ error: "Missing Discord headers" });
                }
                const rawBody =
                    typeof (req as { rawBody?: unknown }).rawBody === "string"
                        ? (req as { rawBody: string }).rawBody
                        : "";

                const isValid = await verifyKey(
                    rawBody,
                    signature,
                    timestamp,
                    options.env.DISCORD_PUBLIC_KEY,
                );

                options.logger.info({ isValid }, "discord signature result");

                if (!isValid) {
                    return reply.code(401).send({ error: "Invalid signature" });
                }

                const body = req.body as Record<string, unknown>;

                if (body?.type === 1) {
                    return reply.code(200).send({ type: 1 });
                }

                const backgroundTasks: Array<() => void> = [];
                reply.raw.once("finish", () => {
                    for (const task of backgroundTasks) {
                        setImmediate(task);
                    }
                });

                const response = await handleInteraction(body, {
                    wclClient: options.wclClient,
                    guildConfigStore: options.guildConfigStore,
                    autoReportPromptStateService: options.autoReportPromptStateService,
                    autoReportDuplicateTrackingService: options.autoReportDuplicateTrackingService,
                    characterClaimStore: options.characterClaimStore,
                    botActivityStore: options.botActivityStore,
                    scheduleBackgroundTask: (task) => {
                        backgroundTasks.push(task);
                    },
                });
                return reply.send(response);
            } catch (error) {
                options.logger.error({ error }, "interaction handling failed");
                return reply.code(500).send({ error: "Internal server error" });
            }
        },
    );
};
