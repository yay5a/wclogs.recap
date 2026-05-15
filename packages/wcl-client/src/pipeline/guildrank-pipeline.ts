import type { GameFamily, GuildRankSummary } from '@wcl/domain';
import { createLogger, serializeError } from '@wcl/shared';
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
const logger = createLogger('wcl-client');

const normalizeServerSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

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

const toDerivedScore = (
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
  matchesZone: boolean;
  hasDifficultySizeFights: boolean;
}

const normalizeNameKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const reportMatchesZone = (
  report: { zoneId?: number; zoneName?: string },
  target: { zoneId: number; zoneName: string },
): boolean => {
  if (typeof report.zoneId === 'number') {
    return report.zoneId === target.zoneId;
  }
  if (report.zoneName) {
    return normalizeNameKey(report.zoneName) === normalizeNameKey(target.zoneName);
  }
  return false;
};

const collectEncounterMetricsFromReport = async (
  client: WclGraphqlClient,
  reportCode: string,
  zone: { zoneId: number; zoneName: string },
  difficultyId: number,
  sizeValue: number,
  gameFamily: GameFamily,
): Promise<EncounterMetricsByReport> => {
  const index = await collectReportIndex(client, {
    reportCode,
    sourceUrl: `https://www.warcraftlogs.com/reports/${reportCode}`,
    gameFamily,
  });

  const matchesZone = reportMatchesZone(
    {
      ...(typeof index.zoneId === 'number' ? { zoneId: index.zoneId } : {}),
      ...(index.zoneName ? { zoneName: index.zoneName } : {}),
    },
    zone,
  );
  if (!matchesZone) {
    return {
      speedByEncounter: new Map<string, number>(),
      executionByEncounter: new Map<string, number>(),
      pulls: 0,
      wipes: 0,
      clearedEncounters: new Set<string>(),
      matchesZone: false,
      hasDifficultySizeFights: false,
    };
  }

  const filteredFights = index.completedBossFights.filter(
    (fight) => fight.difficulty === difficultyId && fight.size === sizeValue,
  );

  const tableMetrics = await collectTableMetrics(client, {
    reportCode,
    completedFightIds: filteredFights.map((fight) => fight.id),
  });

  const byEncounter = new Map<string, typeof filteredFights>();
  for (const fight of filteredFights) {
    const fights = byEncounter.get(fight.name);
    if (fights) {
      fights.push(fight);
    } else {
      byEncounter.set(fight.name, [fight]);
    }
  }

  const speedByEncounter = new Map<string, number>();
  const executionByEncounter = new Map<string, number>();
  const clearedEncounters = new Set<string>();
  let wipes = 0;

  for (const [encounterName, fights] of byEncounter.entries()) {
    let hasKill = false;
    let fastestDuration: number | undefined;
    let lowestDeaths: number | undefined;
    for (const fight of fights) {
      if (!fight.kill) {
        wipes += 1;
        continue;
      }
      hasKill = true;
      const durationMs = Math.max(0, fight.endTime - fight.startTime);
      if (typeof fastestDuration !== 'number' || durationMs < fastestDuration) {
        fastestDuration = durationMs;
      }
      const deaths = tableMetrics.deathsByFightId[fight.id] ?? 0;
      if (typeof lowestDeaths !== 'number' || deaths < lowestDeaths) {
        lowestDeaths = deaths;
      }
    }

    if (!hasKill) continue;

    clearedEncounters.add(encounterName);

    if (typeof fastestDuration === 'number') {
      speedByEncounter.set(encounterName, fastestDuration);
    }

    if (typeof lowestDeaths === 'number') {
      executionByEncounter.set(encounterName, lowestDeaths);
    }
  }

  return {
    speedByEncounter,
    executionByEncounter,
    pulls: filteredFights.length,
    wipes,
    clearedEncounters,
    matchesZone: true,
    hasDifficultySizeFights: filteredFights.length > 0,
  };
};

