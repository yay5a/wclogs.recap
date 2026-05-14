import { createLogger, serializeError } from '@wcl/shared';
import type { WclGraphqlClient } from '../graphql-client.js';
import { asArray, asNumber, asObject, asString, parseUnknownJson } from '../parsers/common.js';
import type { GuildOfficialRanks, GuildRankEncounterMetric, GuildRankMetricSet } from '../pipeline/types.js';

const logger = createLogger('wcl-client');

const getClientAuthMode = (client: WclGraphqlClient): string =>
  typeof (client as { getAuthModeKind?: unknown }).getAuthModeKind === 'function'
    ? (client as { getAuthModeKind: () => string }).getAuthModeKind()
    : 'unknown';

const ZONE_RANKINGS_QUERY = `
query GuildZoneRanks(
  $guildName: String!
  $guildServerSlug: String!
  $guildServerRegion: String!
  $zoneId: Int!
  $difficulty: Int!
  $size: Int!
) {
  guildData {
    guild(name: $guildName, serverSlug: $guildServerSlug, serverRegion: $guildServerRegion) {
      zoneRankings(zoneID: $zoneId) {
        progress(size: $size) {
          worldRank { number }
          regionRank { number }
          serverRank { number }
        }
        speed(size: $size, difficulty: $difficulty) {
          worldRank { number }
          regionRank { number }
          serverRank { number }
        }
        completeRaidSpeed(size: $size, difficulty: $difficulty) {
          worldRank { number }
          regionRank { number }
          serverRank { number }
        }
      }
    }
  }
}`;

const ENCOUNTER_FIGHT_RANKINGS_QUERY = `
query OfficialGuildEncounterRankings(
  $encounterId: Int!
  $difficulty: Int!
  $size: Int!
  $partition: Int
  $serverSlug: String!
  $serverRegion: String!
  $metric: FightRankingMetricType!
) {
  worldData {
    encounter(id: $encounterId) {
      id
      name
      fightRankings(
        difficulty: $difficulty
        size: $size
        partition: $partition
        serverSlug: $serverSlug
        serverRegion: $serverRegion
        metric: $metric
        leaderboard: LogsOnly
      )
    }
  }
}`;

const PROGRESS_RACE_QUERY = `
query ProgressRaceFallback(
  $guildName: String!
  $guildServerSlug: String!
  $guildServerRegion: String!
  $zoneId: Int!
  $difficulty: Int!
  $size: Int!
) {
  progressRaceData {
    progressRace(
      guildName: $guildName
      serverSlug: $guildServerSlug
      serverRegion: $guildServerRegion
      zoneID: $zoneId
      difficulty: $difficulty
      size: $size
    )
  }
}`;

type RankPositions = { world?: number; region?: number; realm?: number };
type FightRankingMetric = 'speed' | 'execution';

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[middle - 1];
    const right = sorted[middle];
    if (typeof left !== 'number' || typeof right !== 'number') return undefined;
    return (left + right) / 2;
  }
  const value = sorted[middle];
  return typeof value === 'number' ? value : undefined;
};

const normalizeServerSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const normalizeRegion = (value: string): string => value.trim().toUpperCase();

const parseRankNode = (value: unknown): number | undefined =>
  asNumber(asObject(value)?.number);

const hasRanks = (ranks: RankPositions): boolean =>
  typeof ranks.world === 'number' || typeof ranks.region === 'number' || typeof ranks.realm === 'number';

const parseRankPositions = (value: unknown): RankPositions => {
  const row = asObject(value);
  const world = parseRankNode(row?.worldRank);
  const region = parseRankNode(row?.regionRank);
  const realm = parseRankNode(row?.serverRank);
  return {
    ...(typeof world === 'number' ? { world } : {}),
    ...(typeof region === 'number' ? { region } : {}),
    ...(typeof realm === 'number' ? { realm } : {}),
  };
};

const parseZoneRankingsPayload = (payload: unknown): Pick<GuildOfficialRanks, 'progress' | 'speed'> => {
  const data = asObject((payload as { data?: unknown })?.data);
  const guild = asObject(asObject(data?.guildData)?.guild);
  const zoneRankings = asObject(guild?.zoneRankings);
  const progress = parseRankPositions(zoneRankings?.progress);
  const speed = parseRankPositions(zoneRankings?.speed);
  const completeRaidSpeed = parseRankPositions(zoneRankings?.completeRaidSpeed);

  return {
    progress,
    speed: hasRanks(speed) ? speed : completeRaidSpeed,
  };
};

