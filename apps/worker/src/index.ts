import { JobModel, MongoTrendTrackingService, connectMongo } from "@wcl/db";
import { createLogger, parseEnv } from "@wcl/shared";
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
const logger = createLogger("worker");

export interface Queue {
    enqueue(type: string, payload: unknown, runAt?: Date): Promise<void>;
    pollReadyJob(): Promise<any | null>;
}

class MongoQueue implements Queue {
    public async enqueue(
        type: string,
        payload: unknown,
        runAt = new Date(),
    ): Promise<void> {
        await JobModel.create({ type, payload, runAt, status: "pending" });
    }

    public async pollReadyJob(): Promise<any | null> {
        return JobModel.findOneAndUpdate(
            { status: "pending", runAt: { $lte: new Date() } },
            { $set: { status: "running" }, $inc: { attempts: 1 } },
            { sort: { runAt: 1 }, new: true },
        );
    }
}

const queue = new MongoQueue();
const trendTrackingService = new MongoTrendTrackingService();

type RecomputeTrendsPayload = {
    guildId: string;
};

const parseRecomputeTrendsPayload = (payload: unknown): RecomputeTrendsPayload => {
    if (!payload || typeof payload !== "object") {
        throw new Error("Invalid recompute_trends payload: expected object");
    }

    const candidate = payload as Record<string, unknown>;
    const guildId = candidate.guildId;

    if (typeof guildId !== "string" || guildId.trim().length === 0) {
        throw new Error(
            "Invalid recompute_trends payload: guildId must be a non-empty string",
        );
    }

    return { guildId: guildId.trim() };
};

const handlers: Record<string, (payload: any) => Promise<void>> = {
    recompute_trends: async (payload: unknown) => {
        const { guildId } = parseRecomputeTrendsPayload(payload);
        logger.info({ guildId }, "recompute_trends started");
        await trendTrackingService.recomputeTrendsForGuild(guildId);
        logger.info({ guildId }, "recompute_trends completed");
    },
    sync_subscription: async () => {
        // TODO: subscription sync integration
    },
};

const processNext = async (): Promise<void> => {
    const job = await queue.pollReadyJob();
    if (!job) return;

    try {
        const handler = handlers[job.type];
        if (!handler) throw new Error(`No handler for ${job.type}`);
        await handler(job.payload);
        await JobModel.updateOne(
            { _id: job._id },
            { $set: { status: "completed" } },
        );
    } catch (error) {
        logger.error({ error, jobId: job._id }, "job failed");
        await JobModel.updateOne(
            { _id: job._id },
            { $set: { status: "failed", lastError: String(error) } },
        );
    }
};

const start = async () => {
    await connectMongo(env.MONGODB_URI);
    logger.info("worker started");
    setInterval(() => {
        void processNext();
    }, 1500);
};

start().catch((error) => {
    logger.fatal({ error }, "worker startup failed");
    process.exit(1);
});
