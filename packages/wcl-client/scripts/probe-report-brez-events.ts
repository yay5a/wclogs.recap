import type { GameFamily } from '@wcl/domain';
import { WclGraphqlClient } from '../src/graphql-client.js';
import { resolveWclPublicClientAuth } from '../src/auth-mode.js';
import { parseReportUrl } from '../src/report-code.js';
import { collectReportIndex } from '../src/collectors/report-index-collector.js';

const toProbeApiBaseUrl = (apiBaseUrl: string, gameFamily: GameFamily): string => {
  if (gameFamily !== 'mop_classic') return apiBaseUrl;

  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname === 'www.warcraftlogs.com') {
      url.hostname = 'classic.warcraftlogs.com';
      return url.toString();
    }
  } catch {
    return apiBaseUrl;
  }

  return apiBaseUrl;
};

const [reportInput] = process.argv.slice(2);

if (!reportInput) {
  console.error(
    'Usage: pnpm --filter @wcl/wcl-client exec tsx scripts/probe-report-brez-events.ts <reportUrl>',
  );
  process.exit(1);
}

const trimmedReportInput = reportInput.trim();

const parsed = /^[A-Za-z0-9]+$/.test(trimmedReportInput)
  ? { reportCode: trimmedReportInput, gameFamily: 'retail' as const, rawUrl: trimmedReportInput }
  : parseReportUrl(trimmedReportInput);

const clientId = process.env.WCL_CLIENT_ID;
const clientSecret = process.env.WCL_CLIENT_SECRET;
const clientToken = process.env.WCL_OAUTH_CLIENT_TOKEN;
const defaultApiUrl = process.env.WCL_API_BASE_URL ?? 'https://www.warcraftlogs.com/api/v2/client';
const apiBaseUrl = toProbeApiBaseUrl(defaultApiUrl, parsed.gameFamily);

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

const index = await collectReportIndex(client, {
  sourceUrl: parsed.rawUrl,
  reportCode: parsed.reportCode,
  gameFamily: parsed.gameFamily,
});

console.log(index.completedBossFights.map((fight) => fight.id).join('\n'));

console.log({
  reportCode: parsed.reportCode,
  gameFamily: parsed.gameFamily,
  apiBaseUrl,
});
