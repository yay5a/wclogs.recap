import type { GameFamily, NormalizedReport } from "@wcl/domain";

export interface ReportCacheRecord {
    reportCode: string;
    sourceUrl: string;
    gameFamily: GameFamily;
    rawPayload: unknown;
    normalizedPayload: NormalizedReport;
    fetchedAt: Date;
}

export interface ReportCacheWriteEntry {
    reportCode: string;
    sourceUrl: string;
    gameFamily: GameFamily;
    rawPayload: unknown;
    normalizedPayload: NormalizedReport;
    fetchedAt: Date;
}

export interface ReportCacheStore {
    getByReportCode(reportCode: string): Promise<ReportCacheRecord | null>;
    upsert(entry: ReportCacheWriteEntry): Promise<void>;
}
