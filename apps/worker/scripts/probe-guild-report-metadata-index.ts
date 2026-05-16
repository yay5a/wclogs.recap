import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  connectMongo,
  MongoGuildReportMetadataStore,
  MongoReportIndexCacheStore,
  MongoReportRankingsStore,
} from '@wcl/db';
import { createLogger } from '@wcl/shared';
import { collectGuildReportIndex, resolveWclPublicClientAuth, WclClient } from '@wcl/wcl-client';
import {
  buildGuildRankReportWindows,
  type GuildRankReportWindow,
  type GuildRankReportWindowName,
} from '../src/guildrank-report-windows.js';
import { syncGuildReportMetadataIndex } from '../src/guild-report-metadata-sync.js';
import { syncReportRankingEnrichment } from '../src/report-ranking-enrichment-sync.js';

const DEFAULT_WCL_API_BASE_URL = 'https://www.warcraftlogs.com/api/v2/client';
type ProbeGameFamily = 'retail' | 'mop_classic';
const usage = [
  'Usage:',
  '  pnpm --filter @wcl/worker probe:guild-report-metadata-index <guildName> <serverSlug> <serverRegion> [gameFamily] [maxReports] [windowSizeMs] [--window=current|baseline|all|none] [--window-none] [--summary-only] [--enrich-rankings] [--force-rankings]',
  'Window:',
  '  current = current lockout, baseline = previous 14 calendar days, all/none = baseline + current.',
].join('\n');

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

const rawArgs = process.argv.slice(2);
const supportedFlags = new Set([
  '--summary-only',
  '--read-only-summary',
  '--enrich-rankings',
  '--force-rankings',
  '--window-none',
]);
const windowFlagPrefix = '--window=';
const isWindowFlag = (arg: string): boolean =>
  arg === '--window-none' || arg.startsWith(windowFlagPrefix);
const unknownFlag = rawArgs.find(
  (arg) => arg.startsWith('--') && !supportedFlags.has(arg) && !isWindowFlag(arg),
);
const summaryOnly = rawArgs.includes('--summary-only') || rawArgs.includes('--read-only-summary');
const shouldEnrichRankings = rawArgs.includes('--enrich-rankings') && !summaryOnly;
const forcedEnrichRefresh = rawArgs.includes('--force-rankings') && shouldEnrichRankings;
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('--'));
const [
  guildNameRaw,
  serverSlugRaw,
  serverRegionRaw,
  gameFamilyRaw,
  maxReportsRaw,
  windowSizeMsRaw,
] = positionalArgs;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const readRequiredString = (value: string | undefined, message: string): string => {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  return fail(message);
};

const parseGameFamily = (value: string | undefined): ProbeGameFamily => {
  if (value === undefined) return 'retail';
  if (value === 'retail' || value === 'mop_classic') return value;
  return fail('gameFamily must be retail or mop_classic when provided');
};

