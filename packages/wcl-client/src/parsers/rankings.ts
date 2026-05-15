import type { NormalizedLeaderboardEntry } from '@wcl/domain';
import {
  asArray,
  asNumber,
  asObject,
  asString,
  defaultDebugWarn,
  describePayloadShape,
  normalizeName,
  parseUnknownJson,
} from './common.js';
import type { DebugWarn } from './common.js';

const METRIC_KEY_CANDIDATES = [
  'rankPercent',
  'bracketPercent',
  'bestPerformanceAverage',
  'performanceAverage',
  'bestPercent',
  'percentile',
  'execution',
  'executionScore',
  // Dungeon-oriented rankings can use playerScore/playerSpeed metrics.
  'playerscore',
  'playerspeed',
] as const;

const readMetric = (
  entry: Record<string, unknown>,
): {
  metric: string;
  value: number;
} | null => {
  // WCL rankings payload keys vary by endpoint/game family; probe known metric keys in priority order.
  for (const key of METRIC_KEY_CANDIDATES) {
    const value = asNumber(entry[key]);
    if (typeof value === 'number') {
      return { metric: key, value };
    }
  }

  const amount = asNumber(entry.amount);
  if (typeof amount === 'number') {
    return { metric: 'amount', value: amount };
  }

  return null;
};

const collectContainers = (parsed: unknown): unknown[] => {
  const root = asObject(parsed);
  if (!root) return asArray(parsed) ?? [];

  const data = asObject(root.data);
  const rankings = asObject(root.rankings);
  const entries = asObject(root.entries);

  return [
    ...(asArray(root.data) ?? []),
    ...(asArray(root.rankings) ?? []),
    ...(asArray(root.players) ?? []),
    ...(asArray(root.entries) ?? []),
    ...(asArray(data?.rankings) ?? []),
    ...(asArray(data?.entries) ?? []),
    ...(asArray(rankings?.data) ?? []),
    ...(asArray(entries?.data) ?? []),
    root,
  ];
};

const collectRoleCharacters = (
  row: Record<string, unknown>,
): Array<{ role: string; character: Record<string, unknown> }> => {
  const roles = asObject(row.roles);
  if (!roles) return [];

  const buckets: Array<{ role: string; key: 'tanks' | 'healers' | 'dps' }> = [
    { role: 'tank', key: 'tanks' },
    { role: 'healer', key: 'healers' },
    { role: 'dps', key: 'dps' },
  ];

  return buckets.flatMap(({ role, key }) => {
    const bucket = asObject(roles[key]);
    const characters = asArray(bucket?.characters) ?? [];
    return characters.flatMap((character) => {
      const normalized = asObject(character);
      return normalized ? [{ role, character: normalized }] : [];
    });
  });
};

type RankingRole = 'tank' | 'healer' | 'dps';

const collectFightRows = (parsed: unknown): Record<string, unknown>[] => {
  const root = asObject(parsed);
  if (!root) return [];
  return (asArray(root.data) ?? []).flatMap((entry) => {
    const row = asObject(entry);
    return row ? [row] : [];
  });
};

const normalizeMetricIdentity = (value: unknown): string | undefined => {
  const normalized = asString(value)?.trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized === 'DPS' || normalized === 'HPS' || normalized === 'DTPS') {
    return normalized;
  }
  return undefined;
};

const inferMetricIdentityFromRole = (role: string | undefined): string => {
  const normalizedRole = role?.trim().toLowerCase();
  if (normalizedRole === 'healer') return 'HPS';
  if (normalizedRole === 'tank') return 'DPS';
  return 'DPS';
};

const readExplicitMetricIdentity = (
  entry: Record<string, unknown>,
  player?: Record<string, unknown>,
): string | undefined =>
  normalizeMetricIdentity(entry.selectedMetric) ??
  normalizeMetricIdentity(entry.playerMetric) ??
  normalizeMetricIdentity(entry.metric) ??
  normalizeMetricIdentity(player?.selectedMetric) ??
  normalizeMetricIdentity(player?.playerMetric) ??
  normalizeMetricIdentity(player?.metric);

