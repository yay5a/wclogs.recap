import type { GuildRankSummary } from '@wcl/domain';
import type {
  GuildRankCollectorBundle,
  GuildRankEncounterMetric,
  GuildRankMetricSet,
} from '../pipeline/types.js';

const average = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

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

const toEncounterMetricMap = (
  rows: GuildRankEncounterMetric[],
): Map<string, GuildRankEncounterMetric> =>
  new Map(rows.map((row) => [row.encounterName, row]));

const normalizeMetricSection = (
  current: GuildRankMetricSet,
  baseline: GuildRankMetricSet,
): {
  overall: {
    bestPercentile?: number;
    bestDelta?: number;
    medianPercentile?: number;
    medianDelta?: number;
  };
  bestEncounterGain?: { encounterName: string; delta: number };
  encounters: Array<{
    encounterName: string;
    speed: {
      bestPercentile?: number;
      bestDelta?: number;
      medianPercentile?: number;
      medianDelta?: number;
    };
    execution: {
      bestPercentile?: number;
      bestDelta?: number;
      medianPercentile?: number;
      medianDelta?: number;
    };
  }>;
} => {
  const currentByEncounter = toEncounterMetricMap(current.perEncounter);
  const baselineByEncounter = toEncounterMetricMap(baseline.perEncounter);
  const encounterNames = [...new Set([...currentByEncounter.keys(), ...baselineByEncounter.keys()])].sort();

  const encounters = encounterNames.map((encounterName) => {
    const currentRow = currentByEncounter.get(encounterName);
    const baselineRow = baselineByEncounter.get(encounterName);
    const bestDelta =
      typeof currentRow?.bestPercentile === 'number' &&
      typeof baselineRow?.bestPercentile === 'number'
        ? currentRow.bestPercentile - baselineRow.bestPercentile
        : undefined;
    const medianDelta =
      typeof currentRow?.medianPercentile === 'number' &&
      typeof baselineRow?.medianPercentile === 'number'
        ? currentRow.medianPercentile - baselineRow.medianPercentile
        : undefined;

    return {
      encounterName,
      speed: {
        ...(typeof currentRow?.bestPercentile === 'number'
          ? { bestPercentile: currentRow.bestPercentile }
          : {}),
        ...(typeof bestDelta === 'number' ? { bestDelta } : {}),
        ...(typeof currentRow?.medianPercentile === 'number'
          ? { medianPercentile: currentRow.medianPercentile }
          : {}),
        ...(typeof medianDelta === 'number' ? { medianDelta } : {}),
      },
      execution: {
        ...(typeof currentRow?.bestPercentile === 'number'
          ? { bestPercentile: currentRow.bestPercentile }
          : {}),
        ...(typeof bestDelta === 'number' ? { bestDelta } : {}),
        ...(typeof currentRow?.medianPercentile === 'number'
          ? { medianPercentile: currentRow.medianPercentile }
          : {}),
        ...(typeof medianDelta === 'number' ? { medianDelta } : {}),
      },
    };
  });

  const bestEncounterGain = encounters
    .flatMap((encounter) =>
      typeof encounter.speed.bestDelta === 'number'
        ? [{ encounterName: encounter.encounterName, delta: encounter.speed.bestDelta }]
        : [],
    )
    .sort((left, right) => right.delta - left.delta)[0];

  const currentBestRows = current.perEncounter.flatMap((row) =>
    typeof row.bestPercentile === 'number' ? [row.bestPercentile] : [],
  );
  const currentMedianRows = current.perEncounter.flatMap((row) =>
    typeof row.medianPercentile === 'number' ? [row.medianPercentile] : [],
  );
  const baselineBestRows = baseline.perEncounter.flatMap((row) =>
    typeof row.bestPercentile === 'number' ? [row.bestPercentile] : [],
  );
  const baselineMedianRows = baseline.perEncounter.flatMap((row) =>
    typeof row.medianPercentile === 'number' ? [row.medianPercentile] : [],
  );

  const currentBestAvg = average(currentBestRows);
  const currentMedianAvg = average(currentMedianRows);
  const baselineBestAvg = average(baselineBestRows);
  const baselineMedianAvg = average(baselineMedianRows);

  return {
    overall: {
      ...(typeof currentBestAvg === 'number' ? { bestPercentile: currentBestAvg } : {}),
      ...(typeof currentMedianAvg === 'number' ? { medianPercentile: currentMedianAvg } : {}),
      ...(typeof currentBestAvg === 'number' && typeof baselineBestAvg === 'number'
        ? { bestDelta: currentBestAvg - baselineBestAvg }
        : {}),
      ...(typeof currentMedianAvg === 'number' && typeof baselineMedianAvg === 'number'
        ? { medianDelta: currentMedianAvg - baselineMedianAvg }
        : {}),
    },
    ...(bestEncounterGain ? { bestEncounterGain } : {}),
    encounters,
  };
};

