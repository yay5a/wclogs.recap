import type { GameFamily } from "@wcl/domain";
import {
    GuildReportMetadataCursorModel,
    GuildReportMetadataModel,
} from "../models/guild-report-metadata-model.js";

export interface GuildReportMetadataScope {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    gameFamily: GameFamily;
}

export interface GuildReportMetadataInputRow {
    reportCode: string;
    title?: string;
    owner?: string;
    zoneId?: number;
    startTime: number;
    endTime?: number;
}

export type GuildReportMetadataRecord = GuildReportMetadataScope &
    GuildReportMetadataInputRow & {
        indexedAt: Date;
    };

export type GuildReportMetadataCursor = GuildReportMetadataScope & {
    lastSeenStartTime: number;
    lastIndexedAt: Date;
};

export interface GuildReportMetadataUpsertResult {
    processedRows: number;
    upsertedRows: number;
    matchedRows: number;
    modifiedRows: number;
}

export interface GuildReportMetadataStore {
    upsertReports(input: {
        scope: GuildReportMetadataScope;
        reports: GuildReportMetadataInputRow[];
        indexedAt?: Date;
    }): Promise<GuildReportMetadataUpsertResult>;
    saveCursor(input: {
        scope: GuildReportMetadataScope;
        lastSeenStartTime: number;
        lastIndexedAt?: Date;
    }): Promise<GuildReportMetadataCursor>;
}

const normalizeServerSlug = (value: string): string =>
    value.trim().toLowerCase().replace(/\s+/g, "-");

const normalizeRegion = (value: string): string => value.trim().toLowerCase();

const normalizeScope = (scope: GuildReportMetadataScope): GuildReportMetadataScope => ({
    guildName: scope.guildName.trim(),
    guildServerSlug: normalizeServerSlug(scope.guildServerSlug),
    guildServerRegion: normalizeRegion(scope.guildServerRegion),
    gameFamily: scope.gameFamily,
});

const asObject = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;

const asFiniteNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseMetadataRecord = (value: unknown): GuildReportMetadataRecord | null => {
    const raw = asObject(value);
    if (!raw) return null;
    const startTime = asFiniteNumber(raw.startTime);
    const zoneId = asFiniteNumber(raw.zoneId);
    const endTime = asFiniteNumber(raw.endTime);
    if (
        typeof raw.guildName !== "string" ||
        typeof raw.guildServerSlug !== "string" ||
        typeof raw.guildServerRegion !== "string" ||
        (raw.gameFamily !== "retail" && raw.gameFamily !== "mop_classic") ||
        typeof raw.reportCode !== "string" ||
        typeof startTime !== "number" ||
        !(raw.indexedAt instanceof Date)
    ) {
        return null;
    }

    return {
        guildName: raw.guildName,
        guildServerSlug: raw.guildServerSlug,
        guildServerRegion: raw.guildServerRegion,
        gameFamily: raw.gameFamily,
        reportCode: raw.reportCode,
        ...(typeof raw.title === "string" ? { title: raw.title } : {}),
        ...(typeof raw.owner === "string" ? { owner: raw.owner } : {}),
        ...(typeof zoneId === "number" ? { zoneId } : {}),
        startTime,
        ...(typeof endTime === "number" ? { endTime } : {}),
        indexedAt: raw.indexedAt,
    };
};

const parseCursor = (value: unknown): GuildReportMetadataCursor | null => {
    const raw = asObject(value);
    if (!raw) return null;
    const lastSeenStartTime = asFiniteNumber(raw.lastSeenStartTime);
    if (
        typeof raw.guildName !== "string" ||
        typeof raw.guildServerSlug !== "string" ||
        typeof raw.guildServerRegion !== "string" ||
        (raw.gameFamily !== "retail" && raw.gameFamily !== "mop_classic") ||
        typeof lastSeenStartTime !== "number" ||
        !(raw.lastIndexedAt instanceof Date)
    ) {
        return null;
    }

    return {
        guildName: raw.guildName,
        guildServerSlug: raw.guildServerSlug,
        guildServerRegion: raw.guildServerRegion,
        gameFamily: raw.gameFamily,
        lastSeenStartTime,
        lastIndexedAt: raw.lastIndexedAt,
    };
};

const dedupeRows = (rows: GuildReportMetadataInputRow[]): GuildReportMetadataInputRow[] => {
    const rowsByCode = new Map<string, GuildReportMetadataInputRow>();
    for (const row of rows) {
        const reportCode = row.reportCode.trim();
        if (!reportCode || !Number.isFinite(row.startTime)) continue;
        rowsByCode.set(reportCode, { ...row, reportCode });
    }
    return [...rowsByCode.values()];
};

export class MongoGuildReportMetadataStore implements GuildReportMetadataStore {
    public async upsertReports(input: {
        scope: GuildReportMetadataScope;
        reports: GuildReportMetadataInputRow[];
        indexedAt?: Date;
    }): Promise<GuildReportMetadataUpsertResult> {
        const scope = normalizeScope(input.scope);
        const indexedAt = input.indexedAt ?? new Date();
        const reports = dedupeRows(input.reports);
        if (reports.length === 0) {
            return { processedRows: 0, upsertedRows: 0, matchedRows: 0, modifiedRows: 0 };
        }

        const result = await GuildReportMetadataModel.bulkWrite(
            reports.map((report) => ({
                updateOne: {
                    filter: { ...scope, reportCode: report.reportCode },
                    update: {
                        $set: {
                            ...scope,
                            reportCode: report.reportCode,
                            startTime: report.startTime,
                            indexedAt,
                            ...(report.title ? { title: report.title } : {}),
                            ...(report.owner ? { owner: report.owner } : {}),
                            ...(typeof report.zoneId === "number" ? { zoneId: report.zoneId } : {}),
                            ...(typeof report.endTime === "number" ? { endTime: report.endTime } : {}),
                        },
                    },
                    upsert: true,
                },
            })),
            { ordered: false },
        );

        return {
            processedRows: reports.length,
            upsertedRows: result.upsertedCount,
            matchedRows: result.matchedCount,
            modifiedRows: result.modifiedCount,
        };
    }

    public async getCursor(scope: GuildReportMetadataScope): Promise<GuildReportMetadataCursor | null> {
        const found = await GuildReportMetadataCursorModel.findOne(normalizeScope(scope)).lean();
        return parseCursor(found);
    }

    public async saveCursor(input: {
        scope: GuildReportMetadataScope;
        lastSeenStartTime: number;
        lastIndexedAt?: Date;
    }): Promise<GuildReportMetadataCursor> {
        const scope = normalizeScope(input.scope);
        const saved = await GuildReportMetadataCursorModel.findOneAndUpdate(
            scope,
            {
                $set: {
                    ...scope,
                    lastSeenStartTime: input.lastSeenStartTime,
                    lastIndexedAt: input.lastIndexedAt ?? new Date(),
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean();
        const parsed = parseCursor(saved);
        if (!parsed) throw new Error("Failed to persist guild report metadata cursor.");
        return parsed;
    }

    public async listReports(input: {
        scope: GuildReportMetadataScope;
        limit?: number;
    }): Promise<GuildReportMetadataRecord[]> {
        const found = await GuildReportMetadataModel.find(normalizeScope(input.scope))
            .sort({ startTime: -1 })
            .limit(Math.min(Math.max(input.limit ?? 50, 1), 100))
            .lean();
        return Array.isArray(found)
            ? found
                  .map((doc) => parseMetadataRecord(doc))
                  .filter((doc): doc is GuildReportMetadataRecord => doc !== null)
            : [];
    }
}
