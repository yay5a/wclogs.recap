import { createLogger, serializeError } from '@wcl/shared';
import type { WclGraphqlClient } from '../graphql-client.js';
import { asNumber, asObject, parseUnknownJson } from '../parsers/common.js';
import type { GuildOfficialRanks } from '../pipeline/types.js';

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
      zoneRanking(zoneId: $zoneId) {
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
      zoneId: $zoneId
      difficulty: $difficulty
      size: $size
    )
  }
}`;

type RankPositions = { world?: number; region?: number; realm?: number };

const normalizeRegion = (value: string): string => value.trim().toUpperCase();

const parseRankNode = (value: unknown): number | undefined => asNumber(asObject(value)?.number);

const parseRankValue = (value: unknown): number | undefined =>
  asNumber(value) ?? parseRankNode(value);

const hasRanks = (ranks: RankPositions): boolean =>
  typeof ranks.world === 'number' ||
  typeof ranks.region === 'number' ||
  typeof ranks.realm === 'number';

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

const parseZoneRankingsPayload = (
  payload: unknown,
): Pick<GuildOfficialRanks, 'progress' | 'speed' | 'completeRaidSpeed'> => {
  const data = asObject((payload as { data?: unknown })?.data);
  const guild = asObject(asObject(data?.guildData)?.guild);
  const zoneRanking = asObject(guild?.zoneRanking);

  return {
    progress: parseRankPositions(zoneRanking?.progress),
    speed: parseRankPositions(zoneRanking?.speed),
    completeRaidSpeed: parseRankPositions(zoneRanking?.completeRaidSpeed),
  };
};

const parseProgressRacePayload = (payload: unknown): RankPositions => {
  const data = asObject((payload as { data?: unknown })?.data);
  const raceData = asObject(data?.progressRaceData);
  const race = asObject(parseUnknownJson(raceData?.progressRace, () => undefined, 'progressRace'));
  const world = parseRankValue(race?.worldRank);
  const region = parseRankValue(race?.regionRank);
  const realm = parseRankValue(race?.serverRank);

  return {
    ...(typeof world === 'number' ? { world } : {}),
    ...(typeof region === 'number' ? { region } : {}),
    ...(typeof realm === 'number' ? { realm } : {}),
  };
};

const emptyOfficialRanks = (): GuildOfficialRanks => ({
  progress: {},
  speed: {},
  completeRaidSpeed: {},
  source: 'unavailable',
  progressSource: 'unavailable',
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
  const guildServerSlug = input.guildServerSlug;
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
      {
        endpointMethod: 'GraphQL',
        authMode: getClientAuthMode(client),
        finalQueryParameters: variables,
      },
      'guildrank official zone ranking lookup',
    );
    const payload = await client.request<Record<string, unknown>>(ZONE_RANKINGS_QUERY, variables);
    const parsed = parseZoneRankingsPayload(payload);
    const hasAnyRanks =
      hasRanks(parsed.progress) || hasRanks(parsed.speed) || hasRanks(parsed.completeRaidSpeed);
    official = {
      ...official,
      progress: parsed.progress,
      speed: parsed.speed,
      completeRaidSpeed: parsed.completeRaidSpeed,
      source: hasAnyRanks ? 'zoneRanking' : official.source,
      progressSource: hasRanks(parsed.progress) ? 'zoneRanking' : official.progressSource,
    };
    logger.info(
      {
        endpointMethod: 'GraphQL',
        authMode: getClientAuthMode(client),
        rawResultCount: hasAnyRanks ? 1 : 0,
        parsedResultCount: Number(hasAnyRanks),
        decision: hasAnyRanks ? 'accepted' : 'empty zone rankings',
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
      const progress = parseProgressRacePayload(payload);
      const hasProgressRanks = hasRanks(progress);
      if (hasProgressRanks) {
        official = {
          ...official,
          progress,
          source: official.source === 'unavailable' ? 'progressRaceData' : official.source,
          progressSource: 'progressRaceData',
        };
      }
      logger.info(
        {
          endpointMethod: 'GraphQL',
          authMode: getClientAuthMode(client),
          rawResultCount: hasProgressRanks ? 1 : 0,
          parsedResultCount: Number(hasProgressRanks),
          decision: hasProgressRanks ? 'accepted' : 'empty progress race rankings',
        },
        'guildrank official progress race result',
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
        'guildrank official progress race lookup failed',
      );
    }
  }

  return official;
};
