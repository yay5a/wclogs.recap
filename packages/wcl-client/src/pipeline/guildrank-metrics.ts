import type {
  GuildRankEncounterMetric,
  GuildRankInput,
  GuildRankMetricSet,
  GuildRankWeeklyTrendRow,
  GuildRankWindows,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface GuildRankTrendMetricSets {
  currentSpeed: GuildRankMetricSet;
  baselineSpeed: GuildRankMetricSet;
  currentExecution: GuildRankMetricSet;
  baselineExecution: GuildRankMetricSet;
  sampleCount: number;
  clearedEncounters: number;
  windows: GuildRankWindows;
  weekStart: Date;
}

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
  const value = sorted[middle];
  return typeof value === 'number' ? value : undefined;
};

const toDerivedPercentile = (
  value: number,
  allValues: number[],
  lowerIsBetter: boolean,
): number => {
  if (allValues.length === 0) return 0;
  const favorableCount = allValues.filter((row) =>
    lowerIsBetter ? row >= value : row <= value,
  ).length;
  return (favorableCount / allValues.length) * 100;
};

export const buildWindows = (): GuildRankWindows => {
  const currentEndMs = Date.now();
  const currentStartMs = currentEndMs - 7 * DAY_MS;
  const baselineEndMs = currentStartMs;
  const baselineStartMs = baselineEndMs - 14 * DAY_MS;
  return {
    currentStartMs,
    currentEndMs,
    baselineStartMs,
    baselineEndMs,
  };
};

export const buildMetricSet = (
  currentRows: Map<string, number[]>,
  baselineRows: Map<string, number[]>,
  lowerIsBetter: boolean,
): { current: GuildRankMetricSet; baseline: GuildRankMetricSet } => {
  const encounterNames = [...new Set([...currentRows.keys(), ...baselineRows.keys()])].sort();

  const toSet = (
    rows: Map<string, number[]>,
    peerRows: Map<string, number[]>,
  ): GuildRankMetricSet => {
    const perEncounter: GuildRankEncounterMetric[] = [];

    for (const encounterName of encounterNames) {
      const currentValues = rows.get(encounterName) ?? [];
      const baselineValues = peerRows.get(encounterName) ?? [];
      const allValuesRaw = [...currentValues, ...baselineValues];
      const scores = currentValues.map((value) =>
        toDerivedPercentile(value, allValuesRaw, lowerIsBetter),
      );
      const bestDerivedPercentile = scores.length > 0 ? Math.max(...scores) : undefined;
      const medianDerivedPercentile = median(scores);

      perEncounter.push({
        encounterName,
        ...(typeof bestDerivedPercentile === 'number' ? { bestDerivedPercentile } : {}),
        ...(typeof medianDerivedPercentile === 'number' ? { medianDerivedPercentile } : {}),
      });
    }

    return {
      perEncounter,
    };
  };

  return {
    current: toSet(currentRows, baselineRows),
    baseline: toSet(baselineRows, currentRows),
  };
};

const hasTrendMetric = (row: GuildRankWeeklyTrendRow): boolean =>
  typeof row.speedMedian === 'number' ||
  typeof row.speedP90 === 'number' ||
  typeof row.executionMedian === 'number' ||
  typeof row.executionP90 === 'number';

const trendTimeframePriority = (row: GuildRankWeeklyTrendRow): number =>
  row.timeframe === 'today' ? 0 : 1;

const trendPartitionKey = (row: GuildRankWeeklyTrendRow): string =>
  typeof row.partition === 'number' ? String(row.partition) : '';

const trendEncounterPartitionKey = (row: GuildRankWeeklyTrendRow): string =>
  `${row.encounterId}:${trendPartitionKey(row)}`;

const selectPreferredTrendRows = (
  rows: GuildRankWeeklyTrendRow[],
): Map<string, GuildRankWeeklyTrendRow> => {
  const byWeekEncounter = new Map<string, GuildRankWeeklyTrendRow>();

  for (const row of rows) {
    const key = `${row.weekStart.getTime()}:${trendEncounterPartitionKey(row)}`;
    const existing = byWeekEncounter.get(key);
    if (!existing || trendTimeframePriority(row) < trendTimeframePriority(existing)) {
      byWeekEncounter.set(key, row);
    }
  }

  return byWeekEncounter;
};

const toTrendMetricRow = (
  row: GuildRankWeeklyTrendRow,
  metric: 'speed' | 'execution',
): GuildRankEncounterMetric => {
  if (metric === 'speed') {
    return {
      encounterName: '',
      ...(typeof row.speedP90 === 'number' ? { bestDerivedPercentile: row.speedP90 } : {}),
      ...(typeof row.speedMedian === 'number' ? { medianDerivedPercentile: row.speedMedian } : {}),
    };
  }

  return {
    encounterName: '',
    ...(typeof row.executionP90 === 'number' ? { bestDerivedPercentile: row.executionP90 } : {}),
    ...(typeof row.executionMedian === 'number'
      ? { medianDerivedPercentile: row.executionMedian }
      : {}),
  };
};