const toLeaderboardEntry = (
  item: unknown,
  scope: 'report' | 'boss',
  warn: DebugWarn,
  fallback?: { bossName?: string; fightId?: number },
): NormalizedLeaderboardEntry | undefined => {
  const entry = asObject(item);
  if (!entry) return undefined;

  const metric = readMetric(entry);
  if (!metric) return undefined;

  const player = asObject(entry.player);
  const character = asObject(entry.character);
  const actor = asObject(entry.actor);

  const playerId =
    asNumber(entry.id) ??
    asNumber(entry.playerID) ??
    asNumber(entry.playerId) ??
    asNumber(player?.id) ??
    asNumber(actor?.id);
  const playerName =
    asString(entry.name) ??
    asString(entry.playerName) ??
    asString(player?.name) ??
    asString(character?.name) ??
    asString(actor?.name);

  if (!playerId && !playerName) {
    warn('rankings parser: skipping entry with no player identity', {
      entry,
    });
    return undefined;
  }

  const className =
    asString(entry.className) ??
    asString(entry.class) ??
    asString(player?.class) ??
    asString(actor?.subType);
  const specName =
    asString(entry.specName) ??
    asString(entry.spec) ??
    asString(player?.spec) ??
    asString(character?.spec);
  const role = asString(entry.role) ?? asString(player?.role);
  const selectedMetric =
    readExplicitMetricIdentity(entry, player) ?? inferMetricIdentityFromRole(role);
  const bossName = asString(entry.bossName) ?? asString(entry.encounterName) ?? fallback?.bossName;
  const fightId = asNumber(entry.fightID) ?? asNumber(entry.fightId) ?? fallback?.fightId;

  const rank = asNumber(entry.rank);
  const amount = asNumber(entry.amount);
  const best = asNumber(entry.best);
  const rankPercent = asNumber(entry.rankPercent);
  const bracketPercent = asNumber(entry.bracketPercent);

  const result: NormalizedLeaderboardEntry = {
    scope,
    metric: metric.metric,
    selectedMetric,
    value: metric.value,
    ...(typeof rank === 'number' ? { rank } : {}),
    ...(typeof amount === 'number' ? { amount } : {}),
    ...(typeof best === 'number' ? { best } : {}),
    ...(typeof rankPercent === 'number' ? { rankPercent } : {}),
    ...(typeof bracketPercent === 'number' ? { bracketPercent } : {}),
    ...(typeof playerId === 'number' ? { playerId } : {}),
    ...(playerName ? { playerName } : {}),
    ...(className ? { className } : {}),
    ...(specName ? { specName } : {}),
    ...(role ? { role } : {}),
    ...(bossName ? { bossName } : {}),
    ...(typeof fightId === 'number' ? { fightId } : {}),
  };
  return result;
};

export const parseReportRankingsPayload = (
  payload: unknown,
  warn: DebugWarn = defaultDebugWarn,
): NormalizedLeaderboardEntry[] => {
  const parsed = parseUnknownJson(payload, warn, 'report rankings');
  const candidates = collectContainers(parsed);
  const roleEntries = collectFightRows(parsed).flatMap((fightRow) =>
    collectRoleCharacters(fightRow).map(({ role, character }) => ({
      ...character,
      role,
      fightID:
        asNumber(character.fightID) ?? asNumber(fightRow.fightID) ?? asNumber(fightRow.fightId),
      encounterName:
        asString(character.encounterName) ??
        asString(asObject(fightRow.encounter)?.name) ??
        asString(fightRow.encounter),
    })),
  );
  if (candidates.length === 0) {
    warn('rankings parser (report payload): unrecognized payload shape', {
      payloadShape: describePayloadShape(parsed),
    });
    return [];
  }

  const results: NormalizedLeaderboardEntry[] = [];
  for (const candidate of [...candidates, ...roleEntries]) {
    const normalized = toLeaderboardEntry(candidate, 'report', warn);
    if (normalized) results.push(normalized);
  }

  if (results.length === 0) {
    warn('rankings parser (report payload): no leaderboard entries detected', {
      payloadShape: describePayloadShape(parsed),
    });
  }
  return results;
};

