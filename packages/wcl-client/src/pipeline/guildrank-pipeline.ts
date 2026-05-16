import type { GameFamily, GuildRankSummary } from '@wcl/domain';
import { createLogger, serializeError } from '@wcl/shared';
import type { WclGraphqlClient } from '../graphql-client.js';
import { resolveGuildConfigZoneInput } from '../collectors/guild-config-zone-input-resolver.js';
import { collectOfficialGuildZoneRankings } from '../collectors/official-guild-zone-rankings-collector.js';
import { collectReportIndex } from '../collectors/report-index-collector.js';
import { collectTableMetrics } from '../collectors/table-collector.js';
import { normalizeGuildRankRenderModel } from '../normalizers/guildrank-render-model-normalizer.js';
import {
  selectGuildRankCandidateReports,
  type GuildRankLiveReportIndexFetcher,
  type GuildRankReportCandidate,
  type GuildRankReportMetadataReader,
} from './guildrank-candidate-selector.js';
import type {
  GuildRankCollectorBundle,
  GuildRankEncounterMetric,
  GuildRankInput,
  GuildRankMetricSet,
  GuildRankTrendReader,
  GuildRankWeeklyTrendRow,
  GuildRankWindows,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
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

export interface GuildRankPipelineOptions {
  metadataReader?: GuildRankReportMetadataReader;
  trendReader?: GuildRankTrendReader;
  liveReportIndexFetcher: GuildRankLiveReportIndexFetcher;
  maxReports?: number;
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
    currentCandidateReports: number;
    currentZoneMatchedReports: number;
    currentDifficultySizeMatchedReports: number;
    baselineCandidateReports: number;
    mongoIndexCandidateReports: number;
    liveWclCandidateReports: number;
  },
): void => {
  logger.info(
    {
      ...context,
      candidateReportCount: counts.currentCandidateReports,
      timeWindowMatchedReportCount: counts.currentCandidateReports,
      guildServerRegionMatchedReportCount: counts.currentCandidateReports,
      zoneMatchedReportCount: counts.currentZoneMatchedReports,
      difficultySizeFightMatchedReportCount: counts.currentDifficultySizeMatchedReports,
      baselineCandidateReportCount: counts.baselineCandidateReports,
      mongoIndexCandidateReportCount: counts.mongoIndexCandidateReports,
      liveWclCandidateReportCount: counts.liveWclCandidateReports,
    },
    'guildrank candidate report filter counts',
  );
};

const isInCurrentWindow = (
  candidate: GuildRankReportCandidate,
  windows: GuildRankWindows,
): boolean =>
  candidate.startTime >= windows.currentStartMs && candidate.startTime <= windows.currentEndMs;

const isInBaselineWindow = (
  candidate: GuildRankReportCandidate,
  windows: GuildRankWindows,
): boolean =>
  candidate.startTime >= windows.baselineStartMs &&
  candidate.startTime <= windows.baselineEndMs &&
  candidate.startTime < windows.currentStartMs;

const toDiscoveryRows = (candidates: GuildRankReportCandidate[]) =>
  candidates.map((candidate) => ({
    code: candidate.reportCode,
    startTime: candidate.startTime,
    ...(typeof candidate.endTime === 'number' ? { endTime: candidate.endTime } : {}),
    ...(typeof candidate.zoneId === 'number' ? { zoneId: candidate.zoneId } : {}),
    ...(candidate.zoneName ? { zoneName: candidate.zoneName } : {}),
  }));

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

