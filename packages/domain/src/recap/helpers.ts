import type {
  NormalizedBossPerformance,
  NormalizedLeaderboardEntry,
  RecapSummary,
} from '../index.js';

export const formatDateMmDdYyyy = (timestampMs: number): string => {
  const date = new Date(timestampMs);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  return `${month}/${day}/${year}`;
};

export const formatRaidDurationHoursMinutes = (durationMs: number): string => {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 1) return `${minutes} Min`;

  const hourLabel = hours === 1 ? 'Hour' : 'Hours';
  const minuteLabel = minutes === 1 ? 'Min' : 'Min';
  return `${String(hours).padStart(2, '0')} ${hourLabel} ${String(minutes).padStart(2, '0')} ${minuteLabel}`;
};

const normalizeTitleToken = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

const DIFFICULTY_LABELS: ReadonlyMap<number, string> = new Map([
  [1, 'LFR'],
  [2, 'Normal'],
  [3, 'Normal'],
  [4, 'Heroic'],
  [5, 'Mythic'],
]);

export const resolveDifficultyLabel = (
  difficultyName?: string,
  difficultyId?: number,
): string | undefined => {
  if (difficultyName && difficultyName.trim().length > 0) {
    return difficultyName.trim();
  }
  if (typeof difficultyId === 'number') {
    return DIFFICULTY_LABELS.get(difficultyId);
  }
  return undefined;
};

const buildRecapTitleLine = (
  reportTitle: string,
  zoneName?: string,
  difficultyLabel?: string,
): string => {
  if (zoneName) {
    if (difficultyLabel) return `${zoneName} - ${difficultyLabel}`;
    return zoneName;
  }
  return reportTitle;
};

export const buildTitleContext = ({
  reportTitle,
  zoneName,
  difficultyLabel,
}: {
  reportTitle: string;
  zoneName?: string;
  difficultyLabel?: string;
}) => {
  const titleLine = buildRecapTitleLine(reportTitle, zoneName, difficultyLabel);
  const reportAndZoneMatch =
    zoneName && normalizeTitleToken(reportTitle) === normalizeTitleToken(zoneName);
  return { titleLine, reportAndZoneMatch };
};

export const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

const toDisplayClassName = (className?: string): string | undefined => {
  if (!className) return undefined;
  return className.replace(/([a-z])([A-Z])/g, '$1 $2');
};

export const toClassSpecLabel = (className?: string, specName?: string): string | undefined => {
  const displayClassName = toDisplayClassName(className);
  if (specName && displayClassName) return `${specName} ${displayClassName}`;
  return specName ?? displayClassName;
};

export const toNormalizedPlayerKey = (playerName: string): string =>
  playerName.trim().toLowerCase();

const identityRichnessScore = (row: {
  className?: string;
  specName?: string;
  classSpecLabel?: string;
}): number => {
  let score = 0;
  if (row.className) score += 1;
  if (row.specName) score += 1;
  if (row.classSpecLabel) score += 1;
  return score;
};

export const dedupeRowsByPlayerStrongest = <
  T extends {
    playerName: string;
    value: number;
    amount?: number;
    className?: string;
    specName?: string;
    classSpecLabel?: string;
  },
>(
  rows: readonly T[],
): T[] => {
  const strongestByPlayer = new Map<string, T>();
  for (const row of rows) {
    const key = toNormalizedPlayerKey(row.playerName);
    const current = strongestByPlayer.get(key);
    if (!current) {
      strongestByPlayer.set(key, row);
      continue;
    }

    if (row.value > current.value) {
      strongestByPlayer.set(key, row);
      continue;
    }
    if (row.value < current.value) continue;

    const rowHasAmount = typeof row.amount === 'number';
    const currentHasAmount = typeof current.amount === 'number';
    if (rowHasAmount && !currentHasAmount) {
      strongestByPlayer.set(key, row);
      continue;
    }
    if (!rowHasAmount && currentHasAmount) continue;

    const rowIdentityScore = identityRichnessScore(row);
    const currentIdentityScore = identityRichnessScore(current);
    if (rowIdentityScore > currentIdentityScore) {
      strongestByPlayer.set(key, row);
    }
  }
  return [...strongestByPlayer.values()];
};

