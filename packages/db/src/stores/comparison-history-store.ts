import { historyLimit } from "@wcl/domain";
import {
    ComparisonSnapshotModel,
    type ComparisonSnapshotDocument,
} from "../models/comparison-snapshot-model.js";

export type ComparisonSnapshotRecord = ComparisonSnapshotDocument;

export type SaveComparisonSnapshotInput = Omit<
    ComparisonSnapshotRecord,
    "createdAt" | "updatedAt"
>;

export interface FindCharacterHistoryInput {
    guildId: string;
    participantKey: string;
    before: Date;
    limit?: number;
}

export const COMPARISON_SNAPSHOT_HISTORY_PROJECTION = {
    _id: 0,
    guildId: 1,
    reportCode: 1,
    sourceUrl: 1,
    reportStartedAt: 1,
    participantKey: 1,
    warcraftLogsActorId: 1,
    warcraftLogsGuid: 1,
    characterName: 1,
    region: 1,
    realm: 1,
    server: 1,
    className: 1,
    specName: 1,
    role: 1,
    icon: 1,
    rankPercent: 1,
    damageTotal: 1,
    healingTotal: 1,
    deaths: 1,
    interrupts: 1,
    dispels: 1,
    bestBossName: 1,
    lowestBossName: 1,
} as const;

const resolveHistoryLimit = (limit: number | undefined): number => {
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
        return historyLimit;
    }

    const integerLimit = Math.floor(limit);
    return integerLimit > 0 ? integerLimit : historyLimit;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const assignOptionalString = (
    target: Record<string, unknown>,
    key: string,
    value: unknown,
) => {
    if (typeof value === "string") {
        target[key] = value;
    }
};

const assignOptionalNumber = (
    target: Record<string, unknown>,
    key: string,
    value: unknown,
) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        target[key] = value;
    }
};

const assignOptionalDate = (
    target: Record<string, unknown>,
    key: string,
    value: unknown,
) => {
    if (value instanceof Date) {
        target[key] = value;
    }
};

const toComparisonSnapshotRecord = (
    doc: unknown,
): ComparisonSnapshotRecord | null => {
    if (!isRecord(doc)) return null;

    if (
        typeof doc.guildId !== "string" ||
        typeof doc.reportCode !== "string" ||
        !(doc.reportStartedAt instanceof Date) ||
        typeof doc.participantKey !== "string"
    ) {
        return null;
    }

    const record: Record<string, unknown> = {
        guildId: doc.guildId,
        reportCode: doc.reportCode,
        reportStartedAt: doc.reportStartedAt,
        participantKey: doc.participantKey,
    };

    assignOptionalString(record, "sourceUrl", doc.sourceUrl);
    assignOptionalString(record, "zoneName", doc.zoneName);
    assignOptionalNumber(record, "warcraftLogsActorId", doc.warcraftLogsActorId);
    assignOptionalNumber(record, "warcraftLogsGuid", doc.warcraftLogsGuid);
    assignOptionalString(record, "characterName", doc.characterName);
    assignOptionalString(record, "region", doc.region);
    assignOptionalString(record, "realm", doc.realm);
    assignOptionalString(record, "server", doc.server);
    assignOptionalString(record, "className", doc.className);
    assignOptionalString(record, "specName", doc.specName);
    assignOptionalString(record, "role", doc.role);
    assignOptionalString(record, "icon", doc.icon);
    assignOptionalNumber(record, "rankPercent", doc.rankPercent);
    assignOptionalNumber(record, "damageTotal", doc.damageTotal);
    assignOptionalNumber(record, "healingTotal", doc.healingTotal);
    assignOptionalNumber(record, "deaths", doc.deaths);
    assignOptionalNumber(record, "interrupts", doc.interrupts);
    assignOptionalNumber(record, "dispels", doc.dispels);
    assignOptionalString(record, "bestBossName", doc.bestBossName);
    assignOptionalString(record, "lowestBossName", doc.lowestBossName);
    assignOptionalDate(record, "createdAt", doc.createdAt);
    assignOptionalDate(record, "updatedAt", doc.updatedAt);

    return record as unknown as ComparisonSnapshotRecord;
};

export class MongoComparisonHistoryStore {
    public async saveComparisonSnapshot(
        input: SaveComparisonSnapshotInput,
    ): Promise<ComparisonSnapshotRecord> {
        const saved = await ComparisonSnapshotModel.findOneAndUpdate(
            {
                guildId: input.guildId,
                reportCode: input.reportCode,
                participantKey: input.participantKey,
            },
            {
                $set: input,
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            },
        ).lean();

        const parsed = toComparisonSnapshotRecord(saved);
        if (!parsed) {
            throw new Error("Failed to persist comparison snapshot.");
        }

        return parsed;
    }

    public async findCharacterHistory(
        input: FindCharacterHistoryInput,
    ): Promise<ComparisonSnapshotRecord[]> {
        const found = await ComparisonSnapshotModel.find({
            guildId: input.guildId,
            participantKey: input.participantKey,
            reportStartedAt: { $lt: input.before },
        })
            .sort({ reportStartedAt: -1 })
            .limit(resolveHistoryLimit(input.limit))
            .select(COMPARISON_SNAPSHOT_HISTORY_PROJECTION)
            .lean();

        if (!Array.isArray(found)) {
            return [];
        }

        return found
            .map((doc) => toComparisonSnapshotRecord(doc))
            .filter((doc): doc is ComparisonSnapshotRecord => doc !== null);
    }
}