const logDiscoveryFilterStage = (
  context: Record<string, unknown>,
  counts: {
    currentRawReports: number;
    currentZoneMatchedReports: number;
    currentDifficultySizeMatchedReports: number;
    baselineRawReports: number;
  },
): void => {
  logger.info(
    {
      ...context,
      rawDiscoveredReportCount: counts.currentRawReports,
      timeWindowMatchedReportCount: counts.currentRawReports,
      guildServerRegionMatchedReportCount: counts.currentRawReports,
      zoneMatchedReportCount: counts.currentZoneMatchedReports,
      difficultySizeFightMatchedReportCount: counts.currentDifficultySizeMatchedReports,
      baselineRawDiscoveredReportCount: counts.baselineRawReports,
    },
    'guildrank report discovery filter counts',
  );
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
      const scores = currentValues.map((value) =>
        toDerivedScore(value, allValuesRaw, lowerIsBetter),
      );
      const bestScore = scores.length > 0 ? Math.max(...scores) : undefined;
      const medianScore = median(scores);

      perEncounter.push({
        encounterName,
        ...(typeof bestScore === 'number' ? { bestScore } : {}),
        ...(typeof medianScore === 'number' ? { medianScore } : {}),
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

export const collectGuildRankSummaryData = async (
  client: WclGraphqlClient,
  input: GuildRankInput,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<GuildRankSummary> => {
  const normalizedInput: GuildRankInput = {
    ...input,
    guildName: input.guildName.trim(),
    guildServerSlug: normalizeServerSlug(input.guildServerSlug),
    guildServerRegion: input.guildServerRegion.trim().toLowerCase(),
  };
  const resolved = await resolveGuildConfigZoneInput(client, normalizedInput);
  const windows = buildWindows();
  const debugContext = {
    guildName: normalizedInput.guildName,
    configuredServerName: input.guildServerSlug,
    configuredServerSlug: normalizedInput.guildServerSlug,
    configuredRegion: normalizedInput.guildServerRegion,
    configuredZoneId: normalizedInput.zoneId,
    resolvedZoneName: resolved.zoneName,
    selectedDifficulty: resolved.difficultyLabel,
    selectedDifficultyId: resolved.difficultyId,
    selectedSize: resolved.sizeLabel,
    selectedSizeValue: resolved.sizeValue,
    selectedPartitionId: resolved.partitionId,
    currentWindowStartMs: windows.currentStartMs,
    currentWindowEndMs: windows.currentEndMs,
    baselineWindowStartMs: windows.baselineStartMs,
    baselineWindowEndMs: windows.baselineEndMs,
  };

  logger.info(debugContext, 'guildrank report discovery input');

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
      ...(typeof resolved.partitionId === 'number' ? { partition: resolved.partitionId } : {}),
      encounters: resolved.encounters,
    }),
  ]);

  const currentMetricsByEncounter = new Map<string, number[]>();
  const baselineMetricsByEncounter = new Map<string, number[]>();
  const currentExecutionByEncounter = new Map<string, number[]>();
  const baselineExecutionByEncounter = new Map<string, number[]>();

  let progressPulls = 0;
  let progressWipes = 0;
  const currentClears = new Set<string>();
  let currentZoneMatchedReports = 0;
  let currentDifficultySizeMatchedReports = 0;

  for (const row of currentDiscovery.rows) {
    let reportMetrics: EncounterMetricsByReport;
    try {
      reportMetrics = await collectEncounterMetricsFromReport(
        client,
        row.code,
        { zoneId: resolved.zoneId, zoneName: resolved.zoneName },
        resolved.difficultyId,
        resolved.sizeValue,
        normalizedInput.gameFamily ?? 'retail',
      );
    } catch (error) {
      logger.info(
        { ...debugContext, reportCode: row.code, error: serializeError(error) },
        'guildrank report indexing failed during current-window filtering',
      );
      continue;
    }
    if (!reportMetrics.matchesZone) continue;
    currentZoneMatchedReports += 1;
    if (!reportMetrics.hasDifficultySizeFights) continue;
    currentDifficultySizeMatchedReports += 1;

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
    let reportMetrics: EncounterMetricsByReport;
    try {
      reportMetrics = await collectEncounterMetricsFromReport(
        client,
        row.code,
        { zoneId: resolved.zoneId, zoneName: resolved.zoneName },
        resolved.difficultyId,
        resolved.sizeValue,
        normalizedInput.gameFamily ?? 'retail',
      );
    } catch (error) {
      logger.info(
        { ...debugContext, reportCode: row.code, error: serializeError(error) },
        'guildrank report indexing failed during baseline filtering',
      );
      continue;
    }
    if (!reportMetrics.matchesZone || !reportMetrics.hasDifficultySizeFights) continue;

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

  logDiscoveryFilterStage(debugContext, {
    currentRawReports: currentDiscovery.rows.length,
    currentZoneMatchedReports,
    currentDifficultySizeMatchedReports,
    baselineRawReports: baselineDiscovery.rows.length,
  });

  const bundle: GuildRankCollectorBundle = {
    input: normalizedInput,
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
    currentWindowDiscovery: {
      candidateReports: currentDiscovery.rows.length,
      zoneMatchedReports: currentZoneMatchedReports,
      difficultySizeMatchedReports: currentDifficultySizeMatchedReports,
    },
    zoneName: resolved.zoneName,
    difficultyLabel: resolved.difficultyLabel,
    sizeLabel: resolved.sizeLabel,
  };

  return normalizeGuildRankRenderModel(bundle);
};
