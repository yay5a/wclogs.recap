import type { GameFamily } from '@wcl/domain';
import {
  GuildEncounterTrendWeeklyModel,
  ReportRankingsFactModel,
  ReportRankingsRawModel,
  type ReportRankingCompareMode,
  type ReportRankingTimeframe,
} from '../models/report-rankings-model.js';

export type { ReportRankingCompareMode, ReportRankingTimeframe };

export interface ReportRankingScope {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily: GameFamily;
}

export interface ReportRankingsRawInput {
  reportCode: string;
  fetchedAt: Date;
  queryVarsHash: string;
  payloadJson: unknown;
  timeframe?: ReportRankingTimeframe;
  compareMode?: ReportRankingCompareMode;
}

export interface ReportRankingsRawState {
  reportCode: string;
  payloads: Array<{
    queryVarsHash: string;
    latestFetchedAt: Date;
  }>;
}

export interface ReportRankingsFactInput extends ReportRankingScope {
  reportCode: string;
  reportStartTime: number;
  fightId: number;
  encounterId: number;
  difficulty: number;
  size: number;
  timeframe: ReportRankingTimeframe;
  compareMode: ReportRankingCompareMode;
  speedPercentile?: number;
  executionPercentile?: number;
  rank?: number;
  outOf?: number;
  durationMs?: number;
  startTime?: number;
  kill: boolean;
  isWipeRanked?: boolean;
  sourceFetchedAt: Date;
}

export interface ReportRankingsRawWriteResult {
  processedRows: number;
  insertedRows: number;
}

export interface ReportRankingsFactReplaceResult {
  deletedRows: number;
  insertedRows: number;
}

export interface RecomputeWeeklyTrendInput {
  scope: ReportRankingScope;
  encounterIds?: number[];
  weekStarts?: Date[];
  timeframe?: ReportRankingTimeframe;
  compareMode?: ReportRankingCompareMode;
  computedAt?: Date;
}

export interface RecomputeWeeklyTrendResult {
  factRowsRead: number;
  trendRowsWritten: number;
  trendRowsDeleted: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_WEEK_START_DAY_UTC = 2;

const normalizeServerSlug = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, '-');

const normalizeGuildName = (value: string): string => value.trim().toLowerCase();

const normalizeRegion = (value: string): string => value.trim().toLowerCase();

const normalizeScope = (scope: ReportRankingScope): ReportRankingScope => ({
  guildName: normalizeGuildName(scope.guildName),
  guildServerSlug: normalizeServerSlug(scope.guildServerSlug),
  guildServerRegion: normalizeRegion(scope.guildServerRegion),
  gameFamily: scope.gameFamily,
});

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;

const asDate = (value: unknown): Date | undefined => (value instanceof Date ? value : undefined);

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[middle - 1];
    const right = sorted[middle];
    if (typeof left !== 'number' || typeof right !== 'number') return undefined;
    return (left + right) / 2;
  }
  return sorted[middle];
};

const p90 = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.9) - 1);
  return sorted[index];
};

export const getRankingWeekStart = (value: Date | number): Date => {
  const input = value instanceof Date ? value.getTime() : value;
  const date = new Date(input);
  date.setUTCHours(0, 0, 0, 0);
  const offset = (date.getUTCDay() - RESET_WEEK_START_DAY_UTC + 7) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date;
};

const toWeekStartMs = (value: Date): number => getRankingWeekStart(value).getTime();

const uniqueNumbers = (values: number[] | undefined): number[] | undefined => {
  if (!values) return undefined;
  const normalized = [...new Set(values.filter((value) => Number.isFinite(value)))];
  return normalized.length > 0 ? normalized : undefined;
};

const uniqueWeekStarts = (values: Date[] | undefined): Date[] | undefined => {
  if (!values) return undefined;
  const normalized = [...new Set(values.map((value) => toWeekStartMs(value)))].map(
    (value) => new Date(value),
  );
  return normalized.length > 0 ? normalized : undefined;
};

const toTrendFactTimeRange = (
  weekStarts: Date[] | undefined,
): { $gte: number; $lt: number } | undefined => {
  if (!weekStarts || weekStarts.length === 0) return undefined;
  const weekStartMs = weekStarts.map((weekStart) => weekStart.getTime());
  return {
    $gte: Math.min(...weekStartMs) - WEEK_MS,
    $lt: Math.max(...weekStartMs) + WEEK_MS,
  };
};

const hasAnyMetric = (fact: ReportRankingsFactInput): boolean =>
  typeof fact.speedPercentile === 'number' ||
  typeof fact.executionPercentile === 'number' ||
  typeof fact.rank === 'number' ||
  typeof fact.outOf === 'number' ||
  typeof fact.durationMs === 'number';

