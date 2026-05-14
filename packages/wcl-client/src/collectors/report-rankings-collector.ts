import type { NormalizedLeaderboardEntry } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { parseReportRankingsPayloadForRole } from '../parsers/rankings.js';

const REPORT_RANKINGS_QUERY = `
query ReportRankings($code: String!, $allowUnlisted: Boolean!, $playerMetric: ReportRankingMetricType!) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      rankings(playerMetric: $playerMetric, timeframe: Today, compare: Rankings)
    }
  }
}`;

const getRankingsNode = (payload: unknown): unknown => {
  const root = payload as { data?: { reportData?: { report?: { rankings?: unknown } } } };
  return root?.data?.reportData?.report?.rankings;
};

const filterToFightIds = (
  rows: NormalizedLeaderboardEntry[],
  allowedFightIds: Set<number>,
): NormalizedLeaderboardEntry[] =>
  rows.filter((row) => typeof row.fightId === 'number' && allowedFightIds.has(row.fightId));

export const collectReportRankings = async (
  client: WclGraphqlClient,
  input: { reportCode: string; killFightIds: number[] },
): Promise<{
  dps: NormalizedLeaderboardEntry[];
  hps: NormalizedLeaderboardEntry[];
  krsi: NormalizedLeaderboardEntry[];
}> => {
  const allowedFightIds = new Set(input.killFightIds);
  if (allowedFightIds.size === 0) {
    return { dps: [], hps: [], krsi: [] };
  }

  const [dpsResult, hpsResult, krsiResult] = await Promise.allSettled([
    client.request<Record<string, unknown>>(REPORT_RANKINGS_QUERY, {
      code: input.reportCode,
      allowUnlisted: true,
      playerMetric: 'dps',
    }),
    client.request<Record<string, unknown>>(REPORT_RANKINGS_QUERY, {
      code: input.reportCode,
      allowUnlisted: true,
      playerMetric: 'hps',
    }),
    client.request<Record<string, unknown>>(REPORT_RANKINGS_QUERY, {
      code: input.reportCode,
      allowUnlisted: true,
      playerMetric: 'krsi',
    }),
  ]);

  const dpsPayload = dpsResult.status === 'fulfilled' ? dpsResult.value : undefined;
  const hpsPayload = hpsResult.status === 'fulfilled' ? hpsResult.value : undefined;
  const krsiPayload = krsiResult.status === 'fulfilled' ? krsiResult.value : undefined;

  return {
    dps: filterToFightIds(
      parseReportRankingsPayloadForRole(getRankingsNode(dpsPayload), 'dps'),
      allowedFightIds,
    ),
    hps: filterToFightIds(
      parseReportRankingsPayloadForRole(getRankingsNode(hpsPayload), 'healer'),
      allowedFightIds,
    ),
    krsi: filterToFightIds(
      parseReportRankingsPayloadForRole(getRankingsNode(krsiPayload), 'tank'),
      allowedFightIds,
    ),
  };
};
