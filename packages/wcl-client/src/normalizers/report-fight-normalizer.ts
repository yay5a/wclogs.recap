import type { ReportEncounterSummaryRow, ReportIndexData, ReportTableMetrics } from '../pipeline/types.js';
import type { ReportMetricRow } from '@wcl/domain';

const compareString = (left: string, right: string): number => left.localeCompare(right);

const pickMostCommonNumber = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0] - right[0];
  })[0]?.[0];
};

const toHighestRateRow = (
  rows: Array<{ playerName?: string; value: number; activeTimeMs?: number }>,
  fallbackDurationMs: number,
): ReportMetricRow | undefined =>
  [...rows]
    .flatMap((row) => {
      if (!row.playerName || typeof row.value !== 'number') return [];
      const durationMs =
        typeof row.activeTimeMs === 'number' && row.activeTimeMs > 0
          ? row.activeTimeMs
          : fallbackDurationMs;
      if (durationMs <= 0) return [];
      return [{ playerName: row.playerName, value: row.value / (durationMs / 1000) }];
    })
    .sort((left, right) => right.value - left.value)[0];

export const normalizeReportFights = (
  index: ReportIndexData,
  tableMetrics: ReportTableMetrics,
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
    groups.set(fight.encounterId, [...(groups.get(fight.encounterId) ?? []), fight]);
  }

  const difficultyById = new Map(index.zoneDifficulties.map((row) => [row.id, row.name]));

  const encounters = [...groups.entries()]
    .map(([encounterId, fights]) => {
      const pulls = fights.length;
      const kills = fights.filter((fight) => fight.kill).length;
      const wipes = pulls - kills;
      const totalDurationMs = fights.reduce((sum, fight) => sum + Math.max(0, fight.endTime - fight.startTime), 0);
      const shortestKillDurationMs = fights
        .filter((fight) => fight.kill)
        .map((fight) => Math.max(0, fight.endTime - fight.startTime))
        .sort((left, right) => left - right)[0];
      const deaths = fights.reduce(
        (sum, fight) => sum + (tableMetrics.deathsByFightId[fight.id] ?? 0),
        0,
      );
      const representative = [...fights].sort((left, right) => left.startTime - right.startTime)[0];
      const highestTotalDps = toHighestRateRow(
        tableMetrics.encounterTopDamageDoneByEncounterId[encounterId] ?? [],
        totalDurationMs,
      );
      const highestHps = toHighestRateRow(
        tableMetrics.encounterTopHealingDoneByEncounterId[encounterId] ?? [],
        totalDurationMs,
      );
      const highestDamageTakenRate = toHighestRateRow(
        tableMetrics.encounterTopDamageTakenByEncounterId[encounterId] ?? [],
        totalDurationMs,
      );

      return {
        encounterId,
        bossName: representative?.name ?? `Encounter ${encounterId}`,
        ...(representative?.difficulty ? { difficultyName: difficultyById.get(representative.difficulty) } : {}),
        pulls,
        kills,
        wipes,
        totalDurationMs,
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
    index.completedBossFights.flatMap((fight) => (typeof fight.difficulty === 'number' ? [fight.difficulty] : [])),
  );
  const inferredSize = pickMostCommonNumber(
    index.completedBossFights.flatMap((fight) => (typeof fight.size === 'number' ? [fight.size] : [])),
  );
  const inferredDifficultyName =
    typeof inferredDifficultyId === 'number'
      ? difficultyById.get(inferredDifficultyId)
      : undefined;

  return {
    encounters,
    ...(typeof inferredDifficultyName === 'string' ? { inferredDifficultyName } : {}),
    ...(typeof inferredSize === 'number' ? { inferredSizeLabel: `${inferredSize}man` } : {}),
    totalPulls: encounters.reduce((sum, encounter) => sum + encounter.pulls, 0),
    totalKills: encounters.reduce((sum, encounter) => sum + encounter.kills, 0),
    totalWipes: encounters.reduce((sum, encounter) => sum + encounter.wipes, 0),
  };
};
