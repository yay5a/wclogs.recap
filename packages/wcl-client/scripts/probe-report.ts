import { WclClient } from '../src/wcl-client.js';

const [url] = process.argv.slice(2);
if (!url) {
  console.error('Usage: pnpm --filter @wcl/wcl-client probe:report <reportUrl>');
  process.exit(1);
}

const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const apiBaseUrl = process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client';

if (!clientId || !clientSecret) {
  console.error('Missing WCL_CLIENT_ID or WCL_CLIENT_SECRET');
  process.exit(1);
}

const client = new WclClient({
  clientId,
  clientSecret,
  apiBaseUrl,
});

const summary = await client.fetchReportSummary(url);
console.log(JSON.stringify(summary, null, 2));