const findNumberByPathHints = (value: unknown): RankPositions => {
  const root = parseUnknownJson(value, () => undefined, 'progressRace');
  const stack: unknown[] = [root];
  const result: RankPositions = {};

  while (stack.length > 0) {
    const current = stack.pop();
    const row = asObject(current);
    if (!row) continue;

    for (const [key, child] of Object.entries(row)) {
      const lower = key.toLowerCase();
      const numberValue = asNumber(child);
      if (typeof numberValue === 'number') {
        if (typeof result.world !== 'number' && lower.includes('world') && lower.includes('rank')) {
          result.world = numberValue;
        }
        if (typeof result.region !== 'number' && lower.includes('region') && lower.includes('rank')) {
          result.region = numberValue;
        }
        if (
          typeof result.realm !== 'number' &&
          ((lower.includes('server') || lower.includes('realm')) && lower.includes('rank'))
        ) {
          result.realm = numberValue;
        }
      }

      if (typeof child === 'object' && child !== null) {
        stack.push(child);
      }
    }
  }

  return result;
};

const findRankingRows = (value: unknown): unknown[] => {
  const root = parseUnknownJson(value, () => value, 'fightRankings');
  if (Array.isArray(root)) return root;

  const rootObject = asObject(root);
  const directRows = asArray(rootObject?.rankings ?? rootObject?.data ?? rootObject?.entries);
  if (directRows) return directRows;

  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    const row = asObject(current);
    if (!row) continue;

    for (const child of Object.values(row)) {
      const childRows = asArray(child);
      if (childRows?.some((entry) => typeof entry === 'object' && entry !== null)) {
        return childRows;
      }
      if (typeof child === 'object' && child !== null) {
        stack.push(child);
      }
    }
  }

  return [];
};

const normalizeName = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const readFirstString = (row: Record<string, unknown>, paths: string[][]): string | undefined => {
  for (const path of paths) {
    let current: unknown = row;
    for (const segment of path) {
      current = asObject(current)?.[segment];
    }
    const value = asString(current);
    if (value) return value;
  }
  return undefined;
};

const rowMatchesGuild = (
  row: Record<string, unknown>,
  target: { guildName: string; guildServerSlug: string; guildServerRegion: string },
): boolean => {
  const rowGuildName = readFirstString(row, [
    ['guild', 'name'],
    ['guildName'],
    ['guild', 'guildName'],
    ['name'],
  ]);
  if (!rowGuildName || normalizeName(rowGuildName) !== normalizeName(target.guildName)) return false;

  const rowServerSlug = readFirstString(row, [
    ['server', 'slug'],
    ['serverSlug'],
    ['guild', 'server', 'slug'],
    ['guild', 'serverSlug'],
  ]);
  if (rowServerSlug && normalizeServerSlug(rowServerSlug) !== target.guildServerSlug) return false;

  const rowRegion = readFirstString(row, [
    ['server', 'region', 'name'],
    ['server', 'region', 'slug'],
    ['serverRegion'],
    ['guild', 'server', 'region', 'name'],
    ['guild', 'serverRegion'],
  ]);
  if (rowRegion && normalizeRegion(rowRegion) !== target.guildServerRegion) return false;

  return true;
};

const collectPercentValues = (value: unknown): number[] => {
  const stack: unknown[] = [value];
  const values: number[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    const row = asObject(current);
    if (!row) continue;

    for (const [key, child] of Object.entries(row)) {
      const numberValue = asNumber(child);
      if (typeof numberValue === 'number' && key.toLowerCase().includes('percent') && numberValue >= 0 && numberValue <= 100) {
        values.push(numberValue);
      }
      if (typeof child === 'object' && child !== null) stack.push(child);
    }
  }

  return values;
};