export const normalizeGuildRankRenderModel = (
  bundle: GuildRankCollectorBundle,
): GuildRankSummary => {
  const progressRanks = bundle.officialRanks.progress;
  const speedRanks = bundle.officialRanks.speed;
  const hasProgressOfficialRanks =
    typeof progressRanks.world === 'number' ||
    typeof progressRanks.region === 'number' ||
    typeof progressRanks.realm === 'number';
  const hasSpeedOfficialRanks =
    typeof speedRanks.world === 'number' ||
    typeof speedRanks.region === 'number' ||
    typeof speedRanks.realm === 'number';

  const speed = normalizeMetricSection(bundle.currentSpeed, bundle.baselineSpeed);
  const execution = normalizeMetricSection(bundle.currentExecution, bundle.baselineExecution);

  const notes: string[] = [];
  if (!hasProgressOfficialRanks) {
    notes.push('Official progress ranks unavailable; showing derived clear/pull context only.');
  }
  if (!hasSpeedOfficialRanks) {
    notes.push('Official speed ranks unavailable; showing derived report metrics.');
  }
  if (bundle.currentReports.length === 0) {
    notes.push('No current-window reports were discovered for the configured guild and zone.');
  }

  return {
    guildName: bundle.input.guildName,
    zoneName: bundle.zoneName,
    difficultyLabel: bundle.difficultyLabel,
    sizeLabel: bundle.sizeLabel,
    window: {
      currentStartIso: new Date(bundle.windows.currentStartMs).toISOString(),
      currentEndIso: new Date(bundle.windows.currentEndMs).toISOString(),
      baselineStartIso: new Date(bundle.windows.baselineStartMs).toISOString(),
      baselineEndIso: new Date(bundle.windows.baselineEndMs).toISOString(),
    },
    progress: {
      clearedEncounters: bundle.progressPulls.clearedEncounters,
      totalEncounters: bundle.progressPulls.totalEncounters,
      pulls: bundle.progressPulls.pulls,
      wipes: bundle.progressPulls.wipes,
      ranks: {
        ...(typeof progressRanks.world === 'number' ? { world: progressRanks.world } : {}),
        ...(typeof progressRanks.region === 'number' ? { region: progressRanks.region } : {}),
        ...(typeof progressRanks.realm === 'number' ? { realm: progressRanks.realm } : {}),
      },
      ranksAvailable: hasProgressOfficialRanks,
      sourceLabel: hasProgressOfficialRanks
        ? 'Official WCL Rankings'
        : 'Progress Only: Ranking Unavailable',
    },
    speed: {
      ...speed,
      sourceLabel: hasSpeedOfficialRanks ? 'Official WCL Rankings' : 'Derived from WCL Reports',
      ...(hasSpeedOfficialRanks
        ? {
            ranks: {
              ...(typeof speedRanks.world === 'number' ? { world: speedRanks.world } : {}),
              ...(typeof speedRanks.region === 'number' ? { region: speedRanks.region } : {}),
              ...(typeof speedRanks.realm === 'number' ? { realm: speedRanks.realm } : {}),
            },
          }
        : {}),
    },
    execution: {
      ...execution,
      sourceLabel: 'Derived from WCL Reports',
    },
    notes,
  };
};