export const parseReportRankingsPayloadForRole = (
  payload: unknown,
  role: RankingRole,
  warn: DebugWarn = defaultDebugWarn,
): NormalizedLeaderboardEntry[] => {
  const parsed = parseUnknownJson(payload, warn, 'report rankings');
  const fightRows = collectFightRows(parsed);
  if (fightRows.length === 0) {
    warn('rankings parser (report payload by role): unrecognized payload shape', {
      payloadShape: describePayloadShape(parsed),
      role,
    });
    return [];
  }

  const roleEntries = fightRows.flatMap((fightRow) =>
    collectRoleCharacters(fightRow)
      .filter((entry) => entry.role === role)
      .map(({ role: entryRole, character }) => ({
        ...character,
        role: entryRole,
        fightID:
          asNumber(character.fightID) ?? asNumber(fightRow.fightID) ?? asNumber(fightRow.fightId),
        encounterName:
          asString(character.encounterName) ??
          asString(asObject(fightRow.encounter)?.name) ??
          asString(fightRow.encounter),
      })),
  );

  const results: NormalizedLeaderboardEntry[] = [];
  for (const candidate of roleEntries) {
    const normalized = toLeaderboardEntry(candidate, 'report', warn);
    if (normalized) results.push(normalized);
  }

  if (results.length === 0) {
    warn('rankings parser (report payload by role): no leaderboard entries detected', {
      payloadShape: describePayloadShape(parsed),
      role,
    });
  }
  return results;
};

export const parseBossRankingsPayload = (
  payload: unknown,
  context: { bossName?: string; fightId?: number },
  warn: DebugWarn = defaultDebugWarn,
): NormalizedLeaderboardEntry[] => {
  const parsed = parseUnknownJson(payload, warn, 'boss rankings');
  const candidates = collectContainers(parsed);
  const roleEntries = collectFightRows(parsed).flatMap((fightRow) =>
    collectRoleCharacters(fightRow).map(({ role, character }) => ({
      ...character,
      role,
      fightID:
        asNumber(character.fightID) ??
        asNumber(fightRow.fightID) ??
        asNumber(fightRow.fightId) ??
        context.fightId,
      encounterName:
        asString(character.encounterName) ??
        asString(asObject(fightRow.encounter)?.name) ??
        asString(fightRow.encounter) ??
        context.bossName,
    })),
  );
  if (candidates.length === 0) {
    warn('rankings parser (boss payload): unrecognized payload shape', {
      payloadShape: describePayloadShape(parsed),
      context,
    });
    return [];
  }

  const results: NormalizedLeaderboardEntry[] = [];
  for (const candidate of [...candidates, ...roleEntries]) {
    const normalized = toLeaderboardEntry(candidate, 'boss', warn, context);
    if (normalized) results.push(normalized);
  }

  if (results.length === 0) {
    warn('rankings parser (boss payload): no leaderboard entries detected', {
      payloadShape: describePayloadShape(parsed),
      context,
    });
  }

  return results;
};

export const indexLeaderboardByActorAndName = (
  entries: NormalizedLeaderboardEntry[],
): {
  byActorId: Map<number, NormalizedLeaderboardEntry[]>;
  byName: Map<string, NormalizedLeaderboardEntry[]>;
} => {
  const byActorId = new Map<number, NormalizedLeaderboardEntry[]>();
  const byName = new Map<string, NormalizedLeaderboardEntry[]>();

  for (const entry of entries) {
    if (typeof entry.playerId === 'number') {
      const existing = byActorId.get(entry.playerId) ?? [];
      existing.push(entry);
      byActorId.set(entry.playerId, existing);
    }

    if (entry.playerName) {
      const key = normalizeName(entry.playerName);
      const existing = byName.get(key) ?? [];
      existing.push(entry);
      byName.set(key, existing);
    }
  }

  return { byActorId, byName };
};
