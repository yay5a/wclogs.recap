import type { NormalizedLeaderboardEntry, ReportParseRow, ReportSummary } from '@wcl/domain';
import type { ReportCollectorBundle, ReportEncounterSummaryRow } from '../pipeline/types.js';
import { normalizeRankings } from './rankings-normalizer.js';
import {
  selectBestExecutionEncounter,
  selectBiggestTroubleEncounter,
  toReportEncounterSummary,
} from './encounter-summary-normalizer.js';
import { normalizeReportFights } from './report-fight-normalizer.js';
import { normalizeTableMetricRows } from './table-metric-normalizer.js';

export const REPORT_SUMMARY_SOURCE_MAP = {
  reportCode: 'Report.code via report URL / ReportIndex query',
  reportTitle: 'Report.title',
  raidName: 'Report.zone.name',
  dateAndDuration: 'Report.startTime and Report.endTime',
  fights: 'Report.fights(killType: All), excluding only inProgress fights',
  rankings:
    'Report.rankings(fightIDs: kill fight IDs, playerMetric: dps/hps, timeframe: Today, compare: Rankings)',
  encounterParses: 'Report.rankings rows mapped to encounters by kill fight ID',
  playerMetadata: 'Report.masterData(actors: Player) and Report.playerDetails(fightIDs)',
  tables:
    'Report.table(dataType: DamageDone/Healing/Deaths/Interrupts/Dispels, fightIDs: completed fight IDs)',
  rates:
    'Report.table row totals divided by the selected completed boss-fight duration; table activeTimeMs/activeTime is ignored for WCL table parity',
} as const;

type EncounterParseFields = Pick<ReportEncounterSummaryRow, 'highestParseDps' | 'highestParseHps'>;

const toEncounterParseRow = (
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

const isBetterParse = (
  candidate: ReportParseRow,
  existing: ReportParseRow | undefined,
): boolean => {
  if (!existing) return true;
  if (candidate.value !== existing.value) return candidate.value > existing.value;
  return candidate.playerName.localeCompare(existing.playerName) < 0;
};

const buildEncounterParseMap = (
  bundle: ReportCollectorBundle,
): Map<number, EncounterParseFields> => {
  const encounterIdByFightId = new Map<number, number>();
  for (const fight of bundle.index.killBossFights) {
    encounterIdByFightId.set(fight.id, fight.encounterId);
  }

  const byEncounterId = new Map<number, EncounterParseFields>();

  const add = (
    entry: NormalizedLeaderboardEntry,
    metric: ReportParseRow['metric'],
    field: keyof EncounterParseFields,
  ): void => {
    if (typeof entry.fightId !== 'number') return;

    const encounterId = encounterIdByFightId.get(entry.fightId);
    if (typeof encounterId !== 'number') return;

    const parseRow = toEncounterParseRow(entry, metric);
    if (!parseRow) return;

    const existing = byEncounterId.get(encounterId) ?? {};
    const existingParse = existing[field];
    if (!isBetterParse(parseRow, existingParse)) return;

    byEncounterId.set(encounterId, {
      ...existing,
      [field]: parseRow,
    });
  };

  for (const entry of bundle.rankings.dps) {
    add(entry, 'DPS', 'highestParseDps');
  }

  for (const entry of bundle.rankings.hps) {
    add(entry, 'HPS', 'highestParseHps');
  }

  return byEncounterId;
};

const mapRateRows = (
  rows: Array<{
    playerName: string;
    value: number;
    className?: string;
    specName?: string;
  }>,
  selectedDurationMs: number,
) =>
  [...rows]
    .flatMap((row, firstSeen) => {
      if (selectedDurationMs <= 0) return [];
      return [
        {
          playerName: row.playerName,
          value: row.value / (selectedDurationMs / 1000),
          firstSeen,
          ...(row.className ? { className: row.className } : {}),
          ...(row.specName ? { specName: row.specName } : {}),
        },
      ];
    })
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      if (left.firstSeen !== right.firstSeen) return left.firstSeen - right.firstSeen;
      return left.playerName.localeCompare(right.playerName);
    })
    .slice(0, 3)
    .map((row) => ({
      playerName: row.playerName,
      value: row.value,
      ...(row.className ? { className: row.className } : {}),
      ...(row.specName ? { specName: row.specName } : {}),
    }));

