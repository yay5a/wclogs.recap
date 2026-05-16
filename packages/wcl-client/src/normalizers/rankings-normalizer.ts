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

const buildAverageParseCandidates = (
  entries: NormalizedLeaderboardEntry[],
): ReportMetricRow[] => {
  const perPlayer = new Map<
    string,
    {
      playerName: string;
      sum: number;
      count: number;
      performanceAverage?: number;
      className?: string;
      specName?: string;
    }
  >();

  for (const entry of entries) {
    if (!entry.playerName) continue;

    const key = entry.playerName.trim().toLowerCase();
    const existing =
      perPlayer.get(key) ??
      {
        playerName: entry.playerName,
        sum: 0,
        count: 0,
        ...(entry.className ? { className: entry.className } : {}),
        ...(entry.specName ? { specName: entry.specName } : {}),
      };

    if (typeof entry.performanceAverage === 'number') {
      existing.performanceAverage =
        typeof existing.performanceAverage === 'number'
          ? Math.max(existing.performanceAverage, entry.performanceAverage)
          : entry.performanceAverage;
    }

    if (typeof entry.rankPercent === 'number') {
      existing.sum += entry.rankPercent;
      existing.count += 1;
    }

    if (!existing.className && entry.className) existing.className = entry.className;
    if (!existing.specName && entry.specName) existing.specName = entry.specName;

    perPlayer.set(key, existing);
  }

  return [...perPlayer.values()].flatMap((row) => {
    const value =
      typeof row.performanceAverage === 'number'
        ? row.performanceAverage
        : row.count > 0
          ? row.sum / row.count
          : undefined;

    if (typeof value !== 'number') return [];

    return [
      {
        playerName: row.playerName,
        value,
        ...(row.className ? { className: row.className } : {}),
        ...(row.specName ? { specName: row.specName } : {}),
      },
    ];
  });
};

const pickHighestAverageParses = (rankings: {
  dps: NormalizedLeaderboardEntry[];
  hps: NormalizedLeaderboardEntry[];
}): ReportMetricRow[] => {
  const candidates = [
    ...buildAverageParseCandidates(rankings.dps),
    ...buildAverageParseCandidates(rankings.hps),
  ];

  const bestByPlayer = new Map<string, ReportMetricRow>();

  for (const candidate of candidates) {
    const key = candidate.playerName.trim().toLowerCase();
    const existing = bestByPlayer.get(key);

    if (
      !existing ||
      candidate.value > existing.value ||
      (candidate.value === existing.value &&
        compareString(candidate.playerName, existing.playerName) < 0)
    ) {
      bestByPlayer.set(key, candidate);
    }
  }

  return [...bestByPlayer.values()]
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
  const highestAverageParse = pickHighestAverageParses(rankings);

  return {
    highestParses: {
      ...(dps ? { dps } : {}),
      ...(hps ? { hps } : {}),
    },
    highestAverageParse,
  };
};
