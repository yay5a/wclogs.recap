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

  const [candidateReports, officialRanks] = await Promise.all([
    selectGuildRankCandidateReports({
      gameFamily: normalizedInput.gameFamily ?? 'retail',
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
        normalizedInput.gameFamily ?? 'retail',
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
        normalizedInput.gameFamily ?? 'retail',
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