const resolveRankingPublicAuth = () => {
  try {
    return resolveWclPublicClientAuth({
      clientId: process.env.WCL_CLIENT_ID,
      clientSecret: process.env.WCL_CLIENT_SECRET,
      clientToken: process.env.WCL_OAUTH_CLIENT_TOKEN,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
};

if (unknownFlag) {
  fail(`Unknown option: ${unknownFlag}\n${usage}`);
}

const guildName = readRequiredString(guildNameRaw, usage);
const guildServerSlug = readRequiredString(serverSlugRaw, usage);
const guildServerRegion = readRequiredString(serverRegionRaw, usage);

const toInteger = (value: string, name: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail(`${name} must be an integer`);
  }
  return parsed;
};

const parseWindowOption = (): GuildRankReportWindowName | undefined => {
  const windowFlags = rawArgs.filter(isWindowFlag);
  if (windowFlags.length === 0) return undefined;
  if (windowFlags.length > 1) fail('Use only one window option');

  const flag = windowFlags[0] ?? fail('Use only one window option');
  if (flag === '--window-none') return 'all';

  const value = flag.slice(windowFlagPrefix.length).trim();
  if (value === 'none') return 'all';
  if (value === 'current' || value === 'baseline' || value === 'all') return value;
  return fail('window must be current, baseline, all, or none');
};

const formatWindowRange = (window: GuildRankReportWindow): string =>
  `${new Date(window.startTimeMs).toISOString()} - ${new Date(window.endTimeMs).toISOString()}`;

const promptForWindow = async (): Promise<GuildRankReportWindow> => {
  const windows = buildGuildRankReportWindows();
  const choices = [
    {
      key: '1',
      window: windows.current,
    },
    {
      key: '2',
      window: windows.baseline,
    },
  ];
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  console.error('Select report window:');
  for (const choice of choices) {
    console.error(`  ${choice.key}) ${choice.window.label}: ${formatWindowRange(choice.window)}`);
  }

  try {
    const answer = (await rl.question('Report window [1]: ')).trim() || '1';
    const selected =
      choices.find((choice) => choice.key === answer) ?? fail('Report window must be 1 or 2');
    return selected.window;
  } finally {
    rl.close();
  }
};

const windowOption = parseWindowOption();
const gameFamily = parseGameFamily(gameFamilyRaw);
const maxReports = maxReportsRaw ? toInteger(maxReportsRaw, 'maxReports') : undefined;
const windowSizeMs = windowSizeMsRaw ? toInteger(windowSizeMsRaw, 'windowSizeMs') : undefined;
const mongoUri = readRequiredString(process.env.MONGODB_URI, 'Missing MONGODB_URI');
const v1ClientKey = process.env.WCL_V1_CLIENT_KEY?.trim();

if (!summaryOnly && !v1ClientKey) fail('Missing WCL_V1_CLIENT_KEY');
if (maxReports !== undefined && maxReports < 1) fail('maxReports must be a positive integer');
if (windowSizeMs !== undefined && windowSizeMs < 1) fail('windowSizeMs must be a positive integer');

const rankingPublicAuth = shouldEnrichRankings ? resolveRankingPublicAuth() : undefined;
const window = windowOption ? buildGuildRankReportWindows()[windowOption] : await promptForWindow();
const logger = createLogger('worker');
const connection = await connectMongo(mongoUri);
const scope = {
  guildName,
  guildServerSlug,
  guildServerRegion,
  gameFamily,
};

const createRankingWclClient = (): WclClient => {
  const apiBaseUrl = process.env.WCL_API_BASE_URL?.trim() || DEFAULT_WCL_API_BASE_URL;
  const userApiBaseUrl = process.env.WCL_USER_API_BASE_URL?.trim();

  return new WclClient({
    publicClientAuth: rankingPublicAuth ?? fail('Missing WCL public client auth'),
    apiBaseUrl,
    ...(userApiBaseUrl ? { userApiBaseUrl } : {}),
    ...(v1ClientKey ? { v1ClientKey } : {}),
    reportIndexCacheStore: new MongoReportIndexCacheStore(),
  });
};

try {
  console.error(`Using ${window.label}: ${formatWindowRange(window)}`);

  if (summaryOnly) {
    console.error('Summary only: skipping WCL sync');
  }
  if (rawArgs.includes('--enrich-rankings') && summaryOnly) {
    console.error('Summary only: skipping ranking enrichment');
  }

  const store = new MongoGuildReportMetadataStore();
  const sync = summaryOnly
    ? undefined
    : await syncGuildReportMetadataIndex({
        wclClient: {
          fetchGuildReportIndex: (input) =>
            collectGuildReportIndex({
              ...input,
              v1ClientKey: v1ClientKey ?? fail('Missing WCL_V1_CLIENT_KEY'),
            }),
        },
        store,
        ...scope,
        startTimeMs: window.startTimeMs,
        endTimeMs: window.endTimeMs,
        ...(maxReports !== undefined ? { maxReports } : {}),
        ...(windowSizeMs !== undefined ? { windowSizeMs } : {}),
        logger,
      });
  const summary = await store.summarizeReports({
    scope,
    startTimeMs: window.startTimeMs,
    endTimeMs: window.endTimeMs,
  });
  const rankingEnrichment = shouldEnrichRankings
    ? await syncReportRankingEnrichment({
        wclClient: createRankingWclClient(),
        store: new MongoReportRankingsStore(),
        scope,
        reports: summary.raidNights.map((night) => ({
          reportCode: night.canonicalReport.reportCode,
          startTime: night.canonicalReport.startTime,
        })),
        ...(maxReports !== undefined ? { maxReports } : {}),
        ...(forcedEnrichRefresh ? { staleAfterMs: 0 } : {}),
        logger,
      })
    : undefined;

  console.log(
    JSON.stringify(
      summaryOnly
        ? { summaryOnly, summary }
        : { sync, ...(rankingEnrichment ? { rankingEnrichment } : {}), summary },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.disconnect();
}
