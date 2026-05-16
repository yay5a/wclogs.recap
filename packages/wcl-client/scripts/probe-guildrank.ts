import { WclClient } from '../src/wcl-client.js';
import { resolveWclPublicClientAuth } from '../src/auth-mode.js';

const [
  guildName,
  serverSlug,
  serverRegion,
  zoneIdRaw,
  difficulty,
  size,
  gameFamilyOrPartition,
  partitionArg,
] = process.argv.slice(2);
if (!guildName || !serverSlug || !serverRegion || !zoneIdRaw || !difficulty || !size) {
  console.error(
    'Usage: pnpm --filter @wcl/wcl-client probe:guildrank <guildName> <serverSlug> <serverRegion> <zoneId> <difficulty> <size> [gameFamily] [partition]',
  );
  process.exit(1);
}

const zoneId = Number.parseInt(zoneIdRaw, 10);
if (!Number.isFinite(zoneId)) {
  console.error('zoneId must be a number');
  process.exit(1);
}

const parsePartition = (value: string | undefined): 'all' | number | undefined => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'current') return undefined;
  if (normalized === 'all') return 'all';

  const partition = Number(normalized);
  if (Number.isSafeInteger(partition) && partition > 0) return partition;
  console.error('partition must be current, all, or a positive number');
  process.exit(1);
};

const gameFamily =
  gameFamilyOrPartition === 'retail' || gameFamilyOrPartition === 'mop_classic'
    ? gameFamilyOrPartition
    : undefined;
const partition = parsePartition(gameFamily ? partitionArg : gameFamilyOrPartition);
const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const clientToken = process.env.WCL_OAUTH_CLIENT_TOKEN;
const apiBaseUrl = process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client';
const userApiBaseUrl = process.env.WCL_USER_API_BASE_URL;

let publicClientAuth;
try {
  publicClientAuth = resolveWclPublicClientAuth({ clientId, clientSecret, clientToken });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Missing WCL public client auth');
  process.exit(1);
}

const client = new WclClient({
  publicClientAuth,
  apiBaseUrl,
  ...(userApiBaseUrl ? { userApiBaseUrl } : {}),
});

const summary = await client.fetchGuildRankSummary({
  guildName,
  guildServerSlug: serverSlug,
  guildServerRegion: serverRegion,
  zoneId,
  difficulty,
  size,
  ...(gameFamily ? { gameFamily } : {}),
  ...(partition !== undefined ? { partition } : {}),
});

console.log(JSON.stringify(summary, null, 2));