export const normalizeReportRenderModel = (bundle: ReportCollectorBundle): ReportSummary => {
  const fightSummary = normalizeReportFights(bundle.index, bundle.tableMetrics, {
    masterData: bundle.masterData,
    playerDetails: bundle.playerDetails,
  });
  const encounterParsesByEncounterId = buildEncounterParseMap(bundle);
  const enrichedEncounters = fightSummary.encounters.map((encounter) => ({
    ...encounter,
    ...encounterParsesByEncounterId.get(encounter.encounterId),
  }));
  const rankingSummary = normalizeRankings(bundle.rankings);

  const encounterRows = enrichedEncounters.map(toReportEncounterSummary);
  const bestExecution = selectBestExecutionEncounter(enrichedEncounters);
  const biggestTrouble = selectBiggestTroubleEncounter(enrichedEncounters);

  const damageRows = normalizeTableMetricRows(
    bundle.tableMetrics.topDamageDone,
    bundle.masterData,
    bundle.playerDetails,
    bundle.tableMetrics.topDamageDone.length,
  );
  const healingRows = normalizeTableMetricRows(
    bundle.tableMetrics.topHealingDone,
    bundle.masterData,
    bundle.playerDetails,
    bundle.tableMetrics.topHealingDone.length,
  );
  const topDamage = damageRows.slice(0, 3);
  const topHealing = healingRows.slice(0, 3);
  const topDeaths = normalizeTableMetricRows(
    bundle.tableMetrics.topDeaths,
    bundle.masterData,
    bundle.playerDetails,
  );
  const topInterrupts = normalizeTableMetricRows(
    bundle.tableMetrics.topInterrupts,
    bundle.masterData,
    bundle.playerDetails,
  );
  const topDispels = normalizeTableMetricRows(
    bundle.tableMetrics.topDispels,
    bundle.masterData,
    bundle.playerDetails,
  );
  const selectedDurationMs = fightSummary.encounters.reduce(
    (sum, encounter) => sum + encounter.totalDurationMs,
    0,
  );

  return {
    reportCode: bundle.index.reportCode,
    reportTitle: bundle.index.title,
    ...(bundle.index.zoneName ? { raidName: bundle.index.zoneName } : {}),
    ...(fightSummary.inferredDifficultyName
      ? { difficultyName: fightSummary.inferredDifficultyName }
      : {}),
    ...(fightSummary.inferredSizeLabel ? { sizeLabel: fightSummary.inferredSizeLabel } : {}),
    reportLink: bundle.index.sourceUrl,
    dateISO: new Date(bundle.index.startTime).toISOString(),
    startTimeISO: new Date(bundle.index.startTime).toISOString(),
    endTimeISO: new Date(bundle.index.endTime).toISOString(),
    durationMs: Math.max(0, bundle.index.endTime - bundle.index.startTime),
    bossPulls: fightSummary.totalPulls,
    totalKills: fightSummary.totalKills,
    totalWipes: fightSummary.totalWipes,
    ...(typeof bundle.tableMetrics.totals.deaths === 'number'
      ? { totalDeaths: bundle.tableMetrics.totals.deaths }
      : {}),
    encounters: encounterRows,
    ...(bestExecution ? { bestExecutionEncounter: toReportEncounterSummary(bestExecution) } : {}),
    ...(biggestTrouble
      ? { biggestTroubleEncounter: toReportEncounterSummary(biggestTrouble) }
      : {}),
    highestParses: rankingSummary.highestParses,
    topPlayers: {
      highestAverageParse: rankingSummary.highestAverageParse,
      highestTotalDamage: topDamage,
      highestTotalHealing: topHealing,
      highestTotalDps: mapRateRows(damageRows, selectedDurationMs),
      highestHps: mapRateRows(healingRows, selectedDurationMs),
      mostDeaths: topDeaths,
      mostInterrupts: topInterrupts,
      mostDispels: topDispels,
    },
    partialDataNotes: [],
  };
};
