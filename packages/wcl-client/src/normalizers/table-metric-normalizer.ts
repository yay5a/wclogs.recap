import type { ReportMetricRow } from '@wcl/domain';
import type { ParsedPlayerDetail } from '../parsers/report-details.js';
import type { ParsedTableEntry } from '../parsers/table.js';
import type { ReportMasterData } from '../pipeline/types.js';

const normalizeNameKey = (value: string): string => value.trim().toLowerCase();

type PlayerMetadata = {
  playerId?: number;
  playerName: string;
  className?: string;
  specName?: string;
};

type PlayerActorIndex = {
  byId: Map<number, PlayerMetadata>;
  byName: Map<string, PlayerMetadata>;
  hasKnownPlayers: boolean;
};

type PlayerMetricAggregate = {
  playerName: string;
  value: number;
  firstSeen: number;
  activeTimeMs: number;
  hasActiveTime: boolean;
  missingActiveTime: boolean;
  className?: string;
  specName?: string;
};

const NON_PLAYER_ACTOR_TYPES = new Set([
  'ability',
  'environment',
  'guardian',
  'npc',
  'object',
  'pet',
  'summon',
  'unknown',
  'vehicle',
]);

const NON_PLAYER_NAME_PARTS = ['banner', 'guardian', 'object', 'summon', 'totem', 'trap'];

const isPlayerActorType = (actorType: string): boolean => {
  const normalized = actorType.trim().toLowerCase();
  return normalized === 'player' || normalized === 'character';
};

const hasNonPlayerActorType = (actorType: string | undefined): boolean =>
  actorType ? NON_PLAYER_ACTOR_TYPES.has(actorType.trim().toLowerCase()) : false;

const hasObviousNonPlayerName = (playerName: string): boolean => {
  const normalized = normalizeNameKey(playerName);
  return NON_PLAYER_NAME_PARTS.some((part) => normalized.includes(part));
};

const mergeMetadata = (
  existing: PlayerMetadata | undefined,
  next: PlayerMetadata,
): PlayerMetadata => ({
  playerName: existing?.playerName ?? next.playerName,
  ...(typeof existing?.playerId === 'number'
    ? { playerId: existing.playerId }
    : typeof next.playerId === 'number'
      ? { playerId: next.playerId }
      : {}),
  ...(existing?.className
    ? { className: existing.className }
    : next.className
      ? { className: next.className }
      : {}),
  ...(existing?.specName
    ? { specName: existing.specName }
    : next.specName
      ? { specName: next.specName }
      : {}),
});

const addMetadata = (index: PlayerActorIndex, metadata: PlayerMetadata): void => {
  const key = normalizeNameKey(metadata.playerName);
  const byName = mergeMetadata(index.byName.get(key), metadata);
  index.byName.set(key, byName);
  if (typeof byName.playerId === 'number') {
    index.byId.set(byName.playerId, byName);
  }
};

const toPlayerActorIndex = (
  masterData: ReportMasterData,
  playerDetails: ParsedPlayerDetail[],
): PlayerActorIndex => {
  const index: PlayerActorIndex = {
    byId: new Map(),
    byName: new Map(),
    hasKnownPlayers: masterData.actors.length > 0 || playerDetails.length > 0,
  };

  for (const actor of masterData.actors) {
    addMetadata(index, {
      playerName: actor.name,
      ...(typeof actor.id === 'number' ? { playerId: actor.id } : {}),
      ...(actor.className ? { className: actor.className } : {}),
    });
  }

  for (const detail of playerDetails) {
    const metadata = {
      playerName: detail.name,
      ...(typeof detail.warcraftLogsActorId === 'number'
        ? { playerId: detail.warcraftLogsActorId }
        : typeof detail.warcraftLogsGuid === 'number'
          ? { playerId: detail.warcraftLogsGuid }
          : {}),
      ...(detail.className ? { className: detail.className } : {}),
      ...(detail.specName ? { specName: detail.specName } : {}),
    };
    addMetadata(index, metadata);
    if (typeof detail.warcraftLogsGuid === 'number') {
      const stored = index.byName.get(normalizeNameKey(detail.name));
      if (stored) index.byId.set(detail.warcraftLogsGuid, stored);
    }
  }

  return index;
};

