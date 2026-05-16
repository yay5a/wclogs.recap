import { createHash } from 'node:crypto';
import type { GameFamily } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { asArray, asNumber, asObject, parseUnknownJson } from '../parsers/common.js';

export type ReportRankingEnrichmentTimeframe = 'today' | 'historical';
export type ReportRankingEnrichmentCompareMode = 'rankings' | 'parses';

export interface ReportRankingEnrichmentFight {
  fightId: number;
  encounterId: number;
  difficulty: number;
  size: number;
  kill: boolean;
}

export interface ReportRankingEnrichmentInput {
  reportCode: string;
  gameFamily?: GameFamily;
  reportStartTime: number;
  fights: ReportRankingEnrichmentFight[];
  timeframes?: ReportRankingEnrichmentTimeframe[];
  compareModes?: ReportRankingEnrichmentCompareMode[];
}

export interface ReportRankingRawPayload {
  reportCode: string;
  fetchedAt: Date;
  queryVarsHash: string;
  payloadJson: unknown;
  timeframe: ReportRankingEnrichmentTimeframe;
  compareMode: ReportRankingEnrichmentCompareMode;
}

export interface ReportRankingFact {
  reportCode: string;
  reportStartTime: number;
  fightId: number;
  encounterId: number;
  difficulty: number;
  size: number;
  timeframe: ReportRankingEnrichmentTimeframe;
  compareMode: ReportRankingEnrichmentCompareMode;
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

export interface ReportRankingEnrichmentContext {
  timeframe: ReportRankingEnrichmentTimeframe;
  compareMode: ReportRankingEnrichmentCompareMode;
}

export interface ReportRankingEnrichmentResult {
  rawPayloads: ReportRankingRawPayload[];
  facts: ReportRankingFact[];
  contexts: ReportRankingEnrichmentContext[];
}

type ReportRankingEnrichmentQueryVariables = Record<string, unknown> & {
  code: string;
  allowUnlisted: true;
  fightIDs: number[];
  timeframe: 'Today' | 'Historical';
  compare: 'Rankings' | 'Parses';
  playerMetric: 'playerspeed';
};

const REPORT_RANKING_ENRICHMENT_QUERY = `
query ReportRankingEnrichment(
  $code: String!,
  $allowUnlisted: Boolean!,
  $fightIDs: [Int],
  $timeframe: RankingTimeframeType,
  $compare: RankingCompareType,
  $playerMetric: ReportRankingMetricType!
) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      rankings(
        fightIDs: $fightIDs,
        timeframe: $timeframe,
        compare: $compare,
        playerMetric: $playerMetric
      )
    }
  }
}`;

const DEFAULT_TIMEFRAMES: ReportRankingEnrichmentTimeframe[] = ['today', 'historical'];
const DEFAULT_COMPARE_MODES: ReportRankingEnrichmentCompareMode[] = ['rankings'];

const toWclTimeframe = (timeframe: ReportRankingEnrichmentTimeframe): 'Today' | 'Historical' =>
  timeframe === 'today' ? 'Today' : 'Historical';

const toWclCompareMode = (
  compareMode: ReportRankingEnrichmentCompareMode,
): 'Rankings' | 'Parses' => (compareMode === 'rankings' ? 'Rankings' : 'Parses');

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashQueryVars = (value: Record<string, unknown>): string =>
  createHash('sha256').update(stableJson(value)).digest('hex');

const toValidFights = (fights: ReportRankingEnrichmentFight[]): ReportRankingEnrichmentFight[] =>
  fights.filter(
    (fight) =>
      Number.isFinite(fight.fightId) &&
      Number.isFinite(fight.encounterId) &&
      Number.isFinite(fight.difficulty) &&
      Number.isFinite(fight.size),
  );

const toFightIDs = (fights: ReportRankingEnrichmentFight[]): number[] =>
  [...new Set(fights.map((fight) => Math.trunc(fight.fightId)))].sort(
    (left, right) => left - right,
  );

const buildQueryVariables = (input: {
  reportCode: string;
  fightIDs: number[];
  timeframe: ReportRankingEnrichmentTimeframe;
  compareMode: ReportRankingEnrichmentCompareMode;
}): ReportRankingEnrichmentQueryVariables => ({
  code: input.reportCode,
  allowUnlisted: true,
  fightIDs: input.fightIDs,
  timeframe: toWclTimeframe(input.timeframe),
  compare: toWclCompareMode(input.compareMode),
  playerMetric: 'playerspeed',
});

export const getReportRankingEnrichmentQueryHashes = (input: {
  reportCode: string;
  fights: ReportRankingEnrichmentFight[];
  timeframes?: ReportRankingEnrichmentTimeframe[];
  compareModes?: ReportRankingEnrichmentCompareMode[];
}): string[] => {
  const fightIDs = toFightIDs(toValidFights(input.fights));
  if (fightIDs.length === 0) return [];
  const timeframes = input.timeframes ?? DEFAULT_TIMEFRAMES;
  const compareModes = input.compareModes ?? DEFAULT_COMPARE_MODES;

  return timeframes.flatMap((timeframe) =>
    compareModes.map((compareMode) =>
      hashQueryVars(
        buildQueryVariables({
          reportCode: input.reportCode,
          fightIDs,
          timeframe,
          compareMode,
        }),
      ),
    ),
  );
};

const getRankingsNode = (payload: unknown): unknown => {
  const root = asObject(payload);
  const data = asObject(root?.data);
  const reportData = asObject(data?.reportData ?? root?.reportData);
  const report = asObject(reportData?.report);
  return report?.rankings;
};

const collectRows = (value: unknown): Record<string, unknown>[] => {
  const parsed = parseUnknownJson(value, () => undefined, 'report ranking enrichment');
  const root = asObject(parsed);
  if (!root) {
    return (asArray(parsed) ?? []).flatMap((row) => {
      const parsedRow = asObject(row);
      return parsedRow ? [parsedRow] : [];
    });
  }

  const rankings = asObject(root.rankings);
  const entries = asObject(root.entries);
  const candidates = [
    ...(asArray(root.data) ?? []),
    ...(asArray(root.rankings) ?? []),
    ...(asArray(root.entries) ?? []),
    ...(asArray(rankings?.data) ?? []),
    ...(asArray(entries?.data) ?? []),
  ];

  return candidates.flatMap((candidate) => {
    const row = asObject(candidate);
    if (!row) return [];
    const nested = [
      ...(asArray(row.rankings) ?? []),
      ...(asArray(row.entries) ?? []),
      ...(asArray(asObject(row.rankings)?.data) ?? []),
      ...(asArray(asObject(row.entries)?.data) ?? []),
    ].flatMap((nestedCandidate) => {
      const nestedRow = asObject(nestedCandidate);
      return nestedRow ? [{ ...row, ...nestedRow }] : [];
    });
    return nested.length > 0 ? nested : [row];
  });
};

const firstNumber = (row: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = asNumber(row[key]);
    if (typeof value === 'number') return value;
  }
  return undefined;
};

