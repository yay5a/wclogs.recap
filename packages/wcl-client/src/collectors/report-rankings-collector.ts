import type { NormalizedLeaderboardEntry } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { parseReportRankingsPayloadForRole } from '../parsers/rankings.js';

const REPORT_RANKINGS_QUERY = `
query ReportRankings($code: String!, $allowUnlisted: Boolean!, $fightIDs: [Int], $playerMetric: ReportRankingMetricType!) {
  reportData {
    report(code: $code, allowUnlisted: $allowUnlisted) {
      rankings(fightIDs: $fightIDs, playerMetric: $playerMetric, timeframe: Today, compare: Rankings)
    }
  }
}`;

const getRankingsNode = (payload: unknown): unknown => {
  const root = payload as { data?: { reportData?: { report?: { rankings?: unknown } } } };
  return root?.data?.reportData?.report?.rankings;
};

export const collectReportRankings = async (
  client: WclGraphqlClient,
  input: { reportCode: string; killFightIds: number[] },
): Promise<{
  dps: NormalizedLeaderboardEntry[];
  hps: NormalizedLeaderboardEntry[];
}> => {
  if (input.killFightIds.length === 0) {
    return { dps: [], hps: [] };
  }

  const [dpsResult, hpsResult] = await Promise.allSettled([
    client.request<Record<string, unknown>>(REPORT_RANKINGS_QUERY, {
      code: input.reportCode,
      allowUnlisted: true,
      fightIDs: input.killFightIds,
      playerMetric: 'dps',
    }),
    client.request<Record<string, unknown>>(REPORT_RANKINGS_QUERY, {
      code: input.reportCode,
      allowUnlisted: true,
      fightIDs: input.killFightIds,
      playerMetric: 'hps',
    }),
  ]);

  const dpsPayload = dpsResult.status === 'fulfilled' ? dpsResult.value : undefined;
  const hpsPayload = hpsResult.status === 'fulfilled' ? hpsResult.value : undefined;

  return {
    dps: parseReportRankingsPayloadForRole(getRankingsNode(dpsPayload), 'dps'),
    hps: parseReportRankingsPayloadForRole(getRankingsNode(hpsPayload), 'healer'),
  };
};
