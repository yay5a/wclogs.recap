import type { NormalizedBossPerformance, NormalizedReport, RecapSummary } from '../index.js';
import { toClassSpecLabel } from './helpers.js';

export interface VolumeInput {
  report: NormalizedReport;
  bossPerformances: NormalizedBossPerformance[];
}

export interface VolumeResult {
  section: Pick<
    RecapSummary,
    | 'topDamageTaken'
    | 'topHealers'
    | 'topDamageDone'
    | 'topHealingDone'
    | 'topInterrupts'
    | 'topDispels'
    | 'topSurvivability'
    | 'totals'
  >;
}

export const Volume = {
  build({ report, bossPerformances }: VolumeInput): VolumeResult {
    const topHealers = (report.reportWideRecap?.topHealingDone ?? []).slice(0, 3).map((entry) => {
      const classSpecLabel = toClassSpecLabel(entry.className, entry.specName);
      return {
        playerName: entry.playerName,
        value: entry.value,
        ...(classSpecLabel ? { classSpecLabel } : {}),
      };
    });

    type ReportWideTopRow = {
      playerName: string;
      value: number;
      className?: string;
      specName?: string;
    };
    const mapTopRows = (
      rows: ReportWideTopRow[] | undefined,
    ): Array<{ playerName: string; value: number; classSpecLabel?: string }> =>
      (rows ?? []).slice(0, 3).map((entry) => {
        const classSpecLabel = toClassSpecLabel(entry.className, entry.specName);
        return {
          playerName: entry.playerName,
          value: entry.value,
          ...(classSpecLabel ? { classSpecLabel } : {}),
        };
      });

    const topDamageDone = mapTopRows(report.reportWideRecap?.topDamageDone);
    const topHealingDone = mapTopRows(report.reportWideRecap?.topHealingDone);
    const topDamageTaken = mapTopRows(report.reportWideRecap?.topDamageTaken);
    const topInterrupts = mapTopRows(report.reportWideRecap?.topInterrupts);
    const topDispels = mapTopRows(report.reportWideRecap?.topDispels);
    const topSurvivability = mapTopRows(report.reportWideRecap?.topSurvivability);

    const mostWipesEntry = [...bossPerformances]
      .map((boss) => ({
        bossName: boss.bossName,
        wipes: Math.max(0, (boss.pullCount ?? 0) - (boss.kill ? 1 : 0)),
      }))
      .sort((left, right) => right.wipes - left.wipes)[0];

    return {
      section: {
        topDamageTaken,
        topHealers,
        topDamageDone,
        topHealingDone,
        topInterrupts,
        topDispels,
        topSurvivability,
        totals: {
          ...(typeof report.reportWideRecap?.totals.deaths === 'number'
            ? { totalDeaths: report.reportWideRecap.totals.deaths }
            : {}),
          ...(mostWipesEntry && mostWipesEntry.wipes > 0
            ? {
                mostWipesBoss: mostWipesEntry.bossName,
                mostWipesCount: mostWipesEntry.wipes,
              }
            : {}),
          ...(typeof report.reportWideRecap?.totals.raidDamageTaken === 'number'
            ? { raidDamageTaken: report.reportWideRecap.totals.raidDamageTaken }
            : {}),
          ...(typeof report.reportWideRecap?.totals.dispels === 'number'
            ? { dispels: report.reportWideRecap.totals.dispels }
            : {}),
          ...(typeof report.reportWideRecap?.totals.interrupts === 'number'
            ? { kicks: report.reportWideRecap.totals.interrupts }
            : {}),
        },
      },
    };
  },
};
