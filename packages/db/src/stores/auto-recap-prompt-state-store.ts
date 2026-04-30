import type { GameFamily } from "@wcl/domain";
import { AutoRecapPromptStateModel } from "../index.js";

export interface AutoRecapPromptStateRecord {
    guildId: string;
    channelId: string;
    reportCode: string;
    gameFamily: GameFamily;
    sourceUrl: string;
    sourceMessageId: string;
    sourceAuthorId: string;
    promptMessageId: string;
    expiresAt: Date;
}

type SaveAutoRecapPromptStateInput = AutoRecapPromptStateRecord;

const isGameFamily = (value: unknown): value is GameFamily =>
    value === "retail" || value === "mop_classic";

const toPromptStateRecord = (doc: unknown): AutoRecapPromptStateRecord | null => {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    if (
        typeof raw.guildId !== "string" ||
        typeof raw.channelId !== "string" ||
        typeof raw.reportCode !== "string" ||
        !isGameFamily(raw.gameFamily) ||
        typeof raw.sourceUrl !== "string" ||
        typeof raw.sourceMessageId !== "string" ||
        typeof raw.sourceAuthorId !== "string" ||
        typeof raw.promptMessageId !== "string" ||
        !(raw.expiresAt instanceof Date)
    ) {
        return null;
    }

    return {
        guildId: raw.guildId,
        channelId: raw.channelId,
        reportCode: raw.reportCode,
        gameFamily: raw.gameFamily,
        sourceUrl: raw.sourceUrl,
        sourceMessageId: raw.sourceMessageId,
        sourceAuthorId: raw.sourceAuthorId,
        promptMessageId: raw.promptMessageId,
        expiresAt: raw.expiresAt,
    };
};

export class MongoAutoRecapPromptStateStore {
    public async savePromptState(
        input: SaveAutoRecapPromptStateInput,
    ): Promise<AutoRecapPromptStateRecord> {
        const saved = await AutoRecapPromptStateModel.findOneAndUpdate(
            { sourceMessageId: input.sourceMessageId },
            { $set: input },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean();

        const parsed = toPromptStateRecord(saved);
        if (!parsed) throw new Error("Failed to persist auto recap prompt state.");
        return parsed;
    }

    public async getValidPromptState(
        sourceMessageId: string,
    ): Promise<AutoRecapPromptStateRecord | null> {
        const found = await AutoRecapPromptStateModel.findOne({
            sourceMessageId,
            expiresAt: { $gt: new Date() },
        }).lean();
        return toPromptStateRecord(found);
    }

    public async consumeValidPromptState(
        sourceMessageId: string,
    ): Promise<AutoRecapPromptStateRecord | null> {
        const consumed = await AutoRecapPromptStateModel.findOneAndDelete({
            sourceMessageId,
            expiresAt: { $gt: new Date() },
        }).lean();
        return toPromptStateRecord(consumed);
    }
}
