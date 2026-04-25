import type {
  BuildRecapSummaryOptions,
  NormalizedBossPerformance,
  NormalizedPlayer,
  NormalizedReport,
  RecapSummary,
} from '../index.js';
import { Execution } from './execution.js';
import { Outcome } from './outcome.js';
import { Performance } from './performance.js';
import { Volume } from './volume.js';

const selectBoss = (
  bossPerformances: NormalizedBossPerformance[],
): NormalizedBossPerformance | undefined =>
  [...bossPerformances]
    .filter((boss) => boss.kill)
    .sort((left, right) => (right.fightDate ?? 0) - (left.fightDate ?? 0))[0] ??
  [...bossPerformances].sort((left, right) => (right.fightDate ?? 0) - (left.fightDate ?? 0))[0];

export const buildRecapSummary = (
  report: NormalizedReport,
  previousPlayers?: NormalizedPlayer[],
  options?: BuildRecapSummaryOptions,
): RecapSummary => {
  const bossPerformances = [...(report.bossPerformances ?? [])];
  const selectedBoss = selectBoss(bossPerformances);

  const outcome = Outcome.build({
    report,
    ...(options?.guildConfig ? { guildConfig: options.guildConfig } : {}),
    selectedBoss,
    bossPerformances,
  });
  const performance = Performance.build({ report });
  const volume = Volume.build({ report, bossPerformances });
  const execution = Execution.build({
    report,
    ...(previousPlayers ? { previousPlayers } : {}),
    bossPerformances,
  });

  return {
    ...outcome.section,
    ...performance.section,
    ...volume.section,
    ...execution.section,
  };
};
