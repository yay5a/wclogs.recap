import type { ReportSummary } from '@wcl/domain';
import type { ReportCollectorBundle } from '../pipeline/types.js';
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
  playerMetadata: 'Report.masterData(actors: Player) and Report.playerDetails(fightIDs)',
  tables:
    'Report.table(dataType: DamageDone/Healing/Deaths/Interrupts/Dispels, fightIDs: completed fight IDs)',
  rates:
    'Report.table row totals divided by the selected completed boss-fight duration; table activeTimeMs/activeTime is ignored for WCL table parity',
} as const;

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
  const rankingSummary = normalizeRankings(bundle.rankings);

  const encounterRows = fightSummary.encounters.map(toReportEncounterSummary);
  const bestExecution = selectBestExecutionEncounter(fightSummary.encounters);
  const biggestTrouble = selectBiggestTroubleEncounter(fightSummary.encounters);

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