const firstNestedNumber = (
  row: Record<string, unknown>,
  path: string[],
): number | undefined => {
  let current: unknown = row;

  for (const key of path) {
    const object = asObject(current);
    if (!object) return undefined;
    current = object[key];
  }

  return asNumber(current);
};

const normalizeFacts = (
  payload: unknown,
  input: {
    reportCode: string;
    reportStartTime: number;
    fightsById: Map<number, ReportRankingEnrichmentFight>;
    timeframe: ReportRankingEnrichmentTimeframe;
    compareMode: ReportRankingEnrichmentCompareMode;
    fetchedAt: Date;
  },
): ReportRankingFact[] => {
  const facts: ReportRankingFact[] = [];
  const rows = collectRows(payload);

  for (const row of rows) {
    const fightId = firstNumber(row, ['fightID', 'fightId']);
    if (typeof fightId !== 'number') continue;
    const fight = input.fightsById.get(fightId);
    if (!fight) continue;

    const speedPercentile = firstNumber(row, [
      'speedPercentile',
      'speedPercent',
      'playerspeed',
      'speed',
      'rankPercent',
      'percentile',
    ]) ?? firstNestedNumber(row, ['speed', 'rankPercent']);
    const executionPercentile = firstNumber(row, [
      'executionPercentile',
      'executionPercent',
      'executionScore',
      'execution',
    ]) ?? firstNestedNumber(row, ['execution', 'rankPercent']);
    const rank = firstNumber(row, ['rank', 'speedRank']) ?? firstNestedNumber(row, ['speed', 'rank']);
    const outOf =
      firstNumber(row, ['outOf', 'totalRanks', 'totalRankings']) ??
      firstNestedNumber(row, ['speed', 'totalParses']);
    const durationMs = firstNumber(row, ['durationMs', 'duration']);
    const startTime = firstNumber(row, ['startTime']);

    if (
      typeof speedPercentile !== 'number' &&
      typeof executionPercentile !== 'number' &&
      typeof rank !== 'number' &&
      typeof outOf !== 'number' &&
      typeof durationMs !== 'number'
    ) {
      continue;
    }

    facts.push({
      reportCode: input.reportCode,
      reportStartTime: input.reportStartTime,
      fightId,
      encounterId: fight.encounterId,
      difficulty: fight.difficulty,
      size: fight.size,
      timeframe: input.timeframe,
      compareMode: input.compareMode,
      ...(typeof speedPercentile === 'number' ? { speedPercentile } : {}),
      ...(typeof executionPercentile === 'number' ? { executionPercentile } : {}),
      ...(typeof rank === 'number' ? { rank } : {}),
      ...(typeof outOf === 'number' ? { outOf } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(typeof startTime === 'number' ? { startTime } : {}),
      kill: fight.kill,
      ...(!fight.kill ? { isWipeRanked: true } : {}),
      sourceFetchedAt: input.fetchedAt,
    });
  }

  return facts;
};

export const collectReportRankingEnrichment = async (
  client: WclGraphqlClient,
  input: ReportRankingEnrichmentInput,
): Promise<ReportRankingEnrichmentResult> => {
  const fights = toValidFights(input.fights);
  if (fights.length === 0) {
    return { rawPayloads: [], facts: [], contexts: [] };
  }

  const fightIDs = toFightIDs(fights);
  const fightsById = new Map(fights.map((fight) => [fight.fightId, fight]));
  const timeframes = input.timeframes ?? DEFAULT_TIMEFRAMES;
  const compareModes = input.compareModes ?? DEFAULT_COMPARE_MODES;
  const rawPayloads: ReportRankingRawPayload[] = [];
  const facts: ReportRankingFact[] = [];
  const contexts: ReportRankingEnrichmentContext[] = [];

  for (const timeframe of timeframes) {
    for (const compareMode of compareModes) {
      const variables = buildQueryVariables({
        reportCode: input.reportCode,
        fightIDs,
        timeframe,
        compareMode,
      });
      const payload = await client.request<Record<string, unknown>>(
        REPORT_RANKING_ENRICHMENT_QUERY,
        variables,
      );
      const fetchedAt = new Date();
      const rankings = getRankingsNode(payload);
      const queryVarsHash = hashQueryVars(variables);

      rawPayloads.push({
        reportCode: input.reportCode,
        fetchedAt,
        queryVarsHash,
        payloadJson: rankings ?? null,
        timeframe,
        compareMode,
      });
      facts.push(
        ...normalizeFacts(rankings, {
          reportCode: input.reportCode,
          reportStartTime: input.reportStartTime,
          fightsById,
          timeframe,
          compareMode,
          fetchedAt,
        }),
      );
      contexts.push({ timeframe, compareMode });
    }
  }

  return { rawPayloads, facts, contexts };
};