const dedupeFacts = (facts: ReportRankingsFactInput[]): ReportRankingsFactInput[] => {
  const byKey = new Map<string, ReportRankingsFactInput>();
  for (const fact of facts) {
    if (!hasAnyMetric(fact)) continue;
    const reportCode = fact.reportCode.trim();
    if (!reportCode || !Number.isFinite(fact.fightId)) continue;
    byKey.set(`${reportCode}:${fact.fightId}:${fact.timeframe}:${fact.compareMode}`, {
      ...fact,
      ...normalizeScope(fact),
      reportCode,
    });
  }
  return [...byKey.values()];
};

type ParsedFact = ReportRankingsFactInput;

const parseFact = (value: unknown): ParsedFact | null => {
  const raw = asObject(value);
  if (!raw) return null;
  const reportStartTime = asFiniteNumber(raw.reportStartTime);
  const fightId = asFiniteNumber(raw.fightId);
  const encounterId = asFiniteNumber(raw.encounterId);
  const difficulty = asFiniteNumber(raw.difficulty);
  const size = asFiniteNumber(raw.size);
  const sourceFetchedAt = asDate(raw.sourceFetchedAt);

  if (
    typeof raw.guildName !== 'string' ||
    typeof raw.guildServerSlug !== 'string' ||
    typeof raw.guildServerRegion !== 'string' ||
    (raw.gameFamily !== 'retail' && raw.gameFamily !== 'mop_classic') ||
    typeof raw.reportCode !== 'string' ||
    typeof reportStartTime !== 'number' ||
    typeof fightId !== 'number' ||
    typeof encounterId !== 'number' ||
    typeof difficulty !== 'number' ||
    typeof size !== 'number' ||
    (raw.timeframe !== 'today' && raw.timeframe !== 'historical') ||
    (raw.compareMode !== 'rankings' && raw.compareMode !== 'parses') ||
    typeof raw.kill !== 'boolean' ||
    !sourceFetchedAt
  ) {
    return null;
  }

  return {
    guildName: raw.guildName,
    guildServerSlug: raw.guildServerSlug,
    guildServerRegion: raw.guildServerRegion,
    gameFamily: raw.gameFamily,
    reportCode: raw.reportCode,
    reportStartTime,
    fightId,
    encounterId,
    difficulty,
    size,
    timeframe: raw.timeframe,
    compareMode: raw.compareMode,
    ...(typeof raw.speedPercentile === 'number' ? { speedPercentile: raw.speedPercentile } : {}),
    ...(typeof raw.executionPercentile === 'number'
      ? { executionPercentile: raw.executionPercentile }
      : {}),
    ...(typeof raw.rank === 'number' ? { rank: raw.rank } : {}),
    ...(typeof raw.outOf === 'number' ? { outOf: raw.outOf } : {}),
    ...(typeof raw.durationMs === 'number' ? { durationMs: raw.durationMs } : {}),
    ...(typeof raw.startTime === 'number' ? { startTime: raw.startTime } : {}),
    kill: raw.kill,
    ...(typeof raw.isWipeRanked === 'boolean' ? { isWipeRanked: raw.isWipeRanked } : {}),
    sourceFetchedAt,
  };
};

type TrendStats = {
  sampleCount: number;
  speedMedian?: number;
  speedP90?: number;
  executionMedian?: number;
  executionP90?: number;
};

type TrendGroup = {
  guildName: string;
  guildServerSlug: string;
  guildServerRegion: string;
  gameFamily: GameFamily;
  encounterId: number;
  difficulty: number;
  size: number;
  weekStart: Date;
  timeframe: ReportRankingTimeframe;
  compareMode: ReportRankingCompareMode;
  speedValues: number[];
  executionValues: number[];
  sampleCount: number;
};

const trendGroupKey = (input: {
  encounterId: number;
  difficulty: number;
  size: number;
  weekStart: Date;
  timeframe: ReportRankingTimeframe;
  compareMode: ReportRankingCompareMode;
}): string =>
  [
    input.encounterId,
    input.difficulty,
    input.size,
    input.weekStart.getTime(),
    input.timeframe,
    input.compareMode,
  ].join(':');

const previousTrendGroupKey = (group: TrendGroup): string =>
  trendGroupKey({
    ...group,
    weekStart: new Date(group.weekStart.getTime() - WEEK_MS),
  });

