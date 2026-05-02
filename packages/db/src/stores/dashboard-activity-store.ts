import type { BotActivityEvent, BotActivityStore } from "@wcl/domain";
import { DashboardActivityModel } from "../models/dashboard-activity-model.js";

const DEFAULT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type DashboardActivityRecord = BotActivityEvent & {
    expiresAt: Date;
    archivedAt?: Date;
};

const toActivityRecord = (doc: unknown): DashboardActivityRecord | null => {
    if (typeof doc !== "object" || doc === null) return null;
    const raw = doc as Record<string, unknown>;
    if (
        typeof raw.guildId !== "string" ||
        typeof raw.kind !== "string" ||
        !(raw.createdAt instanceof Date) ||
        !(raw.expiresAt instanceof Date)
    ) {
        return null;
    }

    return {
        guildId: raw.guildId,
        ...(typeof raw.channelId === "string" ? { channelId: raw.channelId } : {}),
        ...(typeof raw.sourceMessageId === "string" ? { sourceMessageId: raw.sourceMessageId } : {}),
        ...(typeof raw.actor === "object" && raw.actor !== null
            ? { actor: raw.actor as BotActivityEvent["actor"] }
            : {}),
        kind: raw.kind as DashboardActivityRecord["kind"],
        ...(typeof raw.reportCode === "string" ? { reportCode: raw.reportCode } : {}),
        ...(typeof raw.sourceUrl === "string" ? { sourceUrl: raw.sourceUrl } : {}),
        ...(typeof raw.discordMessageUrl === "string"
            ? { discordMessageUrl: raw.discordMessageUrl }
            : {}),
        ...(typeof raw.characterLabel === "string" ? { characterLabel: raw.characterLabel } : {}),
        ...(typeof raw.targetDiscordUserId === "string"
            ? { targetDiscordUserId: raw.targetDiscordUserId }
            : {}),
        ...(typeof raw.idempotencyKey === "string" ? { idempotencyKey: raw.idempotencyKey } : {}),
        createdAt: raw.createdAt,
        expiresAt: raw.expiresAt,
        ...(raw.archivedAt instanceof Date ? { archivedAt: raw.archivedAt } : {}),
    };
};

export class MongoDashboardActivityStore implements BotActivityStore {
    public async recordActivity(event: BotActivityEvent): Promise<void> {
        const expiresAt = new Date(event.createdAt.getTime() + DEFAULT_RETENTION_MS);
        if (event.idempotencyKey) {
            await DashboardActivityModel.findOneAndUpdate(
                { idempotencyKey: event.idempotencyKey },
                {
                    $setOnInsert: {
                        ...event,
                        expiresAt,
                    },
                },
                { upsert: true },
            );
            return;
        }

        await DashboardActivityModel.create({
            ...event,
            expiresAt,
        });
    }

    public async listActivity(input: {
        guildId: string;
        limit?: number;
    }): Promise<DashboardActivityRecord[]> {
        const found = await DashboardActivityModel.find({
            guildId: input.guildId,
            archivedAt: { $exists: false },
        })
            .sort({ createdAt: -1 })
            .limit(Math.min(Math.max(input.limit ?? 50, 1), 100))
            .lean();

        return Array.isArray(found)
            ? found
                  .map((doc) => toActivityRecord(doc))
                  .filter((doc): doc is DashboardActivityRecord => doc !== null)
            : [];
    }

    public async archiveGuildActivity(guildId: string, archivedAt = new Date()): Promise<void> {
        await DashboardActivityModel.updateMany(
            { guildId, archivedAt: { $exists: false } },
            { $set: { archivedAt } },
        );
    }
}
