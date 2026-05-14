import type { ReportEncounterSummary } from '@wcl/domain';
import type { ReportEncounterSummaryRow } from '../pipeline/types.js';

const compareString = (left: string, right: string): number => left.localeCompare(right);

export const toReportEncounterSummary = (
  row: ReportEncounterSummaryRow,
): ReportEncounterSummary => ({
  bossName: row.bossName,
  encounterId: row.encounterId,
  ...(row.difficultyName ? { difficultyName: row.difficultyName } : {}),
  pulls: row.pulls,
  kills: row.kills,
  wipes: row.wipes,
  totalDurationMs: row.totalDurationMs,
  ...(typeof row.shortestKillDurationMs === 'number' ? { shortestPullMs: row.shortestKillDurationMs } : {}),
  deaths: row.deaths,
  dtpsParseAvailable: false,
});

export const selectBestExecutionEncounter = (
  rows: ReportEncounterSummaryRow[],
): ReportEncounterSummaryRow | undefined =>
  [...rows]
    .filter((row) => row.kills > 0)
    .sort((left, right) => {
      if (left.deaths !== right.deaths) return left.deaths - right.deaths;
      if ((left.shortestKillDurationMs ?? Number.POSITIVE_INFINITY) !== (right.shortestKillDurationMs ?? Number.POSITIVE_INFINITY)) {
        return (left.shortestKillDurationMs ?? Number.POSITIVE_INFINITY) -
          (right.shortestKillDurationMs ?? Number.POSITIVE_INFINITY);
      }
      return compareString(left.bossName, right.bossName);
    })[0];

export const selectBiggestTroubleEncounter = (
  rows: ReportEncounterSummaryRow[],
): ReportEncounterSummaryRow | undefined =>
  [...rows].sort((left, right) => {
    if (right.wipes !== left.wipes) return right.wipes - left.wipes;
    if (right.deaths !== left.deaths) return right.deaths - left.deaths;
    return compareString(left.bossName, right.bossName);
  })[0];
