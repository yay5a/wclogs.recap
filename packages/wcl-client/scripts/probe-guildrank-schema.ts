import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WclGraphqlClient } from '../src/graphql-client.js';
import { resolveWclPublicClientAuth } from '../src/auth-mode.js';
import { parseGuildRankSchemaProbeArgs } from '../src/probes/guildrank-schema-probe-cli.js';

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

const parsedArgs = parseGuildRankSchemaProbeArgs(process.argv.slice(2));
if (!parsedArgs.ok) {
  console.error(parsedArgs.message);
  process.exit(1);
}

const { guildNameRaw, serverSlugRaw, serverRegionRaw, zoneId, difficulty, size, gameFamily } =
  parsedArgs.value;

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

console.error(
  [
    'guildrank schema probe',
    `endpoint=${apiBaseUrl}`,
    `guild=${guildName}`,
    `server=${serverSlug}`,
    `region=${serverRegion}`,
    `zone=${zoneId}`,
    `difficulty=${difficulty}`,
    `size=${size}`,
    `gameFamily=${gameFamily ?? 'retail'}`,
  ].join(' '),
);

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
  zoneId: zoneId,
  difficulty,
  size,
});

if ((response as { data?: { guildData?: { guild?: unknown } } }).data?.guildData?.guild === null) {
  console.error(
    `WCL returned null for guild=${guildName}, serverSlug=${serverSlug}, serverRegion=${serverRegion}, apiBaseUrl=${apiBaseUrl}.`,
  );
}

console.log(JSON.stringify(response, null, 2));
