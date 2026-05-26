import { asNumber, asObject, asString } from './common.js';

/* Parse actorID to player's name */
export type BrezActor = {
  id?: number;
  name: string;
};

/* Shape for successful actorID -> player names */
export type BrezPlayerName = {
  id: number;
  name: string;
};

/* Count players casting and receiving most brezes */
export type BrezCountPlayers = BrezPlayerName & {
  count: number;
};

/* Match brez by resurrection event + latest earlier death */
export type BrezMatch = {
  caster: BrezPlayerName;
  receiver: BrezPlayerName;
  fightID: number;
  deathTimestamp: string;
  resurrectTimestamp: string;
  responseSec: number;
};

/* Reusable summary for collectors/renderer */
export type BrezSummary = {
  topCasters: BrezCountPlayers[];
  topReceivers: BrezCountPlayers[];
  fastest?: BrezMatch;
};

/* Small brez event shape */
type ParsedBrezEvent = {
  type: string;
  timestamp: number;
  fight: number;
  targetID: number;
  sourceID?: number;
};

const formatReportTimestamp = (timestampMs: number): string => {
  const totalSeconds = Math.floor(timestampMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':');
};

export const parseBrezSummary = (events: unknown[], actors: BrezActor[]): BrezSummary => {
  const playerNameById = buildPlayerNameById(actors);

  const parsedEvents = events.flatMap((event) => {
    const parsedEvent = toParsedBrezEvent(event);
    return parsedEvent ? [parsedEvent] : [];
  });

  const deathRows = parsedEvents.filter((event) => event.type === 'death');

  const resurrectRows = parsedEvents.filter((event) => event.type === 'resurrect');

  const deathsByFightAndTarget = new Map<string, ParsedBrezEvent[]>();

  for (const death of deathRows) {
    const key = deathKey(death);
    const existingDeaths = deathsByFightAndTarget.get(key);

    if (existingDeaths) {
      existingDeaths.push(death);
    } else {
      deathsByFightAndTarget.set(key, [death]);
    }
  }

  const casterCounts = new Map<number, BrezCountPlayers>();
  const receiverCounts = new Map<number, BrezCountPlayers>();
  let fastest: BrezMatch | undefined;

  for (const resurrect of resurrectRows) {
    if (typeof resurrect.sourceID !== 'number') continue;
    const casterName = playerNameById.get(resurrect.sourceID);
    const receiverName = playerNameById.get(resurrect.targetID);
    if (!casterName || !receiverName) continue;
    const deaths = deathsByFightAndTarget.get(deathKey(resurrect)) ?? [];
    const latestDeath = findLatestEarlierDeath(deaths, resurrect.timestamp);

    if (!latestDeath) continue;
    const responseMs = resurrect.timestamp - latestDeath.timestamp;

    const match: BrezMatch = {
      caster: {
        id: resurrect.sourceID,
        name: casterName,
      },
      receiver: {
        id: resurrect.targetID,
        name: receiverName,
      },
      fightID: resurrect.fight,
      deathTimestamp: formatReportTimestamp(latestDeath.timestamp),
      resurrectTimestamp: formatReportTimestamp(resurrect.timestamp),
      responseSec: responseMs / 1000,
    };
    incrementPlayerCount(casterCounts, match.caster);
    incrementPlayerCount(receiverCounts, match.receiver);

    if (!fastest || match.responseSec < fastest.responseSec) {
      fastest = match;
    }
  }

  return {
    topCasters: getTopPlayers(casterCounts),
    topReceivers: getTopPlayers(receiverCounts),
    ...(fastest ? { fastest } : {}),
  };
};

const toParsedBrezEvent = (event: unknown): ParsedBrezEvent | undefined => {
  const row = asObject(event);
  if (!row) return undefined;

  const type = asString(row.type);
  const timestamp = asNumber(row.timestamp);
  const fight = asNumber(row.fight);
  const targetID = asNumber(row.targetID);

  if (
    !type ||
    typeof timestamp !== 'number' ||
    typeof fight !== 'number' ||
    typeof targetID !== 'number'
  ) {
    return undefined;
  }

  const sourceID = asNumber(row.sourceID);

  return {
    type,
    timestamp,
    fight,
    targetID,
    ...(typeof sourceID === 'number' ? { sourceID } : {}),
  };
};
const buildPlayerNameById = (actors: BrezActor[]): Map<number, string> => {
  const playerNameById = new Map<number, string>();

  for (const actor of actors) {
    if (typeof actor.id !== 'number') continue;
    const name = actor.name.trim();
    if (!name) continue;
    playerNameById.set(actor.id, name);
  }
  return playerNameById;
};

const deathKey = (event: Pick<ParsedBrezEvent, 'fight' | 'targetID'>): string =>
  `${event.fight}:${event.targetID}`;

const findLatestEarlierDeath = (
  deaths: ParsedBrezEvent[],
  resurrectTimestamp: number,
): ParsedBrezEvent | undefined => {
  let latestDeath: ParsedBrezEvent | undefined;

  for (const death of deaths) {
    if (death.timestamp >= resurrectTimestamp) continue;
    if (!latestDeath || death.timestamp > latestDeath.timestamp) {
      latestDeath = death;
    }
  }
  return latestDeath;
};

const incrementPlayerCount = (
  counts: Map<number, BrezCountPlayers>,
  player: BrezPlayerName,
): void => {
  const existing = counts.get(player.id);

  if (existing) {
    existing.count += 1;
    return;
  }

  counts.set(player.id, {
    ...player,
    count: 1,
  });
};

const getTopPlayers = (counts: Map<number, BrezCountPlayers>): BrezCountPlayers[] =>
  [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.id - b.id)
    .slice(0, 3);