const resolvePlayerMetadata = (
  row: ParsedTableEntry,
  index: PlayerActorIndex,
): PlayerMetadata | undefined => {
  if (!row.playerName) return undefined;
  if (hasNonPlayerActorType(row.actorType)) return undefined;

  const byId = typeof row.playerId === 'number' ? index.byId.get(row.playerId) : undefined;
  if (byId) return byId;

  const byName = index.byName.get(normalizeNameKey(row.playerName));
  if (byName) return byName;

  if (row.actorType && isPlayerActorType(row.actorType)) {
    return {
      playerName: row.playerName,
      ...(typeof row.playerId === 'number' ? { playerId: row.playerId } : {}),
    };
  }

  if (index.hasKnownPlayers || hasObviousNonPlayerName(row.playerName)) {
    return undefined;
  }

  return {
    playerName: row.playerName,
    ...(typeof row.playerId === 'number' ? { playerId: row.playerId } : {}),
  };
};

const getStablePlayerKey = (metadata: PlayerMetadata): string =>
  typeof metadata.playerId === 'number'
    ? `id:${metadata.playerId}`
    : `name:${normalizeNameKey(metadata.playerName)}`;

const addToMetric = (
  aggregates: Map<string, PlayerMetricAggregate>,
  key: string,
  amount: number,
  metadata: PlayerMetadata,
  row: ParsedTableEntry,
  firstSeen: number,
): void => {
  const existing = aggregates.get(key);
  const activeTimeMs =
    typeof row.activeTimeMs === 'number' && row.activeTimeMs > 0 ? row.activeTimeMs : undefined;

  if (!existing) {
    aggregates.set(key, {
      playerName: metadata.playerName,
      value: amount,
      firstSeen,
      activeTimeMs: activeTimeMs ?? 0,
      hasActiveTime: typeof activeTimeMs === 'number',
      missingActiveTime: typeof activeTimeMs !== 'number',
      ...(metadata.className ? { className: metadata.className } : {}),
      ...(metadata.specName ? { specName: metadata.specName } : {}),
    });
    return;
  }

  existing.value += amount;
  if (typeof activeTimeMs === 'number') {
    existing.activeTimeMs += activeTimeMs;
    existing.hasActiveTime = true;
  } else {
    existing.missingActiveTime = true;
  }
  if (!existing.className && metadata.className) existing.className = metadata.className;
  if (!existing.specName && metadata.specName) existing.specName = metadata.specName;
};

const getTopNFromAggregates = (
  aggregates: Map<string, PlayerMetricAggregate>,
  limit: number,
): ReportMetricRow[] =>
  [...aggregates.values()]
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      if (left.firstSeen !== right.firstSeen) return left.firstSeen - right.firstSeen;
      return left.playerName.localeCompare(right.playerName);
    })
    .slice(0, Math.max(0, limit))
    .map((row) => ({
      playerName: row.playerName,
      value: row.value,
      ...(row.hasActiveTime && !row.missingActiveTime ? { activeTimeMs: row.activeTimeMs } : {}),
      ...(row.className ? { className: row.className } : {}),
      ...(row.specName ? { specName: row.specName } : {}),
    }));

export const normalizeTableMetricRows = (
  rows: ParsedTableEntry[],
  masterData: ReportMasterData,
  playerDetails: ParsedPlayerDetail[],
  limit = 3,
): ReportMetricRow[] => {
  const index = toPlayerActorIndex(masterData, playerDetails);
  const aggregates = new Map<string, PlayerMetricAggregate>();
  let firstSeen = 0;

  for (const row of rows) {
    if (!Number.isFinite(row.value)) continue;
    const metadata = resolvePlayerMetadata(row, index);
    if (!metadata) continue;
    addToMetric(aggregates, getStablePlayerKey(metadata), row.value, metadata, row, firstSeen);
    firstSeen += 1;
  }

  return getTopNFromAggregates(aggregates, limit);
};