const parseFightRankingsMetric = (
  payload: unknown,
  target: { guildName: string; guildServerSlug: string; guildServerRegion: string; encounterName: string },
): { metric?: GuildRankEncounterMetric; rawCount: number; parsedCount: number; reason: string } => {
  const data = asObject((payload as { data?: unknown })?.data);
  const encounter = asObject(asObject(data?.worldData)?.encounter);
  const rows = findRankingRows(encounter?.fightRankings);
  const percentiles = rows.flatMap((value) => {
    const row = asObject(value);
    if (!row || !rowMatchesGuild(row, target)) return [];
    return collectPercentValues(row);
  });

  if (percentiles.length === 0) {
    return { rawCount: rows.length, parsedCount: 0, reason: 'no matching guild percentile rows' };
  }

  const medianPercentile = median(percentiles);
  return {
    rawCount: rows.length,
    parsedCount: percentiles.length,
    reason: 'accepted',
    metric: {
      encounterName: target.encounterName,
      bestPercentile: Math.max(...percentiles),
      ...(typeof medianPercentile === 'number' ? { medianPercentile } : {}),
    },
  };
};

const collectFightRankingMetrics = async (
  client: WclGraphqlClient,
  input: {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    difficulty: number;
    size: number;
    partition?: number;
    encounters: Array<{ id: number; name: string }>;
    metric: FightRankingMetric;
  },
): Promise<GuildRankMetricSet | undefined> => {
  const perEncounter: GuildRankEncounterMetric[] = [];
  const baseVariables = {
    difficulty: input.difficulty,
    size: input.size,
    ...(typeof input.partition === 'number' ? { partition: input.partition } : { partition: null }),
    serverSlug: input.guildServerSlug,
    serverRegion: input.guildServerRegion,
    metric: input.metric,
  };

  for (const encounter of input.encounters) {
    const variables = { ...baseVariables, encounterId: encounter.id };
    try {
      logger.info(
        {
          endpointMethod: 'GraphQL',
          authMode: getClientAuthMode(client),
          metric: input.metric,
          finalQueryParameters: variables,
        },
        'guildrank official ranking lookup',
      );
      const payload = await client.request<Record<string, unknown>>(ENCOUNTER_FIGHT_RANKINGS_QUERY, variables);
      const parsed = parseFightRankingsMetric(payload, {
        guildName: input.guildName,
        guildServerSlug: input.guildServerSlug,
        guildServerRegion: input.guildServerRegion,
        encounterName: encounter.name,
      });
      logger.info(
        {
          endpointMethod: 'GraphQL',
          authMode: getClientAuthMode(client),
          metric: input.metric,
          encounterId: encounter.id,
          rawResultCount: parsed.rawCount,
          parsedResultCount: parsed.parsedCount,
          decision: parsed.reason,
        },
        'guildrank official ranking result',
      );
      if (parsed.metric) perEncounter.push(parsed.metric);
    } catch (error) {
      logger.info(
        {
          endpointMethod: 'GraphQL',
          authMode: getClientAuthMode(client),
          metric: input.metric,
          finalQueryParameters: variables,
          error: serializeError(error),
          rawResultCount: 0,
          parsedResultCount: 0,
          decision: 'request failed',
        },
        'guildrank official ranking lookup failed',
      );
    }
  }

  if (perEncounter.length === 0) return undefined;

  const overallBestPercentile = median(
    perEncounter.flatMap((row) => (typeof row.bestPercentile === 'number' ? [row.bestPercentile] : [])),
  );
  const overallMedianPercentile = median(
    perEncounter.flatMap((row) => (typeof row.medianPercentile === 'number' ? [row.medianPercentile] : [])),
  );

  return {
    ...(typeof overallBestPercentile === 'number' ? { overallBestPercentile } : {}),
    ...(typeof overallMedianPercentile === 'number' ? { overallMedianPercentile } : {}),
    perEncounter,
  };
};

const emptyOfficialRanks = (): GuildOfficialRanks => ({
  progress: {},
  speed: {},
  source: 'unavailable',
  progressSource: 'unavailable',
  speedSource: 'unavailable',
  executionSource: 'unavailable',
});