const toFallbackBaselineTrendMetricRow = (
  row: GuildRankWeeklyTrendRow,
  metric: 'speed' | 'execution',
): GuildRankEncounterMetric | undefined => {
  const currentMedian = metric === 'speed' ? row.speedMedian : row.executionMedian;
  const medianDelta = metric === 'speed' ? row.speedMedianDelta : row.executionMedianDelta;
  if (typeof currentMedian !== 'number' || typeof medianDelta !== 'number') return undefined;
  return {
    encounterName: '',
    medianDerivedPercentile: currentMedian - medianDelta,
  };
};

const hasMetricValues = (row: GuildRankEncounterMetric): boolean =>
  typeof row.bestDerivedPercentile === 'number' || typeof row.medianDerivedPercentile === 'number';

const filterTrendRowsByPartition = (
  rows: GuildRankWeeklyTrendRow[],
  partition: GuildRankInput['partition'],
): GuildRankWeeklyTrendRow[] => {
  if (partition === 'all') return rows;
  if (typeof partition === 'number') return rows.filter((row) => row.partition === partition);

  const partitions = rows.flatMap((row) =>
    typeof row.partition === 'number' ? [row.partition] : [],
  );
  if (partitions.length === 0) {
    return rows.filter((row) => row.partition === undefined);
  }

  const latestPartition = Math.max(...partitions);
  return rows.filter((row) => row.partition === latestPartition);
};

export const buildTrendMetricSets = (
  rows: GuildRankWeeklyTrendRow[],
  resolved: {
    difficultyId: number;
    sizeValue: number;
    partition?: GuildRankInput['partition'];
    encounters: Array<{ id: number; name: string }>;
  },
): GuildRankTrendMetricSets | undefined => {
  const encounterNameById = new Map(
    resolved.encounters.map((encounter) => [encounter.id, encounter.name]),
  );
  const requestedEncounterIds = new Set(encounterNameById.keys());
  const matchingTrendRows = rows.filter(
    (row) =>
      row.difficulty === resolved.difficultyId &&
      row.size === resolved.sizeValue &&
      row.compareMode === 'rankings' &&
      (requestedEncounterIds.size === 0 || requestedEncounterIds.has(row.encounterId)) &&
      hasTrendMetric(row),
  );
  const trendRows = filterTrendRowsByPartition(matchingTrendRows, resolved.partition);
  if (trendRows.length === 0) return undefined;

  const latestWeekStartMs = Math.max(...trendRows.map((row) => row.weekStart.getTime()));
  const previousWeekStartMs = latestWeekStartMs - WEEK_MS;
  const trendWindows: GuildRankWindows = {
    currentStartMs: latestWeekStartMs,
    currentEndMs: latestWeekStartMs + WEEK_MS - 1,
    baselineStartMs: previousWeekStartMs,
    baselineEndMs: latestWeekStartMs - 1,
  };
  const preferredRows = selectPreferredTrendRows(trendRows);
  const currentRows = [...preferredRows.values()]
    .filter((row) => row.weekStart.getTime() === latestWeekStartMs)
    .sort((left, right) => left.encounterId - right.encounterId);
  if (currentRows.length === 0) return undefined;
  const baselineRowsByEncounter = new Map(
    [...preferredRows.values()]
      .filter((row) => row.weekStart.getTime() === previousWeekStartMs)
      .map((row) => [trendEncounterPartitionKey(row), row]),
  );

  const toMetricSet = (
    sourceRows: GuildRankWeeklyTrendRow[],
    metric: 'speed' | 'execution',
  ): GuildRankMetricSet => ({
    perEncounter: sourceRows.flatMap((row) => {
      const metricRow = toTrendMetricRow(row, metric);
      if (!hasMetricValues(metricRow)) return [];
      return [
        {
          ...metricRow,
          encounterName: encounterNameById.get(row.encounterId) ?? `Encounter ${row.encounterId}`,
        },
      ];
    }),
  });

  const toBaselineMetricSet = (metric: 'speed' | 'execution'): GuildRankMetricSet => ({
    perEncounter: currentRows.flatMap((currentRow) => {
      const baselineRow = baselineRowsByEncounter.get(trendEncounterPartitionKey(currentRow));
      const metricRow = baselineRow
        ? toTrendMetricRow(baselineRow, metric)
        : toFallbackBaselineTrendMetricRow(currentRow, metric);
      if (!metricRow || !hasMetricValues(metricRow)) return [];
      return [
        {
          ...metricRow,
          encounterName:
            encounterNameById.get(currentRow.encounterId) ?? `Encounter ${currentRow.encounterId}`,
        },
      ];
    }),
  });

  const currentSpeed = toMetricSet(currentRows, 'speed');
  const currentExecution = toMetricSet(currentRows, 'execution');
  if (currentSpeed.perEncounter.length === 0 && currentExecution.perEncounter.length === 0) {
    return undefined;
  }

  return {
    currentSpeed,
    baselineSpeed: toBaselineMetricSet('speed'),
    currentExecution,
    baselineExecution: toBaselineMetricSet('execution'),
    sampleCount: currentRows.reduce((sum, row) => sum + row.sampleCount, 0),
    clearedEncounters: currentRows.length,
    windows: trendWindows,
    weekStart: new Date(latestWeekStartMs),
  };
};
