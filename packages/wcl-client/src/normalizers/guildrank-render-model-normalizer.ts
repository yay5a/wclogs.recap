import type { GuildRankSummary } from '@wcl/domain';
import type {
  GuildRankCollectorBundle,
  GuildRankEncounterMetric,
  GuildRankMetricSet,
} from '../pipeline/types.js';

type RankPositions = { world?: number; region?: number; realm?: number };

const average = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toEncounterMetricMap = (
  rows: GuildRankEncounterMetric[],
): Map<string, GuildRankEncounterMetric> =>
  new Map(rows.map((row) => [row.encounterName, row]));

const hasRanks = (ranks: RankPositions): boolean =>
  typeof ranks.world === 'number' || typeof ranks.region === 'number' || typeof ranks.realm === 'number';

const copyRanks = (ranks: RankPositions): RankPositions => ({
  ...(typeof ranks.world === 'number' ? { world: ranks.world } : {}),
  ...(typeof ranks.region === 'number' ? { region: ranks.region } : {}),
  ...(typeof ranks.realm === 'number' ? { realm: ranks.realm } : {}),
});

const normalizeMetricSection = (
  current: GuildRankMetricSet,
  baseline: GuildRankMetricSet,
): {
  overall: {
    bestScore?: number;
    bestScoreDelta?: number;
    medianScore?: number;
    medianScoreDelta?: number;
  };
  bestEncounterGain?: { encounterName: string; delta: number };
  encounters: Array<{
    encounterName: string;
    speed: {
      bestScore?: number;
      bestScoreDelta?: number;
      medianScore?: number;
      medianScoreDelta?: number;
    };
    execution: {
      bestScore?: number;
      bestScoreDelta?: number;
      medianScore?: number;
      medianScoreDelta?: number;
    };
  }>;
} => {
  const currentByEncounter = toEncounterMetricMap(current.perEncounter);
  const baselineByEncounter = toEncounterMetricMap(baseline.perEncounter);
  const encounterNames = [...new Set([...currentByEncounter.keys(), ...baselineByEncounter.keys()])].sort();

  const encounters = encounterNames.map((encounterName) => {
    const currentRow = currentByEncounter.get(encounterName);
    const baselineRow = baselineByEncounter.get(encounterName);
    const bestScoreDelta =
      typeof currentRow?.bestScore === 'number' &&
      typeof baselineRow?.bestScore === 'number'
        ? currentRow.bestScore - baselineRow.bestScore
        : undefined;
    const medianScoreDelta =
      typeof currentRow?.medianScore === 'number' &&
      typeof baselineRow?.medianScore === 'number'
        ? currentRow.medianScore - baselineRow.medianScore
        : undefined;

    return {
      encounterName,
      speed: {
        ...(typeof currentRow?.bestScore === 'number'
          ? { bestScore: currentRow.bestScore }
          : {}),
        ...(typeof bestScoreDelta === 'number' ? { bestScoreDelta } : {}),
        ...(typeof currentRow?.medianScore === 'number'
          ? { medianScore: currentRow.medianScore }
          : {}),
        ...(typeof medianScoreDelta === 'number' ? { medianScoreDelta } : {}),
      },
      execution: {
        ...(typeof currentRow?.bestScore === 'number'
          ? { bestScore: currentRow.bestScore }
          : {}),
        ...(typeof bestScoreDelta === 'number' ? { bestScoreDelta } : {}),
        ...(typeof currentRow?.medianScore === 'number'
          ? { medianScore: currentRow.medianScore }
          : {}),
        ...(typeof medianScoreDelta === 'number' ? { medianScoreDelta } : {}),
      },
    };
  });

  let bestEncounterGain: { encounterName: string; delta: number } | undefined;
  for (const encounter of encounters) {
    if (typeof encounter.speed.bestScoreDelta !== 'number') continue;
    if (!bestEncounterGain || encounter.speed.bestScoreDelta > bestEncounterGain.delta) {
      bestEncounterGain = {
        encounterName: encounter.encounterName,
        delta: encounter.speed.bestScoreDelta,
      };
    }
  }

  const currentBestRows = current.perEncounter.flatMap((row) =>
    typeof row.bestScore === 'number' ? [row.bestScore] : [],
  );
  const currentMedianRows = current.perEncounter.flatMap((row) =>
    typeof row.medianScore === 'number' ? [row.medianScore] : [],
  );
  const baselineBestRows = baseline.perEncounter.flatMap((row) =>
    typeof row.bestScore === 'number' ? [row.bestScore] : [],
  );
  const baselineMedianRows = baseline.perEncounter.flatMap((row) =>
    typeof row.medianScore === 'number' ? [row.medianScore] : [],
  );

  const currentBestAvg = average(currentBestRows);
  const currentMedianAvg = average(currentMedianRows);
  const baselineBestAvg = average(baselineBestRows);
  const baselineMedianAvg = average(baselineMedianRows);

  return {
    overall: {
      ...(typeof currentBestAvg === 'number' ? { bestScore: currentBestAvg } : {}),
      ...(typeof currentMedianAvg === 'number' ? { medianScore: currentMedianAvg } : {}),
      ...(typeof currentBestAvg === 'number' && typeof baselineBestAvg === 'number'
        ? { bestScoreDelta: currentBestAvg - baselineBestAvg }
        : {}),
      ...(typeof currentMedianAvg === 'number' && typeof baselineMedianAvg === 'number'
        ? { medianScoreDelta: currentMedianAvg - baselineMedianAvg }
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
  const hasProgressOfficialRanks = hasRanks(progressRanks);
  const hasSpeedOfficialRanks = hasRanks(bundle.officialRanks.speed);
  const hasCompleteRaidSpeedRanks = hasRanks(bundle.officialRanks.completeRaidSpeed);

  const speed = normalizeMetricSection(
    bundle.currentSpeed,
    bundle.baselineSpeed,
  );
  const execution = normalizeMetricSection(
    bundle.currentExecution,
    bundle.baselineExecution,
  );

  const notes: string[] = [];
  if (!hasProgressOfficialRanks) {
    notes.push('Official progress ranks unavailable; showing derived clear/pull context only.');
  }
  notes.push('WCL guild rank percentiles unavailable; showing speed/execution scores derived from reports.');
  if (bundle.currentWindowDiscovery.candidateReports === 0) {
    notes.push('No current-window reports were discovered for the configured guild and zone.');
  } else if (bundle.currentWindowDiscovery.zoneMatchedReports === 0) {
    notes.push(
      'Current-window reports were discovered, but none matched the configured zone filter.',
    );
  } else if (bundle.currentWindowDiscovery.difficultySizeMatchedReports === 0) {
    notes.push(
      'Current-window reports were discovered, but none matched the configured difficulty/size filters.',
    );
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
      ranks: copyRanks(progressRanks),
      ranksAvailable: hasProgressOfficialRanks,
      sourceLabel: hasProgressOfficialRanks
        ? 'Official WCL Rankings'
        : 'Progress Only: Ranking Unavailable',
    },
    speed: {
      ...speed,
      ...(hasSpeedOfficialRanks ? { ranks: copyRanks(bundle.officialRanks.speed) } : {}),
      ...(hasCompleteRaidSpeedRanks
        ? { completeRaidRanks: copyRanks(bundle.officialRanks.completeRaidSpeed) }
        : {}),
      sourceLabel: 'Derived from WCL Reports',
    },
    execution: {
      ...execution,
      sourceLabel: 'Derived from WCL Reports',
    },
    notes,
  };
};
