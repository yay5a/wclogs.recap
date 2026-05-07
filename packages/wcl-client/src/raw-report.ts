import { asNumber, asObject } from './parsers/index.js';
import type { TableDataType } from './schema-enums.js';

export interface EncounterSummaryRow {
  encounterID: number;
  bossName: string;
  fightId: number;
  difficulty?: number;
  kill: boolean;
  rankings?: unknown;
  tables: Partial<Record<TableDataType, unknown>>;
}

export interface EnrichedRawReport {
  rawPayloadVersion: number;
  base: unknown;
  // TODO(domain): expose archive accessibility status on NormalizedReport when the domain model supports it.
  archiveAccessLimited?: boolean;
  rateLimitData?: RateLimitDataSnapshot;
  skippedEnrichments?: string[];
  reportRankings?: unknown;
  reportRankingsDpsCombined?: unknown;
  reportRankingsHpsCombined?: unknown;
  playerDetails?: unknown;
  reportTables?: Partial<Record<TableDataType, unknown>>;
  reportEncounterTables?: Partial<Record<TableDataType, unknown>>;
  encounterPhaseTimes?: unknown;
  encounterSummaries: EncounterSummaryRow[];
}

export interface RateLimitDataSnapshot {
  limitPerHour: number;
  pointsSpentThisHour: number;
  pointsResetIn: number;
}

export const getReportNode = (raw: unknown): Record<string, unknown> | undefined => {
  const root = asObject(raw);
  const data = asObject(root?.data);
  const reportData = asObject(data?.reportData ?? root?.reportData);
  return asObject(reportData?.report);
};

export const getRateLimitData = (raw: unknown): RateLimitDataSnapshot | undefined => {
  const root = asObject(raw);
  const data = asObject(root?.data ?? root);
  const rateLimitData = asObject(data?.rateLimitData);
  const limitPerHour = asNumber(rateLimitData?.limitPerHour);
  const pointsSpentThisHour = asNumber(rateLimitData?.pointsSpentThisHour);
  const pointsResetIn = asNumber(rateLimitData?.pointsResetIn);

  if (
    typeof limitPerHour !== 'number' ||
    typeof pointsSpentThisHour !== 'number' ||
    typeof pointsResetIn !== 'number'
  ) {
    return undefined;
  }

  return { limitPerHour, pointsSpentThisHour, pointsResetIn };
};

export const getArchiveStatus = (
  report: Record<string, unknown>,
): { isArchived: boolean; isAccessible: boolean; archiveDate?: number } => {
  const archiveStatus = asObject(report.archiveStatus);
  const archiveDate = asNumber(archiveStatus?.archiveDate);

  return {
    isArchived: Boolean(archiveStatus?.isArchived),
    isAccessible: Boolean(archiveStatus?.isAccessible),
    ...(typeof archiveDate === 'number' ? { archiveDate } : {}),
  };
};
