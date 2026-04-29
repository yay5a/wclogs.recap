import type { NormalizedReport, RecapSummary } from '../index.js';
import {
  dedupeRowsByPlayerStrongest,
  toNormalizedPlayerKey,
  toClassSpecLabel,
} from './helpers.js';

export interface PerformanceInput {
  report: NormalizedReport;
}

export interface PerformanceResult {
  section: Pick<
    RecapSummary,
    | 'highestParses'
    | 'topDamageAverageParses'
    | 'topHealingAverageParses'
  >;
}

export const Performance = {
  build({ report }: PerformanceInput): PerformanceResult {
    const toRankPercentRows = (
      rows: ReadonlyArray<{
        playerName?: string;
        rankPercent?: number;
        className?: string;
        specName?: string;
        bossName?: string;
        fightId?: number;
        role?: string;
      }>,
    ) =>
      rows.flatMap((entry) => {
        if (!entry.playerName) return [];
        if (typeof entry.rankPercent !== 'number') return [];
        if (!Number.isFinite(entry.rankPercent)) return [];
        const classSpecLabel = toClassSpecLabel(entry.className, entry.specName);
        return [
          {
            playerName: entry.playerName,
            value: entry.rankPercent,
            ...(entry.className ? { className: entry.className } : {}),
            ...(entry.specName ? { specName: entry.specName } : {}),
            ...(classSpecLabel ? { classSpecLabel } : {}),
            ...(entry.bossName ? { bossName: entry.bossName } : {}),
            ...(typeof entry.fightId === 'number' ? { fightId: entry.fightId } : {}),
          },
        ];
      });
    const reportWideDpsRankings = (report.reportWideRankings?.dps ?? []).filter(
      (entry) => entry.role?.trim().toLowerCase() === 'dps',
    );
    const reportWideHpsRankings = (report.reportWideRankings?.hps ?? []).filter(
      (entry) => entry.role?.trim().toLowerCase() === 'healer',
    );
    const dpsRankPercentRows = toRankPercentRows(reportWideDpsRankings);
    const hpsRankPercentRows = toRankPercentRows(reportWideHpsRankings);
    const highestParses = dedupeRowsByPlayerStrongest(
      [
        ...dpsRankPercentRows.map((entry) => ({ ...entry, metric: 'DPS' as const })),
        ...hpsRankPercentRows.map((entry) => ({ ...entry, metric: 'HPS' as const })),
      ].sort((left, right) => right.value - left.value),
    )
      .sort((left, right) => right.value - left.value)
      .slice(0, 3)
      .map((entry) => ({
        playerName: entry.playerName,
        metric: entry.metric,
        value: entry.value,
        ...(entry.bossName ? { bossName: entry.bossName } : {}),
        ...(typeof entry.fightId === 'number' ? { fightId: entry.fightId } : {}),
        ...(entry.className ? { className: entry.className } : {}),
        ...(entry.specName ? { specName: entry.specName } : {}),
        ...(entry.classSpecLabel ? { classSpecLabel: entry.classSpecLabel } : {}),
      }));
    const buildTopAverageParses = (
      rows: ReadonlyArray<{
        playerName: string;
        value: number;
        className?: string;
        specName?: string;
        classSpecLabel?: string;
      }>,
    ) => {
      const byPlayer = new Map<
        string,
        {
          playerName: string;
          sum: number;
          count: number;
          className?: string;
          specName?: string;
          classSpecLabel?: string;
        }
      >();
      for (const row of rows) {
        const key = toNormalizedPlayerKey(row.playerName);
        const current = byPlayer.get(key);
        if (!current) {
          byPlayer.set(key, {
            playerName: row.playerName,
            sum: row.value,
            count: 1,
            ...(row.className ? { className: row.className } : {}),
            ...(row.specName ? { specName: row.specName } : {}),
            ...(row.classSpecLabel ? { classSpecLabel: row.classSpecLabel } : {}),
          });
          continue;
        }
        current.sum += row.value;
        current.count += 1;
        if (!current.className && row.className) current.className = row.className;
        if (!current.specName && row.specName) current.specName = row.specName;
        if (!current.classSpecLabel && row.classSpecLabel) {
          current.classSpecLabel = row.classSpecLabel;
        }
      }
      return [...byPlayer.values()]
        .map((entry) => ({
          playerName: entry.playerName,
          value: Math.round(entry.sum / entry.count),
          ...(entry.className ? { className: entry.className } : {}),
          ...(entry.specName ? { specName: entry.specName } : {}),
          ...(entry.classSpecLabel ? { classSpecLabel: entry.classSpecLabel } : {}),
        }))
        .sort((left, right) => right.value - left.value)
        .slice(0, 3);
    };
    const topDamageAverageParses = buildTopAverageParses(dpsRankPercentRows);
    const topHealingAverageParses = buildTopAverageParses(hpsRankPercentRows);

    return {
      section: {
        highestParses,
        topDamageAverageParses,
        topHealingAverageParses,
      },
    };
  },
};
