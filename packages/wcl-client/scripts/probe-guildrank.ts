import { WclClient } from '../src/wcl-client.js';

const [guildName, serverSlug, serverRegion, zoneIdRaw, difficulty, size, gameFamily] = process.argv.slice(2);
if (!guildName || !serverSlug || !serverRegion || !zoneIdRaw || !difficulty || !size) {
  console.error(
    'Usage: pnpm --filter @wcl/wcl-client probe:guildrank <guildName> <serverSlug> <serverRegion> <zoneId> <difficulty> <size> [gameFamily]',
  );
  process.exit(1);
}

const zoneId = Number.parseInt(zoneIdRaw, 10);
if (!Number.isFinite(zoneId)) {
  console.error('zoneId must be a number');
  process.exit(1);
}

const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const apiBaseUrl = process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client';
const userApiBaseUrl = process.env.WCL_USER_API_BASE_URL;
const probeUserToken = process.env.WCL_OAUTH_TOKEN;

if (!clientId || !clientSecret) {
  console.error('Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET');
  process.exit(1);
}

const client = new WclClient({
  clientId,
  clientSecret,
  apiBaseUrl,
  ...(userApiBaseUrl ? { userApiBaseUrl } : {}),
  ...(probeUserToken
    ? {
        wclUserAuthStore: {
          getByDiscordUserId: async () => ({ discordUserId: 'probe', accessToken: probeUserToken }),
        },
      }
    : {}),
});

const summary = await client.fetchGuildRankSummary({
  guildName,
  guildServerSlug: serverSlug,
  guildServerRegion: serverRegion,
  zoneId,
  difficulty,
  size,
  ...(gameFamily === 'retail' || gameFamily === 'mop_classic' ? { gameFamily } : {}),
}, probeUserToken ? { discordUserId: 'probe' } : undefined);

console.log(JSON.stringify(summary, null, 2));