const buildTrendGroups = (facts: ParsedFact[]): Map<string, TrendGroup> => {
  const groups = new Map<string, TrendGroup>();
  for (const fact of facts) {
    const weekStart = getRankingWeekStart(fact.reportStartTime);
    const key = trendGroupKey({ ...fact, weekStart });
    const existing =
      groups.get(key) ??
      {
        guildName: fact.guildName,
        guildServerSlug: fact.guildServerSlug,
        guildServerRegion: fact.guildServerRegion,
        gameFamily: fact.gameFamily,
        encounterId: fact.encounterId,
        difficulty: fact.difficulty,
        size: fact.size,
        weekStart,
        timeframe: fact.timeframe,
        compareMode: fact.compareMode,
        speedValues: [],
        executionValues: [],
        sampleCount: 0,
      };

    if (typeof fact.speedPercentile === 'number') {
      existing.speedValues.push(fact.speedPercentile);
    }
    if (typeof fact.executionPercentile === 'number') {
      existing.executionValues.push(fact.executionPercentile);
    }
    existing.sampleCount += 1;
    groups.set(key, existing);
  }
  return groups;
};

const toTrendStats = (group: TrendGroup): TrendStats => {
  const speedMedian = median(group.speedValues);
  const speedP90 = p90(group.speedValues);
  const executionMedian = median(group.executionValues);
  const executionP90 = p90(group.executionValues);

  return {
    sampleCount: group.sampleCount,
    ...(typeof speedMedian === 'number' ? { speedMedian } : {}),
    ...(typeof speedP90 === 'number' ? { speedP90 } : {}),
    ...(typeof executionMedian === 'number' ? { executionMedian } : {}),
    ...(typeof executionP90 === 'number' ? { executionP90 } : {}),
  };
};

const withDeltas = (
  group: TrendGroup,
  stats: TrendStats,
  statsByKey: Map<string, TrendStats>,
): TrendStats => {
  const previous = statsByKey.get(previousTrendGroupKey(group));
  return {
    ...stats,
    ...(typeof stats.speedMedian === 'number' && typeof previous?.speedMedian === 'number'
      ? { speedMedianDelta: stats.speedMedian - previous.speedMedian }
      : {}),
    ...(typeof stats.executionMedian === 'number' && typeof previous?.executionMedian === 'number'
      ? { executionMedianDelta: stats.executionMedian - previous.executionMedian }
      : {}),
  };
};

export class MongoReportRankingsStore {
  public async getRawStates(reportCodes: string[]): Promise<ReportRankingsRawState[]> {
    const codes = [...new Set(reportCodes.map((code) => code.trim()).filter(Boolean))];
    if (codes.length === 0) return [];

    const rows = await ReportRankingsRawModel.aggregate<{
      _id: string;
      payloads?: Array<{ queryVarsHash?: unknown; latestFetchedAt?: unknown }>;
    }>([
      { $match: { reportCode: { $in: codes } } },
      {
        $group: {
          _id: {
            reportCode: '$reportCode',
            queryVarsHash: '$queryVarsHash',
          },
          latestFetchedAt: { $max: '$fetchedAt' },
        },
      },
      {
        $group: {
          _id: '$_id.reportCode',
          payloads: {
            $push: {
              queryVarsHash: '$_id.queryVarsHash',
              latestFetchedAt: '$latestFetchedAt',
            },
          },
        },
      },
    ]);

    return rows.flatMap((row) =>
      typeof row._id === 'string'
        ? [
            {
              reportCode: row._id,
              payloads: (row.payloads ?? []).flatMap((payload) =>
                typeof payload.queryVarsHash === 'string' && payload.latestFetchedAt instanceof Date
                  ? [
                      {
                        queryVarsHash: payload.queryVarsHash,
                        latestFetchedAt: payload.latestFetchedAt,
                      },
                    ]
                  : [],
              ),
            },
          ]
        : [],
    );
  }

  public async saveRawPayloads(
    payloads: ReportRankingsRawInput[],
  ): Promise<ReportRankingsRawWriteResult> {
    const rows = payloads
      .map((payload) => ({ ...payload, reportCode: payload.reportCode.trim() }))
      .filter((payload) => payload.reportCode && payload.queryVarsHash.trim());
    if (rows.length === 0) {
      return { processedRows: 0, insertedRows: 0 };
    }

    const inserted = await ReportRankingsRawModel.insertMany(
      rows.map((payload) => ({
        reportCode: payload.reportCode,
        fetchedAt: payload.fetchedAt,
        queryVarsHash: payload.queryVarsHash,
        payloadJson: payload.payloadJson,
        ...(payload.timeframe ? { timeframe: payload.timeframe } : {}),
        ...(payload.compareMode ? { compareMode: payload.compareMode } : {}),
      })),
      { ordered: false },
    );

    return {
      processedRows: rows.length,
      insertedRows: inserted.length,
    };
  }

