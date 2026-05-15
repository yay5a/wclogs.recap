import type {
  ReportEncounterSummaryRow,
  ReportIndexData,
  ReportTableMetrics,
} from '../pipeline/types.js';
import type { ReportMetricRow } from '@wcl/domain';
import type { ParsedPlayerDetail } from '../parsers/report-details.js';
import type { ParsedTableEntry } from '../parsers/table.js';
import type { ReportMasterData } from '../pipeline/types.js';
import { normalizeTableMetricRows } from './table-metric-normalizer.js';

const compareString = (left: string, right: string): number => left.localeCompare(right);

type PlayerMetricContext = {
  masterData: ReportMasterData;
  playerDetails: ParsedPlayerDetail[];
};

const EMPTY_PLAYER_CONTEXT: PlayerMetricContext = {
  masterData: { actors: [] },
  playerDetails: [],
};

const pickMostCommonNumber = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  let bestValue: number | undefined;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (
      count > bestCount ||
      (count === bestCount && (typeof bestValue !== 'number' || value < bestValue))
    ) {
      bestValue = value;
      bestCount = count;
    }
  }

  return bestValue;
};

const toHighestRateRow = (
  rows: ParsedTableEntry[],
  fallbackDurationMs: number,
  context: PlayerMetricContext = EMPTY_PLAYER_CONTEXT,
): ReportMetricRow | undefined => {
  let highest: ReportMetricRow | undefined;
  const metricRows = normalizeTableMetricRows(
    rows,
    context.masterData,
    context.playerDetails,
    rows.length,
  );

  for (const row of metricRows) {
    const durationMs =
      typeof row.activeTimeMs === 'number' && row.activeTimeMs > 0
        ? row.activeTimeMs
        : fallbackDurationMs;
    if (durationMs <= 0) continue;
    const candidate = {
      playerName: row.playerName,
      value: row.value / (durationMs / 1000),
      ...(row.className ? { className: row.className } : {}),
      ...(row.specName ? { specName: row.specName } : {}),
    };
    if (!highest || candidate.value > highest.value) highest = candidate;
  }
  return highest;
};

const validPullDurationMs = (fight: { startTime: number; endTime: number }): number | undefined => {
  const durationMs = fight.endTime - fight.startTime;
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined;
};

export const normalizeReportFights = (
  index: ReportIndexData,
  tableMetrics: ReportTableMetrics,
  playerContext: PlayerMetricContext = EMPTY_PLAYER_CONTEXT,
): {
  encounters: ReportEncounterSummaryRow[];
  inferredDifficultyName?: string;
  inferredSizeLabel?: string;
  totalPulls: number;
  totalKills: number;
  totalWipes: number;
} => {
  const groups = new Map<number, typeof index.completedBossFights>();
  for (const fight of index.completedBossFights) {
    const fights = groups.get(fight.encounterId);
    if (fights) {
      fights.push(fight);
    } else {
      groups.set(fight.encounterId, [fight]);
    }
  }

  const difficultyById = new Map(index.zoneDifficulties.map((row) => [row.id, row.name]));

  const encounters = [...groups.entries()]
    .map(([encounterId, fights]) => {
      const pulls = fights.length;
      let kills = 0;
      let totalDurationMs = 0;
      let shortestPullMs: number | undefined;
      let longestPullMs: number | undefined;
      let shortestKillDurationMs: number | undefined;
      let deaths = 0;
      let representative = fights[0];
      for (const fight of fights) {
        const durationMs = validPullDurationMs(fight);
        if (typeof durationMs === 'number') {
          totalDurationMs += durationMs;
          if (typeof shortestPullMs !== 'number' || durationMs < shortestPullMs) {
            shortestPullMs = durationMs;
          }
          if (typeof longestPullMs !== 'number' || durationMs > longestPullMs) {
            longestPullMs = durationMs;
          }
        }
        if (fight.kill) {
          kills += 1;
          if (
            typeof durationMs === 'number' &&
            (typeof shortestKillDurationMs !== 'number' || durationMs < shortestKillDurationMs)
          ) {
            shortestKillDurationMs = durationMs;
          }
        }
        deaths += tableMetrics.deathsByFightId[fight.id] ?? 0;
        if (!representative || fight.startTime < representative.startTime) {
          representative = fight;
        }
      }
      const wipes = pulls - kills;
      const highestTotalDps = toHighestRateRow(
        tableMetrics.encounterTopDamageDoneByEncounterId[encounterId] ?? [],
        totalDurationMs,
        playerContext,
      );
      const highestHps = toHighestRateRow(
        tableMetrics.encounterTopHealingDoneByEncounterId[encounterId] ?? [],
        totalDurationMs,
        playerContext,
      );
      const highestDamageTakenRate = toHighestRateRow(
        tableMetrics.encounterTopDamageTakenByEncounterId[encounterId] ?? [],
        totalDurationMs,
        playerContext,
      );

      return {
        encounterId,
        bossName: representative?.name ?? `Encounter ${encounterId}`,
        ...(representative?.difficulty
          ? { difficultyName: difficultyById.get(representative.difficulty) }
          : {}),
        pulls,
        kills,
        wipes,
        totalDurationMs,
        ...(typeof shortestPullMs === 'number' ? { shortestPullMs } : {}),
        ...(typeof longestPullMs === 'number' ? { longestPullMs } : {}),
        ...(typeof shortestKillDurationMs === 'number' ? { shortestKillDurationMs } : {}),
        deaths,
        ...(highestTotalDps ? { highestTotalDps } : {}),
        ...(highestHps ? { highestHps } : {}),
        ...(highestDamageTakenRate ? { highestDamageTakenRate } : {}),
      } as ReportEncounterSummaryRow;
    })
    .sort((left, right) => {
      if (left.encounterId !== right.encounterId) return left.encounterId - right.encounterId;
      return compareString(left.bossName, right.bossName);
    });

  const inferredDifficultyId = pickMostCommonNumber(
    index.completedBossFights.flatMap((fight) =>
      typeof fight.difficulty === 'number' ? [fight.difficulty] : [],
    ),
  );
  const inferredSize = pickMostCommonNumber(
    index.completedBossFights.flatMap((fight) =>
      typeof fight.size === 'number' ? [fight.size] : [],
    ),
  );
  const inferredDifficultyName =
    typeof inferredDifficultyId === 'number' ? difficultyById.get(inferredDifficultyId) : undefined;

  return {
    encounters,
    ...(typeof inferredDifficultyName === 'string' ? { inferredDifficultyName } : {}),
    ...(typeof inferredSize === 'number' ? { inferredSizeLabel: `${inferredSize}man` } : {}),
    totalPulls: encounters.reduce((sum, encounter) => sum + encounter.pulls, 0),
    totalKills: encounters.reduce((sum, encounter) => sum + encounter.kills, 0),
    totalWipes: encounters.reduce((sum, encounter) => sum + encounter.wipes, 0),
  };
};
