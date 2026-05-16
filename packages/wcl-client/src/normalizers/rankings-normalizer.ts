import type { ReportMetricRow, ReportParseRow } from '@wcl/domain';
import type { NormalizedLeaderboardEntry } from '@wcl/domain';

const compareString = (left: string, right: string): number => left.localeCompare(right);

const toParseRow = (
  entry: NormalizedLeaderboardEntry,
  metric: ReportParseRow['metric'],
): ReportParseRow | undefined => {
  if (!entry.playerName || typeof entry.rankPercent !== 'number') return undefined;
  return {
    playerName: entry.playerName,
    value: entry.rankPercent,
    metric,
    ...(entry.className ? { className: entry.className } : {}),
    ...(entry.specName ? { specName: entry.specName } : {}),
    ...(entry.bossName ? { bossName: entry.bossName } : {}),
    ...(typeof entry.fightId === 'number' ? { fightId: entry.fightId } : {}),
  };
};

const pickBestParse = (
  entries: NormalizedLeaderboardEntry[],
  metric: ReportParseRow['metric'],
): ReportParseRow | undefined => {
  let best: ReportParseRow | undefined;
  for (const entry of entries) {
    const row = toParseRow(entry, metric);
    if (!row) continue;
    if (
      !best ||
      row.value > best.value ||
      (row.value === best.value && compareString(row.playerName, best.playerName) < 0)
    ) {
      best = row;
    }
  }
  return best;
};

const pickHighestAverageParses = (
  entries: NormalizedLeaderboardEntry[],
): ReportMetricRow[] => {
  const perPlayer = new Map<string, ReportMetricRow>();
  for (const entry of entries) {
    if (!entry.playerName || typeof entry.performanceAverage !== 'number') continue;

    const key = entry.playerName.trim().toLowerCase();
    const candidate = {
      playerName: entry.playerName,
      value: entry.performanceAverage,
      ...(entry.className ? { className: entry.className } : {}),
      ...(entry.specName ? { specName: entry.specName } : {}),
    };
    const existing = perPlayer.get(key);
    if (
      !existing ||
      candidate.value > existing.value ||
      (candidate.value === existing.value && compareString(candidate.playerName, existing.playerName) < 0)
    ) {
      perPlayer.set(key, candidate);
    }
  }

  return [...perPlayer.values()]
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return compareString(left.playerName, right.playerName);
    })
    .slice(0, 3);
};

export const normalizeRankings = (rankings: {
  dps: NormalizedLeaderboardEntry[];
  hps: NormalizedLeaderboardEntry[];
}): {
  highestParses: {
    dps?: ReportParseRow;
    hps?: ReportParseRow;
  };
  highestAverageParse: ReportMetricRow[];
} => {
  const dps = pickBestParse(rankings.dps, 'DPS');
  const hps = pickBestParse(rankings.hps, 'HPS');
  const highestAverageParse = pickHighestAverageParses([...rankings.dps, ...rankings.hps]);

  return {
    highestParses: {
      ...(dps ? { dps } : {}),
      ...(hps ? { hps } : {}),
    },
    highestAverageParse,
  };
};
