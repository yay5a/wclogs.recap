import type { ReportMetricRow, ReportParseRow } from '@wcl/domain';
import type { NormalizedLeaderboardEntry } from '@wcl/domain';

const compareString = (left: string, right: string): number => left.localeCompare(right);

const toParseRow = (
  entry: NormalizedLeaderboardEntry,
  metric: ReportParseRow['metric'],
  sourceMetric?: ReportParseRow['sourceMetric'],
): ReportParseRow | undefined => {
  if (!entry.playerName || typeof entry.rankPercent !== 'number') return undefined;
  return {
    playerName: entry.playerName,
    value: entry.rankPercent,
    metric,
    ...(sourceMetric ? { sourceMetric } : {}),
    ...(entry.className ? { className: entry.className } : {}),
    ...(entry.specName ? { specName: entry.specName } : {}),
    ...(entry.bossName ? { bossName: entry.bossName } : {}),
    ...(typeof entry.fightId === 'number' ? { fightId: entry.fightId } : {}),
  };
};

const pickBestParse = (
  entries: NormalizedLeaderboardEntry[],
  metric: ReportParseRow['metric'],
  sourceMetric?: ReportParseRow['sourceMetric'],
): ReportParseRow | undefined =>
  entries
    .flatMap((entry) => {
      const row = toParseRow(entry, metric, sourceMetric);
      return row ? [row] : [];
    })
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return compareString(left.playerName, right.playerName);
    })[0];

export const normalizeRankings = (rankings: {
  dps: NormalizedLeaderboardEntry[];
  hps: NormalizedLeaderboardEntry[];
  tankDps: NormalizedLeaderboardEntry[];
}): {
  highestParses: {
    dps?: ReportParseRow;
    hps?: ReportParseRow;
    dtps?: ReportParseRow;
    dtpsAvailable: boolean;
  };
  highestAverageParse: ReportMetricRow[];
  dtpsNote: string;
} => {
  const dps = pickBestParse(rankings.dps, 'DPS');
  const hps = pickBestParse(rankings.hps, 'HPS');
  const dtpsFromTankDps = pickBestParse(rankings.tankDps, 'DTPS', 'dps-tank');
  const dtps = dtpsFromTankDps;

  const perPlayer = new Map<string, { sum: number; count: number; playerName: string }>();
  for (const row of [...rankings.dps, ...rankings.hps]) {
    if (!row.playerName || typeof row.rankPercent !== 'number') continue;
    const key = row.playerName.trim().toLowerCase();
    const existing = perPlayer.get(key) ?? { sum: 0, count: 0, playerName: row.playerName };
    existing.sum += row.rankPercent;
    existing.count += 1;
    perPlayer.set(key, existing);
  }

  const highestAverageParse = [...perPlayer.values()]
    .map((row) => ({ playerName: row.playerName, value: row.sum / row.count }))
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return compareString(left.playerName, right.playerName);
    })
    .slice(0, 3);

  const dtpsNote = dtpsFromTankDps
    ? 'WCL does not expose a direct DTPS parse ranking; DTPS parse uses DPS rankings for tanks.'
    : 'WCL does not expose a direct DTPS parse ranking, and tank DPS ranking data was unavailable.';

  return {
    highestParses: {
      ...(dps ? { dps } : {}),
      ...(hps ? { hps } : {}),
      ...(dtps ? { dtps } : {}),
      dtpsAvailable: Boolean(dtps),
    },
    highestAverageParse,
    dtpsNote,
  };
};
