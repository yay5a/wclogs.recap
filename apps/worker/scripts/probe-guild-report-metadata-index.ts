import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { connectMongo, MongoGuildReportMetadataStore } from '@wcl/db';
import { createLogger } from '@wcl/shared';
import { collectGuildReportIndex } from '@wcl/wcl-client';
import { syncGuildReportMetadataIndex } from '../src/guild-report-metadata-sync.js';

const RESET_WEEK_START_DAY = 2; // Tuesday
const usage = [
  'Usage:',
  '  pnpm --filter @wcl/worker probe:guild-report-metadata-index <guildName> <serverSlug> <serverRegion> [gameFamily] [maxReports] [windowSizeMs] [--summary-only]',
].join('\n');

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

const rawArgs = process.argv.slice(2);
const supportedFlags = new Set(['--summary-only', '--read-only-summary']);
const unknownFlag = rawArgs.find((arg) => arg.startsWith('--') && !supportedFlags.has(arg));
const summaryOnly = rawArgs.includes('--summary-only') || rawArgs.includes('--read-only-summary');
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

if (unknownFlag) {
  fail(`Unknown option: ${unknownFlag}\n${usage}`);
}

if (!guildNameRaw || !serverSlugRaw || !serverRegionRaw) {
  fail(usage);
}

const toInteger = (value: string, name: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail(`${name} must be an integer`);
  }
  return parsed;
};

const getMostRecentResetStart = (now: Date): Date => {
  const resetStart = new Date(now);
  resetStart.setHours(0, 0, 0, 0);
  resetStart.setDate(resetStart.getDate() - ((resetStart.getDay() - RESET_WEEK_START_DAY + 7) % 7));
  return resetStart;
};

const subtractLocalDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
};

const promptForWindow = async (): Promise<{
  startTimeMs: number;
  endTimeMs: number;
  label: string;
}> => {
  const now = new Date();
  const currentResetStart = getMostRecentResetStart(now);
  const previousResetStart = subtractLocalDays(currentResetStart, 7);
  const choices = [
    {
      key: '1',
      label: 'Current reset week',
      startTimeMs: currentResetStart.getTime(),
      endTimeMs: now.getTime(),
    },
    {
      key: '2',
      label: 'Last two reset weeks',
      startTimeMs: previousResetStart.getTime(),
      endTimeMs: now.getTime(),
    },
  ];
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  console.error('Select report window:');
  for (const choice of choices) {
    console.error(
      `  ${choice.key}) ${choice.label}: ${new Date(choice.startTimeMs).toISOString()} - ${new Date(
        choice.endTimeMs,
      ).toISOString()}`,
    );
  }

  try {
    const answer = (await rl.question('Report window [1]: ')).trim() || '1';
    const selected = choices.find((choice) => choice.key === answer);
    if (!selected) fail('Report window must be 1 or 2');
    return selected;
  } finally {
    rl.close();
  }
};

const gameFamily =
  gameFamilyRaw === undefined || gameFamilyRaw === 'retail' || gameFamilyRaw === 'mop_classic'
    ? gameFamilyRaw
    : fail('gameFamily must be retail or mop_classic when provided');
const maxReports = maxReportsRaw ? toInteger(maxReportsRaw, 'maxReports') : undefined;
const windowSizeMs = windowSizeMsRaw ? toInteger(windowSizeMsRaw, 'windowSizeMs') : undefined;
const mongoUri = process.env.MONGODB_URI;
const v1ClientKey = process.env.WCL_V1_CLIENT_KEY;

if (!mongoUri) fail('Missing MONGODB_URI');
if (!summaryOnly && !v1ClientKey) fail('Missing WCL_V1_CLIENT_KEY');
if (maxReports !== undefined && maxReports < 1) fail('maxReports must be a positive integer');
if (windowSizeMs !== undefined && windowSizeMs < 1) fail('windowSizeMs must be a positive integer');

const window = await promptForWindow();
const logger = createLogger('worker');
const connection = await connectMongo(mongoUri);
const scope = {
  guildName: guildNameRaw.trim(),
  guildServerSlug: serverSlugRaw,
  guildServerRegion: serverRegionRaw,
  gameFamily: gameFamily ?? 'retail',
};

try {
  console.error(
    `Using ${window.label}: ${new Date(window.startTimeMs).toISOString()} - ${new Date(
      window.endTimeMs,
    ).toISOString()}`,
  );

  if (summaryOnly) {
    console.error('Summary only: skipping WCL sync');
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

  console.log(JSON.stringify(summaryOnly ? { summaryOnly, summary } : { sync, summary }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection.disconnect();
}
