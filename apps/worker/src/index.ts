import {
    JobModel,
    MongoAutoReportDuplicateTrackingStore,
    MongoAutoReportPromptStateStore,
    MongoDashboardActivityStore,
    MongoGuildConfigStore,
    MongoTrendTrackingService,
    MongoWclUserAuthStore,
    connectMongo,
    migrateCharacterClaimIdentityFields,
    migrateWclUserAuthDiscordUserIndex,
} from "@wcl/db";
import type { AutoReportSendableChannel } from "@wcl/discord";
import { REPORT_RUNTIME_FINGERPRINT, handleAutoReportMessageCreate } from "@wcl/discord";
import { createLogger } from "@wcl/shared";
import { WclClient } from "@wcl/wcl-client";
import { ChannelType, Client, Events, GatewayIntentBits, type Guild } from "discord.js";
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
const SAFE_ALLOWED_MENTIONS = { parse: [] as string[] };
const WORKER_PACKAGE_ID = "@wcl/worker@0.1.0";
const WORKER_APP_IDENTIFIER = "worker-gateway";

const resolveRuntimeModule = (specifier: string): string | undefined => {
    try {
        return import.meta.resolve(specifier);
    } catch {
        return undefined;
    }
};

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
const guildConfigStore = new MongoGuildConfigStore();
const autoReportPromptStateService = new MongoAutoReportPromptStateStore();
const autoReportDuplicateTrackingService = new MongoAutoReportDuplicateTrackingStore();
const dashboardActivityStore = new MongoDashboardActivityStore();
const wclUserAuthStore = new MongoWclUserAuthStore({
    encryptionKey: env.WCL_TOKEN_ENCRYPTION_KEY,
});

const wclClient = new WclClient({
    clientId: env.WCL_CLIENT_ID,
    clientSecret: env.WCL_CLIENT_SECRET,
    apiBaseUrl: env.WCL_API_BASE_URL,
    ...(env.WCL_USER_API_BASE_URL ? { userApiBaseUrl: env.WCL_USER_API_BASE_URL } : {}),
    wclUserAuthStore,
});

class InMemoryFailureThrottle {
    private readonly entries = new Map<string, number>();

    public shouldPostFailure(key: string, ttlMs: number): boolean {
        const now = Date.now();
        const existingExpiresAt = this.entries.get(key);
        if (existingExpiresAt && existingExpiresAt > now) return false;
        this.entries.set(key, now + ttlMs);
        for (const [entryKey, expiresAt] of this.entries.entries()) {
            if (expiresAt <= now) this.entries.delete(entryKey);
        }
        return true;
    }
}

const failureThrottle = new InMemoryFailureThrottle();

type DiscordSendableChannel = {
    type?: ChannelType;
    send(body: Record<string, unknown>): Promise<{ id: string }>;
    isSendable?: () => boolean;
};

const isDiscordSendableTextChannel = (value: unknown): value is DiscordSendableChannel => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<DiscordSendableChannel>;
    const type = candidate.type;
    const isTextType = type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement;
    const sendable =
        typeof candidate.isSendable === "function" ? candidate.isSendable() : true;
    return isTextType && sendable && typeof candidate.send === "function";
};

const toAutoReportChannel = (channel: unknown): AutoReportSendableChannel | null => {
    if (!isDiscordSendableTextChannel(channel)) return null;
    return {
        send: async (body: Record<string, unknown>) => {
            const sent = await channel.send(body);
            return { id: sent.id };
        },
    };
};

const sendGuildCreateNotice = async (guild: Guild): Promise<void> => {
    const content = [
        "Thanks for adding **wclogs.report**.",
        "",
        "Run `/config` to check setup status.",
        "",
        "To enable passive Warcraft Logs detection, run:",
        "`/config auto_report_channel:#raid-logs`",
        "",
        "You can also use `/report <wcl_report_url>` anytime.",
    ].join("\n");

    const channel =
        toAutoReportChannel(guild.systemChannel) ??
        toAutoReportChannel(
            guild.channels.cache.find((candidate) => isDiscordSendableTextChannel(candidate)),
        );
    if (!channel) {
        logger.info({ guildId: guild.id }, "guildCreate setup notice skipped; no sendable text channel");
        return;
    }
    try {
        await channel.send({ content, allowed_mentions: SAFE_ALLOWED_MENTIONS });
    } catch (error) {
        logger.warn({ guildId: guild.id, error }, "guildCreate setup notice failed");
    }
};

const startDiscordGateway = async (): Promise<Client> => {
    logger.info(
        {
            intents: ["Guilds", "GuildMessages", "MessageContent"],
            cwd: process.cwd(),
            packageId: WORKER_PACKAGE_ID,
            workerAppIdentifier: WORKER_APP_IDENTIFIER,
            reportRuntimeFingerprint: REPORT_RUNTIME_FINGERPRINT,
            reportPath: "gateway-startup",
            publicBodySent: false,
            discordModuleResolved: resolveRuntimeModule("@wcl/discord"),
        },
        "starting Discord Gateway; MessageContent intent requested",
    );
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });
    client.on(Events.MessageCreate, (message) => {
        void handleAutoReportMessageCreate({
            message: {
                guildId: message.guildId,
                channelId: message.channelId,
                messageId: message.id,
                authorId: message.author.id,
                authorBot: message.author.bot,
                content: message.content,
            },
            channel: toAutoReportChannel(message.channel),
            handleOptions: {
                wclClient,
                guildConfigStore,
                autoReportPromptStateService,
                autoReportDuplicateTrackingService,
                botActivityStore: dashboardActivityStore,
            },
            failureThrottle,
        });
    });
    client.on(Events.GuildCreate, (guild) => {
        void sendGuildCreateNotice(guild);
    });
    client.once(Events.ClientReady, (readyClient) => {
        logger.info(
            { userId: readyClient.user.id, guildCount: readyClient.guilds.cache.size },
            "Discord Gateway ready",
        );
    });
    await client.login(env.DISCORD_BOT_TOKEN);
    return client;
};

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
    await migrateCharacterClaimIdentityFields();
    await migrateWclUserAuthDiscordUserIndex();
    await startDiscordGateway();
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