export const toMetricLabel = (value: string | undefined, role?: string): string => {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return 'DPS';
  if (normalized === 'DPS' || normalized === 'HPS' || normalized === 'DTPS') {
    return normalized;
  }
  const normalizedRole = role?.trim().toLowerCase();
  if (normalizedRole === 'healer') return 'HPS';
  if (normalizedRole === 'tank') return 'DTPS';
  return 'DPS';
};

export const resolveMetricLabelFromEntry = (
  entry: Pick<NormalizedLeaderboardEntry, 'selectedMetric' | 'metric' | 'role'>,
): string =>
  toMetricLabel(
    entry.selectedMetric ??
      (entry.metric === 'DPS' || entry.metric === 'HPS' || entry.metric === 'DTPS'
        ? entry.metric
        : undefined),
    entry.role,
  );

export type SelectedBoss = NormalizedBossPerformance | undefined;

export const buildRaidSuperlatives = (
  bossPerformances: NormalizedBossPerformance[],
): RecapSummary['raidSuperlatives'] => {
  const topBossInterrupt = bossPerformances
    .filter(
      (
        boss,
      ): boss is NormalizedBossPerformance & {
        topInterrupts: { playerName: string; value: number };
      } => Boolean(boss.topInterrupts?.playerName) && typeof boss.topInterrupts?.value === 'number',
    )
    .sort((left, right) => right.topInterrupts.value - left.topInterrupts.value)[0];
  const topBossSurvivability = bossPerformances
    .filter(
      (
        boss,
      ): boss is NormalizedBossPerformance & {
        topSurvivability: { playerName: string; value: number };
      } =>
        Boolean(boss.topSurvivability?.playerName) &&
        typeof boss.topSurvivability?.value === 'number',
    )
    .sort((left, right) => right.topSurvivability.value - left.topSurvivability.value)[0];
  const topBossDeaths = bossPerformances
    .filter(
      (
        boss,
      ): boss is NormalizedBossPerformance & {
        mostDeaths: { playerName: string; value: number };
      } => Boolean(boss.mostDeaths?.playerName) && typeof boss.mostDeaths?.value === 'number',
    )
    .sort((left, right) => right.mostDeaths.value - left.mostDeaths.value)[0];
  const fastestPhase = bossPerformances
    .flatMap((boss) =>
      (boss.fastestPhaseTimes ?? []).map((phase) => ({
        bossName: boss.bossName,
        label: phase.label,
        durationMs: phase.durationMs,
      })),
    )
    .sort((left, right) => left.durationMs - right.durationMs)[0];

  return [
    ...(topBossInterrupt
      ? [
          {
            label: 'Most interrupts',
            text: `${topBossInterrupt.topInterrupts.playerName} (${topBossInterrupt.topInterrupts.value}) on ${topBossInterrupt.bossName}`,
          },
        ]
      : []),
    ...(topBossSurvivability
      ? [
          {
            label: 'Best survivability',
            text: `${topBossSurvivability.topSurvivability.playerName} (${topBossSurvivability.topSurvivability.value.toFixed(1)}) on ${topBossSurvivability.bossName}`,
          },
        ]
      : []),
    ...(topBossDeaths
      ? [
          {
            label: 'Most deaths',
            text: `${topBossDeaths.mostDeaths.playerName} (${topBossDeaths.mostDeaths.value}) on ${topBossDeaths.bossName}`,
          },
        ]
      : []),
    ...(fastestPhase
      ? [
          {
            label: 'Fastest phase',
            text: `${fastestPhase.bossName} ${fastestPhase.label} ${(fastestPhase.durationMs / 1000).toFixed(1)}s`,
          },
        ]
      : []),
  ].slice(0, 4);
};
