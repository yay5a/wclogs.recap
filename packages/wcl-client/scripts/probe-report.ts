import { WclClient } from '../src/wcl-client.js';
import { resolveWclPublicClientAuth } from '../src/auth-mode.js';

const [url] = process.argv.slice(2);
if (!url) {
  console.error('Usage: pnpm --filter @wcl/wcl-client probe:report <reportUrl>');
  process.exit(1);
}

const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const clientToken = process.env.WCL_OAUTH_CLIENT_TOKEN;
const apiBaseUrl = process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client';

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
});

const summary = await client.fetchReportSummary(url);
console.log(JSON.stringify(summary, null, 2));
