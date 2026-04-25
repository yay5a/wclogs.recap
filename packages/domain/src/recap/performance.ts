import type { NormalizedReport, RecapSummary } from '../index.js';
import {
  dedupeRowsByPlayerStrongest,
  resolveMetricLabelFromEntry,
  type MetricLabel,
  toClassSpecLabel,
} from './helpers.js';

export interface PerformanceInput {
  report: NormalizedReport;
}

export interface PerformanceResult {
  section: Pick<
    RecapSummary,
    | 'bestPlayerParses'
    | 'bestSingleBossParse'
    | 'bestAverageParse'
    | 'topOverallParsers'
    | 'topOverallDamageParsers'
    | 'topOverallHealingParsers'
  >;
}

export const Performance = {
  build({ report }: PerformanceInput): PerformanceResult {
    const mapRowsByName = (
      rows?: Array<{
        playerName: string;
        value: number;
        className?: string;
        specName?: string;
      }>,
    ) => new Map((rows ?? []).map((entry) => [entry.playerName.toLowerCase(), entry]));
    const reportDamageByName = mapRowsByName(report.reportWideRecap?.topDamageDone);
    const reportHealingByName = mapRowsByName(report.reportWideRecap?.topHealingDone);
    const reportDamageTakenByName = mapRowsByName(report.reportWideRecap?.topDamageTaken);
    const amountRowsByMetric: Record<
      MetricLabel,
      ReturnType<typeof mapRowsByName>
    > = {
      DPS: reportDamageByName,
      HPS: reportHealingByName,
      DTPS: reportDamageTakenByName,
    };
    const reportLeaderboards = (report.leaderboards ?? []).filter(
      (entry) => entry.scope === 'report',
    );

    const bestPlayerParses = dedupeRowsByPlayerStrongest(
      [...reportLeaderboards]
        .sort((left, right) => right.value - left.value)
        .flatMap((entry) => {
          if (!entry.playerName) return [];
          const metricLabel = resolveMetricLabelFromEntry(entry);
          const amountRow = amountRowsByMetric[metricLabel]?.get(entry.playerName.toLowerCase());
          const className = entry.className ?? amountRow?.className;
          const specName = entry.specName ?? amountRow?.specName;
          const classSpecLabel = toClassSpecLabel(className, specName);
          return [
            {
              playerName: entry.playerName,
              value: entry.value,
              metricLabel,
              metric: metricLabel,
              ...(typeof amountRow?.value === 'number' ? { amount: amountRow.value } : {}),
              ...(className ? { className } : {}),
              ...(specName ? { specName } : {}),
              ...(classSpecLabel ? { classSpecLabel } : {}),
            },
          ];
        }),
    )
      .slice(0, 3)
      .map((entry) => ({
        playerName: entry.playerName,
        parse: entry.value,
        metricLabel: entry.metricLabel,
        ...(entry.metric ? { metric: entry.metric } : {}),
        ...(typeof entry.amount === 'number' ? { amount: entry.amount } : {}),
        ...(entry.className ? { className: entry.className } : {}),
        ...(entry.specName ? { specName: entry.specName } : {}),
        ...(entry.classSpecLabel ? { classSpecLabel: entry.classSpecLabel } : {}),
      }));

    const bestAverageParseEntry = [...reportLeaderboards].sort(
      (left, right) => right.value - left.value,
    )[0];
    const bestSingleBossParseEntry = (report.leaderboards ?? [])
      .filter((entry) => entry.scope === 'boss')
      .sort((left, right) => right.value - left.value)[0];

    const topOverallParsers = dedupeRowsByPlayerStrongest(
      [...reportLeaderboards]
        .sort((left, right) => right.value - left.value)
        .flatMap((entry) => {
          if (!entry.playerName) return [];
          const metric = resolveMetricLabelFromEntry(entry);
          return [{ playerName: entry.playerName, value: entry.value, metric }];
        }),
    )
      .slice(0, 3)
      .map((entry) => ({
        playerName: entry.playerName,
        value: entry.value,
        metric: entry.metric,
      }));

    const topOverallDamageParsers = dedupeRowsByPlayerStrongest(
      [...reportLeaderboards]
        .filter((entry) => resolveMetricLabelFromEntry(entry) === 'DPS')
        .sort((left, right) => right.value - left.value)
        .flatMap((entry) => {
          if (!entry.playerName) return [];
          return [{ playerName: entry.playerName, value: entry.value }];
        }),
    )
      .slice(0, 3)
      .map((entry) => ({
        playerName: entry.playerName,
        value: entry.value,
        metric: 'DPS' as const,
      }));

    const topOverallHealingParsers = dedupeRowsByPlayerStrongest(
      [...reportLeaderboards]
        .filter((entry) => resolveMetricLabelFromEntry(entry) === 'HPS')
        .sort((left, right) => right.value - left.value)
        .flatMap((entry) => {
          if (!entry.playerName) return [];
          return [{ playerName: entry.playerName, value: entry.value }];
        }),
    )
      .slice(0, 3)
      .map((entry) => ({
        playerName: entry.playerName,
        value: entry.value,
        metric: 'HPS' as const,
      }));

    return {
      section: {
        bestPlayerParses,
        ...(bestSingleBossParseEntry?.playerName &&
        bestSingleBossParseEntry.bossName &&
        typeof bestSingleBossParseEntry.fightId === 'number'
          ? {
              bestSingleBossParse: {
                playerName: bestSingleBossParseEntry.playerName,
                value: bestSingleBossParseEntry.value,
                bossName: bestSingleBossParseEntry.bossName,
                fightId: bestSingleBossParseEntry.fightId,
                metric: resolveMetricLabelFromEntry(bestSingleBossParseEntry),
              },
            }
          : {}),
        ...(bestAverageParseEntry?.playerName
          ? {
              bestAverageParse: {
                playerName: bestAverageParseEntry.playerName,
                value: bestAverageParseEntry.value,
                metric: resolveMetricLabelFromEntry(bestAverageParseEntry),
              },
            }
          : {}),
        topOverallParsers,
        topOverallDamageParsers,
        topOverallHealingParsers,
      },
    };
  },
};
