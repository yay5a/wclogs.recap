import type { WclGraphqlClient } from '../graphql-client.js';
import { asNumber, asObject, parseUnknownJson } from '../parsers/common.js';
import type { GuildOfficialRanks } from '../pipeline/types.js';

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

const parseRankNode = (value: unknown): number | undefined =>
  asNumber(asObject(value)?.number);

const parseZoneRankingsPayload = (payload: unknown): GuildOfficialRanks | undefined => {
  const data = asObject((payload as { data?: unknown })?.data);
  const guild = asObject(asObject(data?.guildData)?.guild);
  const zoneRankings = asObject(guild?.zoneRankings);
  const progress = asObject(zoneRankings?.progress);
  const speed = asObject(zoneRankings?.speed);

  const progressWorld = parseRankNode(progress?.worldRank);
  const progressRegion = parseRankNode(progress?.regionRank);
  const progressRealm = parseRankNode(progress?.serverRank);
  const speedWorld = parseRankNode(speed?.worldRank);
  const speedRegion = parseRankNode(speed?.regionRank);
  const speedRealm = parseRankNode(speed?.serverRank);

  if (
    typeof progressWorld !== 'number' &&
    typeof progressRegion !== 'number' &&
    typeof progressRealm !== 'number' &&
    typeof speedWorld !== 'number' &&
    typeof speedRegion !== 'number' &&
    typeof speedRealm !== 'number'
  ) {
    return undefined;
  }

  return {
    progress: {
      ...(typeof progressWorld === 'number' ? { world: progressWorld } : {}),
      ...(typeof progressRegion === 'number' ? { region: progressRegion } : {}),
      ...(typeof progressRealm === 'number' ? { realm: progressRealm } : {}),
    },
    speed: {
      ...(typeof speedWorld === 'number' ? { world: speedWorld } : {}),
      ...(typeof speedRegion === 'number' ? { region: speedRegion } : {}),
      ...(typeof speedRealm === 'number' ? { realm: speedRealm } : {}),
    },
    source: 'zoneRankings',
  };
};

const findNumberByPathHints = (value: unknown): { world?: number; region?: number; realm?: number } => {
  const root = parseUnknownJson(value, () => undefined, 'progressRace');
  const stack: unknown[] = [root];
  const result: { world?: number; region?: number; realm?: number } = {};

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

export const collectOfficialGuildZoneRankings = async (
  client: WclGraphqlClient,
  input: {
    guildName: string;
    guildServerSlug: string;
    guildServerRegion: string;
    zoneId: number;
    difficulty: number;
    size: number;
  },
): Promise<GuildOfficialRanks> => {
  try {
    const payload = await client.request<Record<string, unknown>>(ZONE_RANKINGS_QUERY, {
      guildName: input.guildName,
      guildServerSlug: input.guildServerSlug,
      guildServerRegion: input.guildServerRegion,
      zoneId: input.zoneId,
      difficulty: input.difficulty,
      size: input.size,
    });

    const parsed = parseZoneRankingsPayload(payload);
    if (parsed) return parsed;
  } catch {
    // fall through
  }

  try {
    const payload = await client.request<Record<string, unknown>>(PROGRESS_RACE_QUERY, {
      guildName: input.guildName,
      guildServerSlug: input.guildServerSlug,
      guildServerRegion: input.guildServerRegion,
      zoneId: input.zoneId,
      difficulty: input.difficulty,
      size: input.size,
    });

    const rawRace = asObject((payload as { data?: unknown })?.data)?.progressRaceData;
    const race = asObject(rawRace)?.progressRace;
    const parsed = findNumberByPathHints(race);

    if (
      typeof parsed.world === 'number' ||
      typeof parsed.region === 'number' ||
      typeof parsed.realm === 'number'
    ) {
      return {
        progress: {
          ...(typeof parsed.world === 'number' ? { world: parsed.world } : {}),
          ...(typeof parsed.region === 'number' ? { region: parsed.region } : {}),
          ...(typeof parsed.realm === 'number' ? { realm: parsed.realm } : {}),
        },
        speed: {},
        source: 'progressRaceData',
      };
    }
  } catch {
    // ignore
  }

  return { progress: {}, speed: {}, source: 'unavailable' };
};
