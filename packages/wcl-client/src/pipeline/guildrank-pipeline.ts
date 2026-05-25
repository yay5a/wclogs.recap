import type { GameFamily, GuildRankSummary } from '@wcl/domain';
import { createLogger, serializeError } from '@wcl/shared';
import type { WclGraphqlClient } from '../graphql-client.js';
import { resolveGuildConfigZoneInput } from '../collectors/guild-config-zone-input-resolver.js';
import { collectOfficialGuildZoneRankings } from '../collectors/official-guild-zone-rankings-collector.js';
import { normalizeGuildRankRenderModel } from '../normalizers/guildrank-render-model-normalizer.js';
import {
  selectGuildRankCandidateReports,
  type GuildRankLiveReportIndexFetcher,
  type GuildRankReportMetadataReader,
} from './guildrank-candidate-selector.js';
import { buildMetricSet, buildTrendMetricSets, buildWindows } from './guildrank-metrics.js';
import {
  collectEncounterMetricsFromReport,
  isInBaselineWindow,
  isInCurrentWindow,
  toDiscoveryRows,
  type EncounterMetricsByReport,
} from './guildrank-report-scan.js';
import type {
  GuildRankCollectorBundle,
  GuildRankInput,
  GuildRankTrendReader,
  GuildRankWeeklyTrendRow,
} from './types.js';

const logger = createLogger('wcl-client');

const normalizeServerSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

export interface GuildRankPipelineOptions {
  metadataReader?: GuildRankReportMetadataReader;
  trendReader?: GuildRankTrendReader;
  liveReportIndexFetcher: GuildRankLiveReportIndexFetcher;
  maxReports?: number;
}

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
    selectedTrendPartition: normalizedInput.partition ?? 'current',
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
      windows: trendMetricSets.windows,
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
    metricSource: 'indexed_report_scan',
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
