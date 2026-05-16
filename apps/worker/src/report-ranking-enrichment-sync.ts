import type {
  ReportRankingCompareMode,
  ReportRankingScope,
  ReportRankingTimeframe,
  ReportRankingsFactInput,
  ReportRankingsFactReplaceResult,
  ReportRankingsRawInput,
  ReportRankingsRawState,
  ReportRankingsRawWriteResult,
  RecomputeWeeklyTrendResult,
} from '@wcl/db';
import { getRankingWeekStart } from '@wcl/db';
import type { GameFamily, ReportIndexData } from '@wcl/domain';
import {
  getReportRankingEnrichmentQueryHashes,
  type ReportRankingEnrichmentInput,
  type ReportRankingEnrichmentResult,
} from '@wcl/wcl-client';

export interface ReportRankingEnrichmentSyncReport {
  reportCode: string;
  startTime: number;
}

export interface ReportRankingEnrichmentSyncClient {
  fetchReportIndex(input: {
    reportCode: string;
    sourceUrl: string;
    gameFamily: GameFamily;
  }): Promise<ReportIndexData>;
  fetchReportRankingEnrichment(
    input: ReportRankingEnrichmentInput,
  ): Promise<ReportRankingEnrichmentResult>;
}

export interface ReportRankingEnrichmentSyncStore {
  getRawStates(reportCodes: string[]): Promise<ReportRankingsRawState[]>;
  saveRawPayloads(payloads: ReportRankingsRawInput[]): Promise<ReportRankingsRawWriteResult>;
  replaceFactsForReport(input: {
    reportCode: string;
    facts: ReportRankingsFactInput[];
    contexts: Array<{ timeframe: ReportRankingTimeframe; compareMode: ReportRankingCompareMode }>;
  }): Promise<ReportRankingsFactReplaceResult>;
  recomputeWeeklyTrends(input: {
    scope: ReportRankingScope;
    encounterIds?: number[];
    weekStarts?: Date[];
  }): Promise<RecomputeWeeklyTrendResult>;
}

export interface ReportRankingEnrichmentSyncLogger {
  info(context: Record<string, unknown>, message: string): void;
}

export interface ReportRankingEnrichmentSyncInput {
  wclClient: ReportRankingEnrichmentSyncClient;
  store: ReportRankingEnrichmentSyncStore;
  scope: ReportRankingScope;
  reports: ReportRankingEnrichmentSyncReport[];
  maxReports?: number;
  staleAfterMs?: number;
  timeframes?: ReportRankingTimeframe[];
  compareModes?: ReportRankingCompareMode[];
  logger?: ReportRankingEnrichmentSyncLogger;
}

export interface ReportRankingEnrichmentSyncResult {
  enrichmentAttempts: number;
  skippedFreshReports: number;
  processedReports: number;
  failedReports: number;
  rawPayloadsWritten: number;
  factsInserted: number;
  factsDeleted: number;
  trendRowsWritten: number;
  trendRowsDeleted: number;
}

const DEFAULT_MAX_REPORTS = 25;
const DEFAULT_TIMEFRAMES: ReportRankingTimeframe[] = ['today', 'historical'];
const DEFAULT_COMPARE_MODES: ReportRankingCompareMode[] = ['rankings'];

const getMaxReports = (value: number | undefined): number => {
  const maxReports = value ?? DEFAULT_MAX_REPORTS;
  if (!Number.isSafeInteger(maxReports) || maxReports < 1) {
    throw new Error('ranking enrichment maxReports must be a positive integer');
  }
  return maxReports;
};

const normalizeReports = (
  reports: ReportRankingEnrichmentSyncReport[],
): ReportRankingEnrichmentSyncReport[] => {
  const byCode = new Map<string, ReportRankingEnrichmentSyncReport>();
  for (const report of reports) {
    const reportCode = report.reportCode.trim();
    if (!reportCode || !Number.isFinite(report.startTime)) continue;
    byCode.set(reportCode, { reportCode, startTime: report.startTime });
  }
  return [...byCode.values()].sort(
    (left, right) =>
      right.startTime - left.startTime || left.reportCode.localeCompare(right.reportCode),
  );
};

const hasFreshCoverage = (
  state: ReportRankingsRawState | undefined,
  expectedHashes: string[],
  staleAfterMs: number | undefined,
  nowMs: number,
): boolean => {
  if (!state) return false;
  const fetchedAtByHash = new Map(
    state.payloads.map((payload) => [payload.queryVarsHash, payload.latestFetchedAt]),
  );

  return expectedHashes.every((hash) => {
    const fetchedAt = fetchedAtByHash.get(hash);
    if (!fetchedAt) return false;
    return staleAfterMs === undefined || nowMs - fetchedAt.getTime() < staleAfterMs;
  });
};

const toReportUrl = (reportCode: string, gameFamily: GameFamily): string => {
  const host = gameFamily === 'mop_classic' ? 'classic.warcraftlogs.com' : 'www.warcraftlogs.com';
  return `https://${host}/reports/${reportCode}`;
};

const toFights = (index: ReportIndexData): ReportRankingEnrichmentInput['fights'] =>
  index.completedBossFights.flatMap((fight) => {
    if (typeof fight.difficulty !== 'number' || typeof fight.size !== 'number') return [];
    return [
      {
        fightId: fight.id,
        encounterId: fight.encounterId,
        difficulty: fight.difficulty,
        size: fight.size,
        kill: fight.kill,
      },
    ];
  });