export const collectOfficialGuildZoneRankings = async (
  client: WclGraphqlClient,
  input: {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    zoneId: number;
    difficulty: number;
    size: number;
    partition?: number;
    encounters?: Array<{ id: number; name: string }>;
  },
): Promise<GuildOfficialRanks> => {
  const guildServerSlug = normalizeServerSlug(input.guildServerSlug);
  const guildServerRegion = normalizeRegion(input.guildServerRegion);
  let official = emptyOfficialRanks();

  try {
    const variables = {
      guildName: input.guildName,
      guildServerSlug,
      guildServerRegion,
      zoneId: input.zoneId,
      difficulty: input.difficulty,
      size: input.size,
    };
    logger.info(
      { endpointMethod: 'GraphQL', authMode: getClientAuthMode(client), finalQueryParameters: variables },
      'guildrank official zone ranking lookup',
    );
    const payload = await client.request<Record<string, unknown>>(ZONE_RANKINGS_QUERY, variables);
    const parsed = parseZoneRankingsPayload(payload);
    official = {
      ...official,
      progress: parsed.progress,
      speed: parsed.speed,
      source: hasRanks(parsed.progress) || hasRanks(parsed.speed) ? 'zoneRankings' : official.source,
      progressSource: hasRanks(parsed.progress) ? 'zoneRankings' : official.progressSource,
      speedSource: hasRanks(parsed.speed) ? 'zoneRankings' : official.speedSource,
    };
    logger.info(
      {
        endpointMethod: 'GraphQL',
        authMode: getClientAuthMode(client),
        rawResultCount: hasRanks(parsed.progress) || hasRanks(parsed.speed) ? 1 : 0,
        parsedResultCount: Number(hasRanks(parsed.progress)) + Number(hasRanks(parsed.speed)),
        decision: hasRanks(parsed.progress) || hasRanks(parsed.speed) ? 'accepted' : 'empty zone rankings',
      },
      'guildrank official zone ranking result',
    );
  } catch (error) {
    logger.info(
      {
        endpointMethod: 'GraphQL',
        authMode: getClientAuthMode(client),
        error: serializeError(error),
        rawResultCount: 0,
        parsedResultCount: 0,
        decision: 'request failed',
      },
      'guildrank official zone ranking lookup failed',
    );
  }

  if (!hasRanks(official.progress)) {
    try {
      const variables = {
        guildName: input.guildName,
        guildServerSlug,
        guildServerRegion,
        zoneId: input.zoneId,
        difficulty: input.difficulty,
        size: input.size,
      };
      const payload = await client.request<Record<string, unknown>>(PROGRESS_RACE_QUERY, variables);
      const rawRace = asObject((payload as { data?: unknown })?.data)?.progressRaceData;
      const race = asObject(rawRace)?.progressRace;
      const parsed = findNumberByPathHints(race);

      if (hasRanks(parsed)) {
        official = {
          ...official,
          progress: parsed,
          source: official.source === 'unavailable' ? 'progressRaceData' : official.source,
          progressSource: 'progressRaceData',
        };
      }
    } catch (error) {
      logger.info(
        { endpointMethod: 'GraphQL', authMode: getClientAuthMode(client), error: serializeError(error) },
        'guildrank official progress race lookup failed',
      );
    }
  }

  const encounterInput = input.encounters ?? [];
  if (encounterInput.length > 0) {
    const speedMetrics = await collectFightRankingMetrics(client, {
      guildName: input.guildName,
      guildServerSlug,
      guildServerRegion,
      difficulty: input.difficulty,
      size: input.size,
      ...(typeof input.partition === 'number' ? { partition: input.partition } : {}),
      encounters: encounterInput,
      metric: 'speed',
    });
    if (speedMetrics) {
      official = {
        ...official,
        speedMetrics,
        source: official.source === 'unavailable' ? 'fightRankings' : official.source,
        speedSource: 'fightRankings',
      };
    }

    const executionMetrics = await collectFightRankingMetrics(client, {
      guildName: input.guildName,
      guildServerSlug,
      guildServerRegion,
      difficulty: input.difficulty,
      size: input.size,
      ...(typeof input.partition === 'number' ? { partition: input.partition } : {}),
      encounters: encounterInput,
      metric: 'execution',
    });
    if (executionMetrics) {
      official = {
        ...official,
        executionMetrics,
        source: official.source === 'unavailable' ? 'fightRankings' : official.source,
        executionSource: 'fightRankings',
      };
    }
  }

  return official;
};
