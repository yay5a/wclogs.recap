import type { GuildRankMetricRow, GuildRankSummary } from '@wcl/domain';
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
): Map<string, GuildRankEncounterMetric> => new Map(rows.map((row) => [row.encounterName, row]));

const hasRanks = (ranks: RankPositions): boolean =>
  typeof ranks.world === 'number' ||
  typeof ranks.region === 'number' ||
  typeof ranks.realm === 'number';

const copyRanks = (ranks: RankPositions): RankPositions => ({
  ...(typeof ranks.world === 'number' ? { world: ranks.world } : {}),
  ...(typeof ranks.region === 'number' ? { region: ranks.region } : {}),
  ...(typeof ranks.realm === 'number' ? { realm: ranks.realm } : {}),
});

const normalizeMetricSection = (
  current: GuildRankMetricSet,
  baseline: GuildRankMetricSet,
  metric: 'speed' | 'execution',
): {
  overall: GuildRankMetricRow;
  bestEncounterGain?: { encounterName: string; delta: number };
  encounters: Array<{
    encounterName: string;
    speed: GuildRankMetricRow;
    execution: GuildRankMetricRow;
  }>;
} => {
  const currentByEncounter = toEncounterMetricMap(current.perEncounter);
  const baselineByEncounter = toEncounterMetricMap(baseline.perEncounter);
  const encounterNames = [
    ...new Set([...currentByEncounter.keys(), ...baselineByEncounter.keys()]),
  ].sort();

  const encounters = encounterNames.map((encounterName) => {
    const currentRow = currentByEncounter.get(encounterName);
    const baselineRow = baselineByEncounter.get(encounterName);
    const bestDerivedPercentileDelta =
      typeof currentRow?.bestDerivedPercentile === 'number' &&
      typeof baselineRow?.bestDerivedPercentile === 'number'
        ? currentRow.bestDerivedPercentile - baselineRow.bestDerivedPercentile
        : undefined;
    const medianDerivedPercentileDelta =
      typeof currentRow?.medianDerivedPercentile === 'number' &&
      typeof baselineRow?.medianDerivedPercentile === 'number'
        ? currentRow.medianDerivedPercentile - baselineRow.medianDerivedPercentile
        : undefined;

    const metricRow: GuildRankMetricRow = {
      ...(typeof currentRow?.bestDerivedPercentile === 'number'
        ? { bestDerivedPercentile: currentRow.bestDerivedPercentile }
        : {}),
      ...(typeof bestDerivedPercentileDelta === 'number' ? { bestDerivedPercentileDelta } : {}),
      ...(typeof currentRow?.medianDerivedPercentile === 'number'
        ? { medianDerivedPercentile: currentRow.medianDerivedPercentile }
        : {}),
      ...(typeof medianDerivedPercentileDelta === 'number' ? { medianDerivedPercentileDelta } : {}),
    };

    return {
      encounterName,
      speed: metric === 'speed' ? metricRow : {},
      execution: metric === 'execution' ? metricRow : {},
    };
  });

  let bestEncounterGain: { encounterName: string; delta: number } | undefined;
  for (const encounter of encounters) {
    const metricRow = encounter[metric];
    if (typeof metricRow.bestDerivedPercentileDelta !== 'number') continue;
    if (!bestEncounterGain || metricRow.bestDerivedPercentileDelta > bestEncounterGain.delta) {
      bestEncounterGain = {
        encounterName: encounter.encounterName,
        delta: metricRow.bestDerivedPercentileDelta,
      };
    }
  }

  const currentBestRows = current.perEncounter.flatMap((row) =>
    typeof row.bestDerivedPercentile === 'number' ? [row.bestDerivedPercentile] : [],
  );
  const currentMedianRows = current.perEncounter.flatMap((row) =>
    typeof row.medianDerivedPercentile === 'number' ? [row.medianDerivedPercentile] : [],
  );
  const baselineBestRows = baseline.perEncounter.flatMap((row) =>
    typeof row.bestDerivedPercentile === 'number' ? [row.bestDerivedPercentile] : [],
  );
  const baselineMedianRows = baseline.perEncounter.flatMap((row) =>
    typeof row.medianDerivedPercentile === 'number' ? [row.medianDerivedPercentile] : [],
  );

  const currentBestAvg = average(currentBestRows);
  const currentMedianAvg = average(currentMedianRows);
  const baselineBestAvg = average(baselineBestRows);
  const baselineMedianAvg = average(baselineMedianRows);

  return {
    overall: {
      ...(typeof currentBestAvg === 'number' ? { bestDerivedPercentile: currentBestAvg } : {}),
      ...(typeof currentMedianAvg === 'number'
        ? { medianDerivedPercentile: currentMedianAvg }
        : {}),
      ...(typeof currentBestAvg === 'number' && typeof baselineBestAvg === 'number'
        ? { bestDerivedPercentileDelta: currentBestAvg - baselineBestAvg }
        : {}),
      ...(typeof currentMedianAvg === 'number' && typeof baselineMedianAvg === 'number'
        ? { medianDerivedPercentileDelta: currentMedianAvg - baselineMedianAvg }
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
  const metricSourceLabel =
    bundle.metricSource === 'trend_cache'
      ? 'Cached Rank Percentiles'
      : 'Derived from indexed reports';
  const speedSourceLabel =
    bundle.metricSource === 'trend_cache' &&
    (hasSpeedOfficialRanks || hasCompleteRaidSpeedRanks)
      ? 'World, Region, Server Rank Positions and Cached Rank Percentiles'
      : metricSourceLabel;

  const speed = normalizeMetricSection(bundle.currentSpeed, bundle.baselineSpeed, 'speed');
  const execution = normalizeMetricSection(
    bundle.currentExecution,
    bundle.baselineExecution,
    'execution',
  );

  const notes: string[] = [];
  if (!hasProgressOfficialRanks) {
    notes.push('Official progress ranks unavailable; showing derived clear/pull context only.');
  }
  notes.push(
    bundle.metricSource === 'trend_cache'
      ? `Speed and Execution Rank Percentiles are read from the guild's cached reports.`
      : 'Rank percentiles are derived from indexed report windows.',
  );
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
    metricSource: bundle.metricSource,
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
        ? 'World, Region, Server Rank Positions'
        : 'Progress Only: Ranking Unavailable',
    },
    speed: {
      ...speed,
      ...(hasSpeedOfficialRanks ? { ranks: copyRanks(bundle.officialRanks.speed) } : {}),
      ...(hasCompleteRaidSpeedRanks
        ? { completeRaidRanks: copyRanks(bundle.officialRanks.completeRaidSpeed) }
        : {}),
      sourceLabel: speedSourceLabel,
    },
    execution: {
      ...execution,
      sourceLabel: metricSourceLabel,
    },
    notes,
  };
};
