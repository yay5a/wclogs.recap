import type { RecapSummary } from "@wcl/domain";
import { RecapPreviewStateModel } from "../index.js";

export interface RecapPreviewStateRecord {
    guildId: string;
    channelId: string;
    reportCode: string;
    sourceUrl: string;
    summaryPayload: RecapSummary;
    createdByUserId: string;
    interactionId?: string;
    messageId?: string;
    createdAt: Date;
    expiresAt: Date;
}

export interface SaveRecapPreviewStateInput {
    guildId: string;
    channelId: string;
    reportCode: string;
    sourceUrl: string;
    summaryPayload: RecapSummary;
    createdByUserId: string;
    interactionId?: string;
    messageId?: string;
    createdAt: Date;
    expiresAt: Date;
}

export interface PreviewStateLookup {
    reportCode: string;
    guildId: string;
}

const isRecapSummary = (value: unknown): value is RecapSummary => {
    if (!value || typeof value !== "object") return false;
    const raw = value as Record<string, unknown>;

    const isGameFamily =
        raw.gameFamily === "retail" || raw.gameFamily === "mop_classic";
    const isCompareMode =
        raw.compareModeUsed === "character" || raw.compareModeUsed === "mixed";
    const isVisibility =
        raw.accountabilityVisibility === "off" ||
        raw.accountabilityVisibility === "officers-only" ||
        raw.accountabilityVisibility === "shareable";
    const isCoachingShareability =
        raw.coachingShareability === "private" ||
        raw.coachingShareability === "shareable";
    const isRecapPostMode =
        raw.recapPostMode === "preview-and-post" ||
        raw.recapPostMode === "preview-only";

    return (
        typeof raw.reportTitle === "string" &&
        typeof raw.reportDateISO === "string" &&
        isGameFamily &&
        typeof raw.bossesKilled === "number" &&
        isCompareMode &&
        isVisibility &&
        isCoachingShareability &&
        isRecapPostMode &&
        Array.isArray(raw.topOverallParsers) &&
        Array.isArray(raw.bossHighlights) &&
        Array.isArray(raw.raidSuperlatives) &&
        typeof raw.teamNote === "string"
    );
};

const toRecapPreviewStateRecord = (
    doc: unknown,
): RecapPreviewStateRecord | null => {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    if (
        typeof raw.guildId !== "string" ||
        typeof raw.channelId !== "string" ||
        typeof raw.reportCode !== "string" ||
        typeof raw.sourceUrl !== "string" ||
        typeof raw.createdByUserId !== "string" ||
        !(raw.createdAt instanceof Date) ||
        !(raw.expiresAt instanceof Date)
    ) {
        return null;
    }

    if (!isRecapSummary(raw.summaryPayload)) {
        return null;
    }

    const record: RecapPreviewStateRecord = {
        guildId: raw.guildId,
        channelId: raw.channelId,
        reportCode: raw.reportCode,
        sourceUrl: raw.sourceUrl,
        summaryPayload: raw.summaryPayload,
        createdByUserId: raw.createdByUserId,
        createdAt: raw.createdAt,
        expiresAt: raw.expiresAt,
    };
    if (typeof raw.interactionId === "string") {
        record.interactionId = raw.interactionId;
    }
    if (typeof raw.messageId === "string") {
        record.messageId = raw.messageId;
    }
    return record;
};

export class MongoRecapPreviewStateStore {
    public async savePreviewState(
        input: SaveRecapPreviewStateInput,
    ): Promise<RecapPreviewStateRecord> {
        const saved = await RecapPreviewStateModel.findOneAndUpdate(
            { guildId: input.guildId, reportCode: input.reportCode },
            {
                $set: {
                    guildId: input.guildId,
                    channelId: input.channelId,
                    reportCode: input.reportCode,
                    sourceUrl: input.sourceUrl,
                    summaryPayload: input.summaryPayload,
                    createdByUserId: input.createdByUserId,
                    interactionId: input.interactionId,
                    messageId: input.messageId,
                    createdAt: input.createdAt,
                    expiresAt: input.expiresAt,
                },
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            },
        ).lean();

        const parsed = toRecapPreviewStateRecord(saved);
        if (!parsed) {
            throw new Error("Failed to persist recap preview state.");
        }
        return parsed;
    }

    public async getValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<RecapPreviewStateRecord | null> {
        const found = await RecapPreviewStateModel.findOne({
            reportCode: lookup.reportCode,
            guildId: lookup.guildId,
            expiresAt: { $gt: new Date() },
        }).lean();
        return toRecapPreviewStateRecord(found);
    }

    public async consumeValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<RecapPreviewStateRecord | null> {
        const consumed = await RecapPreviewStateModel.findOneAndDelete({
            reportCode: lookup.reportCode,
            guildId: lookup.guildId,
            expiresAt: { $gt: new Date() },
        }).lean();
        return toRecapPreviewStateRecord(consumed);
    }

    public async deletePreviewState(lookup: PreviewStateLookup): Promise<void> {
        await RecapPreviewStateModel.deleteOne({
            reportCode: lookup.reportCode,
            guildId: lookup.guildId,
        });
    }
}
