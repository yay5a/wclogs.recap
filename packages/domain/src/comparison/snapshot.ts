import type { NormalizedLeaderboardEntry, NormalizedPlayer, NormalizedReport } from '../index.js';
import { normalizeIdentityPart, resolveCharacterComparisonIdentity } from './identity.js';

export interface ComparisonSnapshotInput {
  guildId: string;
  reportCode: string;
  reportStartedAt: Date;
  participantKey: string;
  warcraftLogsActorId?: number;
  warcraftLogsGuid?: number;
  characterName?: string;
  server?: string;
  region?: string;
  realm?: string;
  rankPercent?: number;
  damageTotal?: number;
  healingTotal?: number;
  deaths?: number;
  interrupts?: number;
  dispels?: number;
}

export interface ComparisonSnapshotExtractionIssue {
  code: 'missing-participant-identity';
  reportCode: string;
  characterName?: string;
  warcraftLogsActorId?: number;
  reason: string;
}

export interface ComparisonSnapshotExtractionResult {
  snapshots: ComparisonSnapshotInput[];
  issues: ComparisonSnapshotExtractionIssue[];
}

export interface ExtractComparisonSnapshotsInput {
  guildId: string;
  report: NormalizedReport;
}

type SnapshotPlayer = NormalizedPlayer & {
  warcraftLogsActorId?: number | null;
  warcraftLogsGuid?: number | null;
  server?: string | null;
  region?: string | null;
  rankPercent?: number | null;
  damageTotal?: number | null;
  healingTotal?: number | null;
  deaths?: number | null;
  interrupts?: number | null;
  dispels?: number | null;
};

type MetricRow = {
  playerName: string;
  value: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const playerNameKey = (name: string | null | undefined): string | undefined =>
  normalizeIdentityPart(name);

const setIfFinite = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  if (isFiniteNumber(value)) {
    target[key] = value;
  }
};

const setIfString = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
) => {
  if (typeof value === 'string' && value.trim().length > 0) {
    target[key] = value;
  }
};

const average = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const buildMetricMap = (rows: readonly MetricRow[] | undefined): Map<string, number> => {
  const metricByPlayer = new Map<string, number>();

  for (const row of rows ?? []) {
    const key = playerNameKey(row.playerName);
    if (!key || !isFiniteNumber(row.value)) continue;
    metricByPlayer.set(key, row.value);
  }

  return metricByPlayer;
};

const collectReportRankingEntries = (report: NormalizedReport): NormalizedLeaderboardEntry[] => {
  const reportWideRankings = [
    ...(report.reportWideRankings?.dps ?? []),
    ...(report.reportWideRankings?.hps ?? []),
  ];

  if (reportWideRankings.length > 0) {
    return reportWideRankings;
  }

  return (report.leaderboards ?? []).filter((entry) => entry.scope === 'report');
};

const buildRankPercentIndexes = (report: NormalizedReport) => {
  const valuesByActorId = new Map<number, number[]>();
  const valuesByName = new Map<string, number[]>();

  for (const entry of collectReportRankingEntries(report)) {
    if (!isFiniteNumber(entry.rankPercent)) continue;

    if (typeof entry.playerId === 'number') {
      const existing = valuesByActorId.get(entry.playerId) ?? [];
      existing.push(entry.rankPercent);
      valuesByActorId.set(entry.playerId, existing);
    }

    const key = playerNameKey(entry.playerName);
    if (key) {
      const existing = valuesByName.get(key) ?? [];
      existing.push(entry.rankPercent);
      valuesByName.set(key, existing);
    }
  }

  return {
    byActorId: new Map(
      Array.from(valuesByActorId.entries()).flatMap(([actorId, values]) => {
        const rankPercent = average(values);
        return rankPercent === undefined ? [] : [[actorId, rankPercent] as const];
      }),
    ),
    byName: new Map(
      Array.from(valuesByName.entries()).flatMap(([name, values]) => {
        const rankPercent = average(values);
        return rankPercent === undefined ? [] : [[name, rankPercent] as const];
      }),
    ),
  };
};

const getPlayerActorId = (player: SnapshotPlayer): number | undefined => {
  if (isFiniteNumber(player.warcraftLogsActorId)) return player.warcraftLogsActorId;
  if (isFiniteNumber(player.actorId)) return player.actorId;
  return undefined;
};