  public async replaceFactsForReport(input: {
    reportCode: string;
    facts: ReportRankingsFactInput[];
    contexts: Array<{ timeframe: ReportRankingTimeframe; compareMode: ReportRankingCompareMode }>;
  }): Promise<ReportRankingsFactReplaceResult> {
    const reportCode = input.reportCode.trim();
    const contexts = input.contexts.filter(
      (context, index, rows) =>
        rows.findIndex(
          (row) =>
            row.timeframe === context.timeframe && row.compareMode === context.compareMode,
        ) === index,
    );
    if (!reportCode || contexts.length === 0) {
      return { deletedRows: 0, insertedRows: 0 };
    }

    const deleteResult = await ReportRankingsFactModel.deleteMany({
      reportCode,
      $or: contexts.map((context) => ({
        timeframe: context.timeframe,
        compareMode: context.compareMode,
      })),
    });

    const facts = dedupeFacts(input.facts);
    if (facts.length > 0) {
      await ReportRankingsFactModel.insertMany(facts, { ordered: false });
    }

    return {
      deletedRows: deleteResult.deletedCount ?? 0,
      insertedRows: facts.length,
    };
  }

  public async recomputeWeeklyTrends(
    input: RecomputeWeeklyTrendInput,
  ): Promise<RecomputeWeeklyTrendResult> {
    const scope = normalizeScope(input.scope);
    const encounterIds = uniqueNumbers(input.encounterIds);
    const weekStarts = uniqueWeekStarts(input.weekStarts);
    const reportStartTime = toTrendFactTimeRange(weekStarts);
    const computedAt = input.computedAt ?? new Date();
    const factFilter: Record<string, unknown> = {
      ...scope,
      ...(encounterIds ? { encounterId: { $in: encounterIds } } : {}),
      ...(reportStartTime ? { reportStartTime } : {}),
      ...(input.timeframe ? { timeframe: input.timeframe } : {}),
      ...(input.compareMode ? { compareMode: input.compareMode } : {}),
    };

    const found = await ReportRankingsFactModel.find(factFilter).lean();
    const facts = Array.isArray(found)
      ? found.map((row) => parseFact(row)).filter((row): row is ParsedFact => row !== null)
      : [];
    const groups = buildTrendGroups(facts);
    const targetWeekMs = weekStarts
      ? new Set(weekStarts.map((weekStart) => weekStart.getTime()))
      : undefined;
    const statsByKey = new Map(
      [...groups.entries()].map(([key, group]) => [key, toTrendStats(group)]),
    );
    const targetGroups = [...groups.entries()]
      .filter(([, group]) => !targetWeekMs || targetWeekMs.has(group.weekStart.getTime()))
      .map(([key, group]) => ({ key, group }));

    const deleteFilter: Record<string, unknown> = {
      ...scope,
      ...(encounterIds ? { encounterId: { $in: encounterIds } } : {}),
      ...(weekStarts ? { weekStart: { $in: weekStarts } } : {}),
      ...(input.timeframe ? { timeframe: input.timeframe } : {}),
      ...(input.compareMode ? { compareMode: input.compareMode } : {}),
    };
    const deleteResult = await GuildEncounterTrendWeeklyModel.deleteMany(deleteFilter);

    if (targetGroups.length > 0) {
      await GuildEncounterTrendWeeklyModel.bulkWrite(
        targetGroups.map(({ key, group }) => {
          const stats = withDeltas(group, statsByKey.get(key) ?? toTrendStats(group), statsByKey);
          return {
            updateOne: {
              filter: {
                guildName: group.guildName,
                guildServerSlug: group.guildServerSlug,
                guildServerRegion: group.guildServerRegion,
                gameFamily: group.gameFamily,
                encounterId: group.encounterId,
                difficulty: group.difficulty,
                size: group.size,
                weekStart: group.weekStart,
                timeframe: group.timeframe,
                compareMode: group.compareMode,
              },
              update: {
                $set: {
                  guildName: group.guildName,
                  guildServerSlug: group.guildServerSlug,
                  guildServerRegion: group.guildServerRegion,
                  gameFamily: group.gameFamily,
                  encounterId: group.encounterId,
                  difficulty: group.difficulty,
                  size: group.size,
                  weekStart: group.weekStart,
                  timeframe: group.timeframe,
                  compareMode: group.compareMode,
                  ...stats,
                  computedAt,
                },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }

    return {
      factRowsRead: facts.length,
      trendRowsWritten: targetGroups.length,
      trendRowsDeleted: deleteResult.deletedCount ?? 0,
    };
  }
}
