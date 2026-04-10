import { JobModel, MongoTrendTrackingService, connectMongo } from "@wcl/db";
import { createLogger } from "@wcl/shared";
import { parseWorkerEnv } from "./config.js";
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

const env = parseWorkerEnv(process.env);
const logger = createLogger("worker");

export interface Queue {
    enqueue(type: string, payload: unknown, runAt?: Date): Promise<void>;
    claimNextRunnableJob(): Promise<QueueJob | null>;
    completeJob(jobId: unknown): Promise<void>;
    markJobForRetry(jobId: unknown, attempts: number, error: unknown): Promise<void>;
    markJobFailed(jobId: unknown, error: unknown): Promise<void>;
}

interface QueueJob {
    _id: unknown;
    type: string;
    payload: unknown;
    attempts: number;
}

const POLL_INTERVAL_MS = 1500;
const LEASE_DURATION_MS = 30_000;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 60_000;

const toQueueJob = (value: unknown): QueueJob | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    if (typeof row.type !== "string") return null;
    return {
        _id: row._id,
        type: row.type,
        payload: row.payload,
        attempts: typeof row.attempts === "number" ? row.attempts : 0,
    };
};

class MongoQueue implements Queue {
    public async enqueue(
        type: string,
        payload: unknown,
        runAt = new Date(),
    ): Promise<void> {
        await JobModel.create({ type, payload, runAt, status: "pending" });
    }

    public async claimNextRunnableJob(): Promise<QueueJob | null> {
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS);

        // Runnable jobs are either pending and due, or stale running jobs with expired leases.
        const row = await JobModel.findOneAndUpdate(
            {
                attempts: { $lt: MAX_ATTEMPTS },
                $or: [
                    { status: "pending", runAt: { $lte: now } },
                    {
                        status: "running",
                        $or: [
                            { leaseExpiresAt: { $lte: now } },
                            { leaseExpiresAt: { $exists: false } },
                        ],
                    },
                ],
            },
            {
                $set: {
                    status: "running",
                    leaseExpiresAt,
                    startedAt: now,
                },
                $inc: { attempts: 1 },
            },
            { sort: { runAt: 1 }, new: true },
        );
        return toQueueJob(row);
    }

    public async completeJob(jobId: unknown): Promise<void> {
        await JobModel.updateOne(
            { _id: jobId, status: "running" },
            {
                $set: { status: "completed", completedAt: new Date() },
                $unset: { leaseExpiresAt: "" },
            },
        );
    }

    public async markJobForRetry(
        jobId: unknown,
        attempts: number,
        error: unknown,
    ): Promise<void> {
        const backoffDelay = Math.min(
            RETRY_MAX_DELAY_MS,
            RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1),
        );
        await JobModel.updateOne(
            { _id: jobId, status: "running" },
            {
                $set: {
                    status: "pending",
                    runAt: new Date(Date.now() + backoffDelay),
                    lastError: String(error),
                },
                $unset: { leaseExpiresAt: "" },
            },
        );
    }

    public async markJobFailed(jobId: unknown, error: unknown): Promise<void> {
        await JobModel.updateOne(
            { _id: jobId, status: "running" },
            {
                $set: { status: "failed", lastError: String(error) },
                $unset: { leaseExpiresAt: "" },
            },
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

const handlers: Record<string, (payload: unknown) => Promise<void>> = {
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
    const job = await queue.claimNextRunnableJob();
    if (!job) return;

    try {
        const handler = handlers[job.type];
        if (!handler) throw new Error(`No handler for ${job.type}`);
        await handler(job.payload);
        await queue.completeJob(job._id);
    } catch (error) {
        logger.error({ error, jobId: job._id }, "job failed");
        if (job.attempts < MAX_ATTEMPTS) {
            await queue.markJobForRetry(job._id, job.attempts, error);
            return;
        }
        await queue.markJobFailed(job._id, error);
    }
};

const start = async () => {
    await connectMongo(env.MONGODB_URI);
    logger.info("worker started");

    // Serialized polling loop: next poll starts only after the previous unit of work completes.
    while (true) {
        await processNext();
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
};

start().catch((error) => {
    logger.fatal({ error }, "worker startup failed");
    process.exit(1);
});