const selectPreferredTrendRows = (
  rows: GuildRankWeeklyTrendRow[],
): Map<string, GuildRankWeeklyTrendRow> => {
  const byWeekEncounter = new Map<string, GuildRankWeeklyTrendRow>();

  for (const row of rows) {
    const key = `${row.weekStart.getTime()}:${row.encounterId}`;
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
      ...(typeof row.speedMedian === 'number'
        ? { medianDerivedPercentile: row.speedMedian }
        : {}),
    };
  }

  return {
    encounterName: '',
    ...(typeof row.executionP90 === 'number'
      ? { bestDerivedPercentile: row.executionP90 }
      : {}),
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
  typeof row.bestDerivedPercentile === 'number' ||
  typeof row.medianDerivedPercentile === 'number';

const buildTrendMetricSets = (
  rows: GuildRankWeeklyTrendRow[],
  resolved: {
    difficultyId: number;
    sizeValue: number;
    encounters: Array<{ id: number; name: string }>;
  },
):
  | {
      currentSpeed: GuildRankMetricSet;
      baselineSpeed: GuildRankMetricSet;
      currentExecution: GuildRankMetricSet;
      baselineExecution: GuildRankMetricSet;
      sampleCount: number;
      clearedEncounters: number;
      weekStart: Date;
    }
  | undefined => {
  const encounterNameById = new Map(
    resolved.encounters.map((encounter) => [encounter.id, encounter.name]),
  );
  const requestedEncounterIds = new Set(encounterNameById.keys());
  const trendRows = rows.filter(
    (row) =>
      row.difficulty === resolved.difficultyId &&
      row.size === resolved.sizeValue &&
      row.compareMode === 'rankings' &&
      (requestedEncounterIds.size === 0 || requestedEncounterIds.has(row.encounterId)) &&
      hasTrendMetric(row),
  );
  if (trendRows.length === 0) return undefined;

  const latestWeekStartMs = Math.max(...trendRows.map((row) => row.weekStart.getTime()));
  const previousWeekStartMs = latestWeekStartMs - WEEK_MS;
  const preferredRows = selectPreferredTrendRows(trendRows);
  const currentRows = [...preferredRows.values()]
    .filter((row) => row.weekStart.getTime() === latestWeekStartMs)
    .sort((left, right) => left.encounterId - right.encounterId);
  if (currentRows.length === 0) return undefined;
  const baselineRowsByEncounter = new Map(
    [...preferredRows.values()]
      .filter((row) => row.weekStart.getTime() === previousWeekStartMs)
      .map((row) => [row.encounterId, row]),
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
      const baselineRow = baselineRowsByEncounter.get(currentRow.encounterId);
      const metricRow = baselineRow
        ? toTrendMetricRow(baselineRow, metric)
        : toFallbackBaselineTrendMetricRow(currentRow, metric);
      if (!metricRow || !hasMetricValues(metricRow)) return [];
      return [
        {
          ...metricRow,
          encounterName:
            encounterNameById.get(currentRow.encounterId) ??
            `Encounter ${currentRow.encounterId}`,
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
    weekStart: new Date(latestWeekStartMs),
  };
};

const readWeeklyTrendRows = async (
  trendReader: GuildRankTrendReader | undefined,
  scope: {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    gameFamily: GameFamily;
  },
  context: Record<string, unknown>,
): Promise<GuildRankWeeklyTrendRow[]> => {
  if (!trendReader) return [];
  try {
    return await trendReader.listWeeklyTrends({ scope });
  } catch (error) {
    logger.info(
      { ...context, error: serializeError(error) },
      'guildrank weekly trend cache read failed',
    );
    return [];
  }
};

export const collectGuildRankSummaryData = async (
  client: WclGraphqlClient,
  input: GuildRankInput,
  options: GuildRankPipelineOptions,
): Promise<GuildRankSummary> => {
  const normalizedInput: GuildRankInput = {
    ...input,
    guildName: input.guildName.trim(),
    guildServerSlug: normalizeServerSlug(input.guildServerSlug),
    guildServerRegion: input.guildServerRegion.trim().toLowerCase(),
  };
  const gameFamily = normalizedInput.gameFamily ?? 'retail';
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

  logger.info(debugContext, 'guildrank candidate report input');

  const [weeklyTrendRows, officialRanks] = await Promise.all([
    readWeeklyTrendRows(
      options.trendReader,
      {
        guildName: resolved.guildName,
        guildServerSlug: resolved.guildServerSlug,
        guildServerRegion: resolved.guildServerRegion,
        gameFamily,
      },
      debugContext,
    ),
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
  const trendMetricSets = buildTrendMetricSets(weeklyTrendRows, resolved);

  if (trendMetricSets) {
    const trendSampleCount = Math.max(1, trendMetricSets.sampleCount);
    logger.info(
      {
        ...debugContext,
        trendRowCount: weeklyTrendRows.length,
        trendSampleCount: trendMetricSets.sampleCount,
        trendWeekStartIso: trendMetricSets.weekStart.toISOString(),
      },
      'guildrank weekly trend cache hit',
    );

    const bundle: GuildRankCollectorBundle = {
      input: normalizedInput,
      windows,
      metricSource: 'trend_cache',
      officialRanks,
      currentReports: [],
      baselineReports: [],
      currentSpeed: trendMetricSets.currentSpeed,
      baselineSpeed: trendMetricSets.baselineSpeed,
      currentExecution: trendMetricSets.currentExecution,
      baselineExecution: trendMetricSets.baselineExecution,
      progressPulls: {
        pulls: trendMetricSets.sampleCount,
        wipes: 0,
        clearedEncounters: trendMetricSets.clearedEncounters,
        totalEncounters: Math.max(resolved.totalEncounters, trendMetricSets.clearedEncounters),
      },
      currentWindowDiscovery: {
        candidateReports: trendSampleCount,
        zoneMatchedReports: trendSampleCount,
        difficultySizeMatchedReports: trendSampleCount,
      },
      zoneName: resolved.zoneName,
      difficultyLabel: resolved.difficultyLabel,
      sizeLabel: resolved.sizeLabel,
    };

    return normalizeGuildRankRenderModel(bundle);
  }

  const candidateReports = await selectGuildRankCandidateReports({
    gameFamily,
    guildName: resolved.guildName,
    guildServerSlug: resolved.guildServerSlug,
    guildServerRegion: resolved.guildServerRegion,
    zoneId: resolved.zoneId,
    currentWindowStartMs: windows.currentStartMs,
    currentWindowEndMs: windows.currentEndMs,
    previousWindowStartMs: windows.baselineStartMs,
    previousWindowEndMs: windows.baselineEndMs,
    ...(typeof options.maxReports === 'number' ? { maxReports: options.maxReports } : {}),
    ...(options.metadataReader ? { metadataReader: options.metadataReader } : {}),
    liveReportIndexFetcher: options.liveReportIndexFetcher,
  });
  const currentCandidates = candidateReports.filter((candidate) =>
    isInCurrentWindow(candidate, windows),
  );
  const baselineCandidates = candidateReports.filter((candidate) =>
    isInBaselineWindow(candidate, windows),
  );

  const currentMetricsByEncounter = new Map<string, number[]>();
  const baselineMetricsByEncounter = new Map<string, number[]>();
  const currentExecutionByEncounter = new Map<string, number[]>();
  const baselineExecutionByEncounter = new Map<string, number[]>();

  let progressPulls = 0;
  let progressWipes = 0;
  const currentClears = new Set<string>();
  let currentZoneMatchedReports = 0;
  let currentDifficultySizeMatchedReports = 0;

  for (const row of currentCandidates) {
    let reportMetrics: EncounterMetricsByReport;
    try {
      reportMetrics = await collectEncounterMetricsFromReport(
        client,
        row.reportCode,
        { zoneId: resolved.zoneId, zoneName: resolved.zoneName },
        resolved.difficultyId,
        resolved.sizeValue,
        gameFamily,
      );
    } catch (error) {
      logger.info(
        { ...debugContext, reportCode: row.reportCode, error: serializeError(error) },
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

  for (const row of baselineCandidates) {
    let reportMetrics: EncounterMetricsByReport;
    try {
      reportMetrics = await collectEncounterMetricsFromReport(
        client,
        row.reportCode,
        { zoneId: resolved.zoneId, zoneName: resolved.zoneName },
        resolved.difficultyId,
        resolved.sizeValue,
        gameFamily,
      );
    } catch (error) {
      logger.info(
        { ...debugContext, reportCode: row.reportCode, error: serializeError(error) },
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
  const executionSets = buildMetricSet(
    currentExecutionByEncounter,
    baselineExecutionByEncounter,
    true,
  );

  logDiscoveryFilterStage(debugContext, {
    currentCandidateReports: currentCandidates.length,
    currentZoneMatchedReports,
    currentDifficultySizeMatchedReports,
    baselineCandidateReports: baselineCandidates.length,
    mongoIndexCandidateReports: candidateReports.filter(
      (candidate) => candidate.source === 'mongo-index',
    ).length,
    liveWclCandidateReports: candidateReports.filter((candidate) => candidate.source === 'live-wcl')
      .length,
  });

  const bundle: GuildRankCollectorBundle = {
    input: normalizedInput,
    windows,
    metricSource: 'derived_report_scan',
    officialRanks,
    currentReports: toDiscoveryRows(currentCandidates),
    baselineReports: toDiscoveryRows(baselineCandidates),
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
      candidateReports: currentCandidates.length,
      zoneMatchedReports: currentZoneMatchedReports,
      difficultySizeMatchedReports: currentDifficultySizeMatchedReports,
    },
    zoneName: resolved.zoneName,
    difficultyLabel: resolved.difficultyLabel,
    sizeLabel: resolved.sizeLabel,
  };

  return normalizeGuildRankRenderModel(bundle);
};
