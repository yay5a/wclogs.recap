import { WclGraphqlClient } from '../src/graphql-client.js';
import { resolveWclPublicClientAuth } from '../src/auth-mode.js';

const [guildNameRaw, serverSlugRaw, serverRegionRaw, zoneIdRaw, difficultyRaw, sizeRaw, gameFamilyRaw] =
  process.argv.slice(2);

if (!guildNameRaw || !serverSlugRaw || !serverRegionRaw || !zoneIdRaw || !difficultyRaw || !sizeRaw) {
  console.error(
    'Usage: pnpm --filter @wcl/wcl-client probe:guildrank-schema <guildName> <serverSlug> <serverRegion> <zoneId> <difficulty> <size> [gameFamily]',
  );
  process.exit(1);
}

const normalizeServerSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const toGameFamilyApiBaseUrl = (baseUrl: string, gameFamily?: 'retail' | 'mop_classic'): string => {
  if (gameFamily !== 'mop_classic') return baseUrl;
  const url = new URL(baseUrl);
  if (url.hostname === 'www.warcraftlogs.com') {
    url.hostname = 'classic.warcraftlogs.com';
  }
  return url.toString();
};

const zoneId = Number.parseInt(zoneIdRaw, 10);
const difficulty = Number.parseInt(difficultyRaw, 10);
const size = Number.parseInt(sizeRaw, 10);
const gameFamily = gameFamilyRaw === 'retail' || gameFamilyRaw === 'mop_classic' ? gameFamilyRaw : undefined;

if (!Number.isFinite(zoneId) || !Number.isFinite(difficulty) || !Number.isFinite(size)) {
  console.error('zoneId, difficulty and size must be numbers');
  process.exit(1);
}

if (gameFamilyRaw && !gameFamily) {
  console.error('gameFamily must be retail or mop_classic when provided');
  process.exit(1);
}

const guildName = guildNameRaw.trim();
const serverSlug = normalizeServerSlug(serverSlugRaw);
const serverRegion = serverRegionRaw.trim().toUpperCase();
const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const clientToken = process.env.WCL_OAUTH_CLIENT_TOKEN;
const apiBaseUrl = toGameFamilyApiBaseUrl(
  process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client',
  gameFamily,
);

let publicClientAuth;
try {
  publicClientAuth = resolveWclPublicClientAuth({ clientId, clientSecret, clientToken });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Missing WCL public client auth');
  process.exit(1);
}

const client = new WclGraphqlClient({
  publicClientAuth,
  apiBaseUrl,
});

// Diagnostic only: intentionally requests percentile to confirm guild ranks return null.
const query = /* GraphQL */ `
  query ProbeGuildRankSchema(
    $guildName: String!
    $serverSlug: String!
    $serverRegion: String!
    $zoneId: Int!
    $difficulty: Int!
    $size: Int!
  ) {
    guildData {
      guild(name: $guildName, serverSlug: $serverSlug, serverRegion: $serverRegion) {
        id
        name
        zoneRanking(zoneId: $zoneId) {
          progress(size: $size) {
            worldRank {
              number
              percentile
              color
            }
            regionRank {
              number
              percentile
              color
            }
            serverRank {
              number
              percentile
              color
            }
          }
          speed(size: $size, difficulty: $difficulty) {
            worldRank {
              number
              percentile
              color
            }
            regionRank {
              number
              percentile
              color
            }
            serverRank {
              number
              percentile
              color
            }
          }
          completeRaidSpeed(size: $size, difficulty: $difficulty) {
            worldRank {
              number
              percentile
              color
            }
            regionRank {
              number
              percentile
              color
            }
            serverRank {
              number
              percentile
              color
            }
          }
        }
      }
    }
  }
`;

const response = await client.request<Record<string, unknown>>(query, {
  guildName,
  serverSlug,
  serverRegion,
  zoneId,
  difficulty,
  size,
});

if ((response as { data?: { guildData?: { guild?: unknown } } }).data?.guildData?.guild === null) {
  console.error(
    `WCL returned null for guild=${guildName}, serverSlug=${serverSlug}, serverRegion=${serverRegion}, apiBaseUrl=${apiBaseUrl}.`,
  );
}

console.log(JSON.stringify(response, null, 2));