const toFactInputs = (
  scope: ReportRankingScope,
  facts: ReportRankingEnrichmentResult['facts'],
): ReportRankingsFactInput[] =>
  facts.map((fact) => ({
    ...scope,
    reportCode: fact.reportCode,
    reportStartTime: fact.reportStartTime,
    fightId: fact.fightId,
    encounterId: fact.encounterId,
    difficulty: fact.difficulty,
    size: fact.size,
    timeframe: fact.timeframe,
    compareMode: fact.compareMode,
    ...(typeof fact.speedPercentile === 'number' ? { speedPercentile: fact.speedPercentile } : {}),
    ...(typeof fact.executionPercentile === 'number'
      ? { executionPercentile: fact.executionPercentile }
      : {}),
    ...(typeof fact.rank === 'number' ? { rank: fact.rank } : {}),
    ...(typeof fact.outOf === 'number' ? { outOf: fact.outOf } : {}),
    ...(typeof fact.durationMs === 'number' ? { durationMs: fact.durationMs } : {}),
    ...(typeof fact.startTime === 'number' ? { startTime: fact.startTime } : {}),
    kill: fact.kill,
    ...(typeof fact.isWipeRanked === 'boolean' ? { isWipeRanked: fact.isWipeRanked } : {}),
    sourceFetchedAt: fact.sourceFetchedAt,
  }));

export const syncReportRankingEnrichment = async (
  input: ReportRankingEnrichmentSyncInput,
): Promise<ReportRankingEnrichmentSyncResult> => {
  const maxReports = getMaxReports(input.maxReports);
  const reports = normalizeReports(input.reports);
  const timeframes = input.timeframes ?? DEFAULT_TIMEFRAMES;
  const compareModes = input.compareModes ?? DEFAULT_COMPARE_MODES;
  const rawStates = await input.store.getRawStates(reports.map((report) => report.reportCode));
  const statesByCode = new Map(rawStates.map((state) => [state.reportCode, state]));
  const nowMs = Date.now();

  let enrichmentAttempts = 0;
  let skippedFreshReports = 0;
  let processedReports = 0;
  let failedReports = 0;
  let rawPayloadsWritten = 0;
  let factsInserted = 0;
  let factsDeleted = 0;
  const touchedEncounterIds = new Set<number>();
  const touchedWeekStarts = new Map<number, Date>();

  for (const report of reports) {
    if (enrichmentAttempts >= maxReports) {
      break;
    }

    try {
      const index = await input.wclClient.fetchReportIndex({
        reportCode: report.reportCode,
        sourceUrl: toReportUrl(report.reportCode, input.scope.gameFamily),
        gameFamily: input.scope.gameFamily,
      });
      const fights = toFights(index);
      const expectedHashes = getReportRankingEnrichmentQueryHashes({
        reportCode: report.reportCode,
        fights,
        timeframes,
        compareModes,
      });
      if (expectedHashes.length === 0) {
        skippedFreshReports += 1;
        continue;
      }
      if (
        hasFreshCoverage(
          statesByCode.get(report.reportCode),
          expectedHashes,
          input.staleAfterMs,
          nowMs,
        )
      ) {
        skippedFreshReports += 1;
        continue;
      }

      enrichmentAttempts += 1;
      const enrichment = await input.wclClient.fetchReportRankingEnrichment({
        reportCode: report.reportCode,
        gameFamily: input.scope.gameFamily,
        reportStartTime: index.startTime,
        fights,
        timeframes,
        compareModes,
      });

      const rawWrite = await input.store.saveRawPayloads(enrichment.rawPayloads);
      const factWrite = await input.store.replaceFactsForReport({
        reportCode: report.reportCode,
        facts: toFactInputs(input.scope, enrichment.facts),
        contexts: enrichment.contexts,
      });

      rawPayloadsWritten += rawWrite.insertedRows;
      factsInserted += factWrite.insertedRows;
      factsDeleted += factWrite.deletedRows;
      processedReports += 1;

      for (const fact of enrichment.facts) {
        touchedEncounterIds.add(fact.encounterId);
        const weekStart = getRankingWeekStart(fact.reportStartTime);
        touchedWeekStarts.set(weekStart.getTime(), weekStart);
      }
    } catch (error) {
      failedReports += 1;
      input.logger?.info(
        {
          ...input.scope,
          reportCode: report.reportCode,
          error: error instanceof Error ? error.message : String(error),
        },
        'report_ranking_enrichment_failed',
      );
    }
  }

  const trendWrite =
    touchedEncounterIds.size > 0 && touchedWeekStarts.size > 0
      ? await input.store.recomputeWeeklyTrends({
          scope: input.scope,
          encounterIds: [...touchedEncounterIds],
          weekStarts: [...touchedWeekStarts.values()],
        })
      : { factRowsRead: 0, trendRowsWritten: 0, trendRowsDeleted: 0 };

  const result = {
    enrichmentAttempts,
    skippedFreshReports,
    processedReports,
    failedReports,
    rawPayloadsWritten,
    factsInserted,
    factsDeleted,
    trendRowsWritten: trendWrite.trendRowsWritten,
    trendRowsDeleted: trendWrite.trendRowsDeleted,
  };

  input.logger?.info(
    {
      ...input.scope,
      ...result,
      expectedQueryContextsPerReport: timeframes.length * compareModes.length,
    },
    'report_ranking_enrichment_sync',
  );

  return result;
};
