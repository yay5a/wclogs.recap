import type {
  NormalizedBossPerformance,
  NormalizedPlayer,
  NormalizedReport,
  RecapSummary,
} from '../index.js';
import { buildRaidSuperlatives, formatCompactNumber, toNormalizedPlayerKey } from './helpers.js';

export interface ExecutionInput {
  report: NormalizedReport;
  previousPlayers?: NormalizedPlayer[];
  bossPerformances: NormalizedBossPerformance[];
}

export interface ExecutionResult {
  section: Pick<
    RecapSummary,
    'bestExecution' | 'mostImprovedPlayer' | 'bossHighlights' | 'raidSuperlatives'
  >;
}

const IMPROVEMENT_NOISE_THRESHOLD = 2.0;

export const Execution = {
  build({ report, previousPlayers, bossPerformances }: ExecutionInput): ExecutionResult {
    const bestExecutionPlayer = [...report.players]
      .filter((player) => typeof player.executionScore === 'number')
      .sort(
        (left, right) =>
          (right.executionScore ?? Number.NEGATIVE_INFINITY) -
          (left.executionScore ?? Number.NEGATIVE_INFINITY),
      )[0];

    const previousByActorId = new Map<number, NormalizedPlayer>();
    const previousByName = new Map<string, NormalizedPlayer>();
    for (const player of previousPlayers ?? []) {
      if (typeof player.actorId === 'number') {
        previousByActorId.set(player.actorId, player);
      }
      previousByName.set(toNormalizedPlayerKey(player.name), player);
    }
    const improvedPlayer = [...report.players]
      .flatMap((player) => {
        const previous =
          (typeof player.actorId === 'number'
            ? previousByActorId.get(player.actorId)
            : undefined) ?? previousByName.get(toNormalizedPlayerKey(player.name));
        if (!previous) return [];

        const parseDelta =
          typeof player.avgParse === 'number' && typeof previous.avgParse === 'number'
            ? player.avgParse - previous.avgParse
            : undefined;
        const executionDelta =
          typeof player.executionScore === 'number' && typeof previous.executionScore === 'number'
            ? player.executionScore - previous.executionScore
            : undefined;
        const hasParse = typeof parseDelta === 'number';
        const hasExecution = typeof executionDelta === 'number';
        if (!hasParse && !hasExecution) return [];
        const improvementScore =
          hasParse && hasExecution
            ? parseDelta * 0.4 + executionDelta * 0.6
            : hasExecution
              ? executionDelta
              : (parseDelta ?? 0);
        return [
          {
            playerName: player.name,
            score: improvementScore,
          },
        ];
      })
      .sort((left, right) => right.score - left.score)[0];

    const bossHighlights = bossPerformances
      .filter((boss) => typeof boss.fightId === 'number')
      .slice(0, 4)
      .map((boss) => {
        const lines: string[] = [boss.kill ? '✅ Kill' : '⚠️ Progress'];
        const signals: string[] = [];
        if (boss.topDamage?.playerName && typeof boss.topDamage.value === 'number') {
          signals.push(
            `Dmg ${boss.topDamage.playerName} ${formatCompactNumber(boss.topDamage.value)}`,
          );
        }
        if (boss.topHealing?.playerName && typeof boss.topHealing.value === 'number') {
          signals.push(
            `Heal ${boss.topHealing.playerName} ${formatCompactNumber(boss.topHealing.value)}`,
          );
        }
        if (boss.mostDeaths?.playerName && typeof boss.mostDeaths.value === 'number') {
          signals.push(`Deaths ${boss.mostDeaths.playerName} ${boss.mostDeaths.value}`);
        }
        if (boss.topInterrupts?.playerName && typeof boss.topInterrupts.value === 'number') {
          signals.push(`Ints ${boss.topInterrupts.playerName} ${boss.topInterrupts.value}`);
        }
        if (boss.topSurvivability?.playerName && typeof boss.topSurvivability.value === 'number') {
          signals.push(
            `Surv ${boss.topSurvivability.playerName} ${boss.topSurvivability.value.toFixed(1)}`,
          );
        }
        if (boss.fastestPhaseTimes && boss.fastestPhaseTimes.length > 0) {
          const fastest = [...boss.fastestPhaseTimes].sort(
            (left, right) => left.durationMs - right.durationMs,
          )[0];
          if (fastest) {
            signals.push(`Fast ${fastest.label} ${(fastest.durationMs / 1000).toFixed(1)}s`);
          }
        }
        lines.push(...signals.slice(0, 2));
        return {
          bossName: boss.bossName,
          fightId: boss.fightId,
          text: lines.join(' · '),
        };
      });

    return {
      section: {
        ...(bestExecutionPlayer
          ? {
              bestExecution: {
                playerName: bestExecutionPlayer.name,
                value: bestExecutionPlayer.executionScore ?? 0,
              },
            }
          : {}),
        ...(improvedPlayer && improvedPlayer.score >= IMPROVEMENT_NOISE_THRESHOLD
          ? {
              mostImprovedPlayer: {
                playerName: improvedPlayer.playerName,
                delta: improvedPlayer.score,
              },
            }
          : {}),
        bossHighlights,
        raidSuperlatives: buildRaidSuperlatives(bossPerformances),
      },
    };
  },
};
