import Fastify from "fastify";
import { verifyKey } from "discord-interactions";
import {
    connectMongo,
    MongoAccountabilityViewService,
    MongoCoachingViewService,
    MongoGuildConfigStore,
    MongoTrendTrackingService,
} from "@wcl/db";
import { handleInteraction, registerCommands } from "@wcl/discord";
import { createLogger, parseEnv } from "@wcl/shared";
import { WclClient } from "@wcl/wcl-client";
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

const env = parseEnv(process.env);
const logger = createLogger("web");
const app = Fastify({ logger: false });

const wclClient = new WclClient({
    clientId: env.WCL_CLIENT_ID,
    clientSecret: env.WCL_CLIENT_SECRET,
    apiBaseUrl: env.WCL_API_BASE_URL,
});

const guildConfigStore = new MongoGuildConfigStore();
const coachingViewService = new MongoCoachingViewService();
const accountabilityViewService = new MongoAccountabilityViewService();
const trendTrackingService = new MongoTrendTrackingService();
app.get("/health", async () => ({ status: "ok" }));

app.post("/discord/interactions", async (req, reply) => {
    try {
        const signature = req.headers["x-signature-ed25519"];
        const timestamp = req.headers["x-signature-timestamp"];
        if (typeof signature !== "string" || typeof timestamp !== "string") {
            return reply.code(401).send({ error: "Missing Discord headers" });
        }

        const rawBody = JSON.stringify(req.body);
        const isValid = verifyKey(
            rawBody,
            signature,
            timestamp,
            env.DISCORD_PUBLIC_KEY,
        );
        if (!isValid)
            return reply.code(401).send({ error: "Invalid signature" });
        const response = await handleInteraction(req.body, {
            wclClient,
            guildConfigStore,
            coachingViewService,
            accountabilityViewService,
            trendTrackingService,
        });
        return reply.send(response);
    } catch (error) {
        logger.error({ error }, "interaction handling failed");
        return reply.code(500).send({ error: "Internal server error" });
    }
});

app.post("/discord/register-commands", async (_req, reply) => {
    try {
        await registerCommands(
            env.DISCORD_APPLICATION_ID,
            env.DISCORD_BOT_TOKEN,
        );
        return reply.send({ status: "registered" });
    } catch (error) {
        logger.error({ error }, "register commands failed");
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