const getMetricForPlayer = (
  player: SnapshotPlayer,
  metricKey: keyof SnapshotPlayer,
  joinedMetricByName: Map<string, number>,
): number | undefined => {
  const directValue = player[metricKey];
  if (isFiniteNumber(directValue)) return directValue;

  const key = playerNameKey(player.name);
  return key ? joinedMetricByName.get(key) : undefined;
};

export const extractComparisonSnapshots = ({
  guildId,
  report,
}: ExtractComparisonSnapshotsInput): ComparisonSnapshotExtractionResult => {
  const rankPercentIndexes = buildRankPercentIndexes(report);
  const damageByName = buildMetricMap(report.reportWideSummary?.topDamageDone);
  const healingByName = buildMetricMap(report.reportWideSummary?.topHealingDone);
  const interruptsByName = buildMetricMap(report.reportWideSummary?.topInterrupts);
  const dispelsByName = buildMetricMap(report.reportWideSummary?.topDispels);
  const snapshots: ComparisonSnapshotInput[] = [];
  const issues: ComparisonSnapshotExtractionIssue[] = [];

  for (const player of report.players as SnapshotPlayer[]) {
    const warcraftLogsActorId = getPlayerActorId(player);
    const identity = resolveCharacterComparisonIdentity({
      characterName: player.name,
      ...(typeof player.realm === 'string' ? { realm: player.realm } : {}),
      ...(typeof player.server === 'string' ? { server: player.server } : {}),
      ...(typeof player.region === 'string' ? { region: player.region } : {}),
    });

    if (identity.status !== 'ready') {
      const issue: ComparisonSnapshotExtractionIssue = {
        code: 'missing-participant-identity',
        reportCode: report.reportCode,
        reason: identity.reason,
      };
      setIfString(issue as unknown as Record<string, unknown>, 'characterName', player.name);
      setIfString(issue as unknown as Record<string, unknown>, 'realm', player.realm);
      setIfString(issue as unknown as Record<string, unknown>, 'server', player.server);
      setIfString(issue as unknown as Record<string, unknown>, 'region', player.region);
      setIfFinite(
        issue as unknown as Record<string, unknown>,
        'warcraftLogsActorId',
        warcraftLogsActorId,
      );
      issues.push(issue);
      continue;
    }

    if (identity.kind !== 'character') {
      continue;
    }

    const playerKey = playerNameKey(player.name);
    const rankPercent =
      (isFiniteNumber(player.rankPercent) ? player.rankPercent : undefined) ??
      (warcraftLogsActorId === undefined ? undefined : rankPercentIndexes.byActorId.get(warcraftLogsActorId)) ??
      (playerKey ? rankPercentIndexes.byName.get(playerKey) : undefined);

    const snapshot: Record<string, unknown> = {
      guildId,
      reportCode: report.reportCode,
      reportStartedAt: new Date(report.startTime),
      participantKey: identity.participantKey,
    };

    setIfFinite(snapshot, 'warcraftLogsActorId', warcraftLogsActorId);
    setIfFinite(snapshot, 'warcraftLogsGuid', player.warcraftLogsGuid);
    setIfString(snapshot, 'characterName', player.name);
    setIfString(snapshot, 'server', player.server);
    setIfString(snapshot, 'region', player.region);
    setIfString(snapshot, 'realm', player.realm);
    setIfFinite(snapshot, 'rankPercent', rankPercent);
    setIfFinite(snapshot, 'damageTotal', getMetricForPlayer(player, 'damageTotal', damageByName));
    setIfFinite(snapshot, 'healingTotal', getMetricForPlayer(player, 'healingTotal', healingByName));
    setIfFinite(snapshot, 'deaths', player.deaths);
    setIfFinite(snapshot, 'interrupts', getMetricForPlayer(player, 'interrupts', interruptsByName));
    setIfFinite(snapshot, 'dispels', getMetricForPlayer(player, 'dispels', dispelsByName));

    snapshots.push(snapshot as unknown as ComparisonSnapshotInput);
  }

  return {
    snapshots,
    issues,
  };
};
