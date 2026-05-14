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
      zoneID: $zoneId
      difficulty: $difficulty
      size: $size
    )
  }
}`;

type RankPositions = { world?: number; region?: number; realm?: number };

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

const parseZoneRankingPayload = (payload: unknown): Pick<GuildOfficialRanks, 'progress'> => {
  const data = asObject((payload as { data?: unknown })?.data);
  const guild = asObject(asObject(data?.guildData)?.guild);
  const zoneRanking = asObject(guild?.zoneRanking);

  return {
    progress: parseRankPositions(zoneRanking?.progress),
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

const emptyOfficialRanks = (): GuildOfficialRanks => ({
  progress: {},
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
      size: input.size,
    };
    logger.info(
      { endpointMethod: 'GraphQL', authMode: getClientAuthMode(client), finalQueryParameters: variables },
      'guildrank official zone ranking lookup',
    );
    const payload = await client.request<Record<string, unknown>>(ZONE_RANKINGS_QUERY, variables);
    const parsed = parseZoneRankingPayload(payload);
    official = {
      ...official,
      progress: parsed.progress,
      source: hasRanks(parsed.progress) ? 'zoneRanking' : official.source,
      progressSource: hasRanks(parsed.progress) ? 'zoneRanking' : official.progressSource,
    };
    logger.info(
      {
        endpointMethod: 'GraphQL',
        authMode: getClientAuthMode(client),
        rawResultCount: hasRanks(parsed.progress) ? 1 : 0,
        parsedResultCount: Number(hasRanks(parsed.progress)),
        decision: hasRanks(parsed.progress) ? 'accepted' : 'empty zone ranking',
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

  return official;
};
