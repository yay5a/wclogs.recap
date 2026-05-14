import type { GuildRankSummary } from '@wcl/domain';
import type { WclGraphqlClient } from '../graphql-client.js';
import { collectGuildReportDiscovery } from '../collectors/guild-report-discovery-collector.js';
import { resolveGuildConfigZoneInput } from '../collectors/guild-config-zone-input-resolver.js';
import { collectOfficialGuildZoneRankings } from '../collectors/official-guild-zone-rankings-collector.js';
import { collectReportIndex } from '../collectors/report-index-collector.js';
import { collectTableMetrics } from '../collectors/table-collector.js';
import { normalizeGuildRankRenderModel } from '../normalizers/guildrank-render-model-normalizer.js';
import type {
  GuildRankCollectorBundle,
  GuildRankEncounterMetric,
  GuildRankInput,
  GuildRankMetricSet,
  GuildRankWindows,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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

const toPercentile = (
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

const buildWindows = (): GuildRankWindows => {
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

interface EncounterMetricsByReport {
  speedByEncounter: Map<string, number>;
  executionByEncounter: Map<string, number>;
  pulls: number;
  wipes: number;
  clearedEncounters: Set<string>;
}

const collectEncounterMetricsFromReport = async (
  client: WclGraphqlClient,
  reportCode: string,
  difficultyId: number,
  sizeValue: number,
): Promise<EncounterMetricsByReport> => {
  const index = await collectReportIndex(client, {
    reportCode,
    sourceUrl: `https://www.warcraftlogs.com/reports/${reportCode}`,
    gameFamily: 'retail',
  });

  const filteredFights = index.completedBossFights.filter(
    (fight) => fight.difficulty === difficultyId && fight.size === sizeValue,
  );

  const tableMetrics = await collectTableMetrics(client, {
    reportCode,
    completedFightIds: filteredFights.map((fight) => fight.id),
  });

  const byEncounter = new Map<string, typeof filteredFights>();
  for (const fight of filteredFights) {
    byEncounter.set(fight.name, [...(byEncounter.get(fight.name) ?? []), fight]);
  }

  const speedByEncounter = new Map<string, number>();
  const executionByEncounter = new Map<string, number>();
  const clearedEncounters = new Set<string>();

  for (const [encounterName, fights] of byEncounter.entries()) {
    const killFights = fights.filter((fight) => fight.kill);
    if (killFights.length === 0) continue;

    clearedEncounters.add(encounterName);

    const fastestDuration = killFights
      .map((fight) => Math.max(0, fight.endTime - fight.startTime))
      .sort((left, right) => left - right)[0];
    if (typeof fastestDuration === 'number') {
      speedByEncounter.set(encounterName, fastestDuration);
    }

    const lowestDeaths = killFights
      .map((fight) => tableMetrics.deathsByFightId[fight.id] ?? 0)
      .sort((left, right) => left - right)[0];
    if (typeof lowestDeaths === 'number') {
      executionByEncounter.set(encounterName, lowestDeaths);
    }
  }

  return {
    speedByEncounter,
    executionByEncounter,
    pulls: filteredFights.length,
    wipes: filteredFights.filter((fight) => !fight.kill).length,
    clearedEncounters,
  };
};

const buildMetricSet = (
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
      const percentiles = currentValues.map((value) =>
        toPercentile(value, allValuesRaw, lowerIsBetter),
      );
      const bestPercentile = percentiles.length > 0 ? Math.max(...percentiles) : undefined;
      const medianPercentile = median(percentiles);

      perEncounter.push({
        encounterName,
        ...(typeof bestPercentile === 'number' ? { bestPercentile } : {}),
        ...(typeof medianPercentile === 'number' ? { medianPercentile } : {}),
      });
    }

    const overallBestPercentile = median(
      perEncounter.flatMap((row) => (typeof row.bestPercentile === 'number' ? [row.bestPercentile] : [])),
    );
    const overallMedianPercentile = median(
      perEncounter.flatMap((row) => (typeof row.medianPercentile === 'number' ? [row.medianPercentile] : [])),
    );

    return {
      ...(typeof overallBestPercentile === 'number' ? { overallBestPercentile } : {}),
      ...(typeof overallMedianPercentile === 'number' ? { overallMedianPercentile } : {}),
      perEncounter,
    };
  };

  return {
    current: toSet(currentRows, baselineRows),
    baseline: toSet(baselineRows, currentRows),
  };
};

export const collectGuildRankSummaryData = async (
  client: WclGraphqlClient,
  input: GuildRankInput,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<GuildRankSummary> => {
  const resolved = await resolveGuildConfigZoneInput(client, input);
  const windows = buildWindows();

  const [currentDiscovery, baselineDiscovery, officialRanks] = await Promise.all([
    collectGuildReportDiscovery(client, {
      guildName: resolved.guildName,
      guildServerSlug: resolved.guildServerSlug,
      guildServerRegion: resolved.guildServerRegion,
      zoneId: resolved.zoneId,
      startTimeMs: windows.currentStartMs,
      endTimeMs: windows.currentEndMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }),
    collectGuildReportDiscovery(client, {
      guildName: resolved.guildName,
      guildServerSlug: resolved.guildServerSlug,
      guildServerRegion: resolved.guildServerRegion,
      zoneId: resolved.zoneId,
      startTimeMs: windows.baselineStartMs,
      endTimeMs: windows.baselineEndMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }),
    collectOfficialGuildZoneRankings(client, {
      guildName: resolved.guildName,
      guildServerSlug: resolved.guildServerSlug,
      guildServerRegion: resolved.guildServerRegion,
      zoneId: resolved.zoneId,
      difficulty: resolved.difficultyId,
      size: resolved.sizeValue,
    }),
  ]);

  const currentMetricsByEncounter = new Map<string, number[]>();
  const baselineMetricsByEncounter = new Map<string, number[]>();
  const currentExecutionByEncounter = new Map<string, number[]>();
  const baselineExecutionByEncounter = new Map<string, number[]>();

  let progressPulls = 0;
  let progressWipes = 0;
  const currentClears = new Set<string>();

  for (const row of currentDiscovery.rows) {
    const reportMetrics = await collectEncounterMetricsFromReport(
      client,
      row.code,
      resolved.difficultyId,
      resolved.sizeValue,
    );

    progressPulls += reportMetrics.pulls;
    progressWipes += reportMetrics.wipes;
    for (const encounter of reportMetrics.clearedEncounters) {
      currentClears.add(encounter);
    }

    for (const [encounterName, speedValue] of reportMetrics.speedByEncounter.entries()) {
      currentMetricsByEncounter.set(encounterName, [
        ...(currentMetricsByEncounter.get(encounterName) ?? []),
        speedValue,
      ]);
    }
    for (const [encounterName, executionValue] of reportMetrics.executionByEncounter.entries()) {
      currentExecutionByEncounter.set(encounterName, [
        ...(currentExecutionByEncounter.get(encounterName) ?? []),
        executionValue,
      ]);
    }
  }

  for (const row of baselineDiscovery.rows) {
    const reportMetrics = await collectEncounterMetricsFromReport(
      client,
      row.code,
      resolved.difficultyId,
      resolved.sizeValue,
    );

    for (const [encounterName, speedValue] of reportMetrics.speedByEncounter.entries()) {
      baselineMetricsByEncounter.set(encounterName, [
        ...(baselineMetricsByEncounter.get(encounterName) ?? []),
        speedValue,
      ]);
    }
    for (const [encounterName, executionValue] of reportMetrics.executionByEncounter.entries()) {
      baselineExecutionByEncounter.set(encounterName, [
        ...(baselineExecutionByEncounter.get(encounterName) ?? []),
        executionValue,
      ]);
    }
  }

  const speedSets = buildMetricSet(currentMetricsByEncounter, baselineMetricsByEncounter, true);
  const executionSets = buildMetricSet(currentExecutionByEncounter, baselineExecutionByEncounter, true);

  const bundle: GuildRankCollectorBundle = {
    input,
    windows,
    officialRanks,
    currentReports: currentDiscovery.rows,
    baselineReports: baselineDiscovery.rows,
    currentSpeed: speedSets.current,
    baselineSpeed: speedSets.baseline,
    currentExecution: executionSets.current,
    baselineExecution: executionSets.baseline,
    progressPulls: {
      pulls: progressPulls,
      wipes: progressWipes,
      clearedEncounters: currentClears.size,
      totalEncounters: resolved.totalEncounters,
    },
    zoneName: resolved.zoneName,
    difficultyLabel: resolved.difficultyLabel,
    sizeLabel: resolved.sizeLabel,
  };

  return normalizeGuildRankRenderModel(bundle);
};
