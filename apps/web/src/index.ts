import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { verifyKey } from "discord-interactions";
import {
    connectMongo,
    MongoAccountabilityViewService,
    MongoCoachingViewService,
    MongoGuildConfigStore,
    MongoRecapPreviewStateStore,
    MongoTrendTrackingService,
    ReportCacheModel,
} from "@wcl/db";
import {
    DiscordCommandRegistrationError,
    handleInteraction,
    registerGlobalCommands,
    registerGuildCommands,
} from "@wcl/discord";
import { createLogger } from "@wcl/shared";
import { parseWebEnv } from "./config.js";
import { WclClient, type ReportCacheStore } from "@wcl/wcl-client";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, "../../../.env");

if (existsSync(envPath)) {
    loadEnvFile(envPath);
}

const env = parseWebEnv(process.env);
const logger = createLogger("web");
const app = Fastify({ logger: false });

const reportCacheStore: ReportCacheStore = {
    async getByReportCode(reportCode: string) {
        return ReportCacheModel.findOne({ reportCode }).lean();
    },
    async upsert(entry) {
        await ReportCacheModel.findOneAndUpdate(
            { reportCode: entry.reportCode },
            entry,
            { upsert: true },
        );
    },
};

await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
});

const guildConfigStore = new MongoGuildConfigStore();
const recapPreviewStateService = new MongoRecapPreviewStateStore();
const coachingViewService = new MongoCoachingViewService();
const accountabilityViewService = new MongoAccountabilityViewService();
const trendTrackingService = new MongoTrendTrackingService();

app.get("/health", async () => ({ status: "ok" }));

app.get("/api/auth/wcl/login", async (_request, reply) => {
    const clientId = process.env.WCL_CLIENT_ID;
    const redirectUri = process.env.WCL_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return reply.code(500).send({
            message: "Missing WCL_CLIENT_ID or WCL_REDIRECT_URI",
        });
    }

    const authorizeUrl = new URL(
        "https://www.warcraftlogs.com/oauth/authorize",
    );
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");

    return;

    reply.redirect(authorizeUrl.toString());
});

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
            if (
                typeof signature !== "string" ||
                typeof timestamp !== "string"
            ) {
                return reply
                    .code(401)
                    .send({ error: "Missing Discord headers" });
            }
            const rawBody =
                typeof (req as { rawBody?: unknown }).rawBody === "string"
                    ? (req as { rawBody: string }).rawBody
                    : "";

            const isValid = await verifyKey(
                rawBody,
                signature,
                timestamp,
                env.DISCORD_PUBLIC_KEY,
            );

            logger.info({ isValid }, "discord signature result");

            if (!isValid)
                return reply.code(401).send({ error: "Invalid signature" });

            const body = req.body as Record<string, unknown>;

            if (body?.type === 1) {
                return reply.code(200).send({ type: 1 });
            }

            const response = await handleInteraction(body, {
                wclClient,
                guildConfigStore,
                recapPreviewStateService,
                previewStateTtlSeconds: env.PREVIEW_STATE_TTL_SECONDS,
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            });
            return reply.send(response);
        } catch (error) {
            logger.error({ error }, "interaction handling failed");
            return reply.code(500).send({ error: "Internal server error" });
        }
    },
);

const pickGuildId = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

app.post("/discord/register-commands", async (req, reply) => {
    try {
        const body =
            typeof req.body === "object" && req.body !== null
                ? (req.body as Record<string, unknown>)
                : undefined;
        const query = req.query as Record<string, unknown> | undefined;

        const guildId =
            pickGuildId(query?.guildId) ?? pickGuildId(body?.guildId);

        if (guildId) {
            await registerGuildCommands(
                env.DISCORD_APPLICATION_ID,
                env.DISCORD_BOT_TOKEN,
                guildId,
            );
        } else {
            await registerGlobalCommands(
                env.DISCORD_APPLICATION_ID,
                env.DISCORD_BOT_TOKEN,
            );
        }

        return reply.send({
            status: "registered",
            scope: guildId ? "guild" : "global",
            guildId: guildId ?? null,
        });
    } catch (error) {
        logger.error({ error }, "register commands failed");

        if (error instanceof DiscordCommandRegistrationError) {
            return reply.code(502).send({
                error: "Discord command registration failed",
                scope: error.details.targetScope,
                discordStatus: error.details.status,
                discordStatusText: error.details.statusText,
                discordErrorBody: error.details.responseBody,
            });
        }

        if (error instanceof Error) {
            return reply.code(400).send({
                error: "Command validation failed",
                message: error.message,
            });
        }

        return reply.code(500).send({ error: "Internal server error" });
    }
});

const start = async () => {
    await connectMongo(env.MONGODB_URI);
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info({ port: env.PORT }, "web app started");
};

start().catch((error) => {
    logger.fatal({ error }, "web app failed to start");
    process.exit(1);
});

process.on("SIGTERM", async () => {
    logger.info("received SIGTERM");
    await app.close();
    process.exit(0);
});
