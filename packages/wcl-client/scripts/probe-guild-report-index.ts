import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { collectGuildReportIndex } from '../src/collectors/guild-report-index-collector.js';

const RESET_WEEK_START_DAY = 2; // Tuesday
const usage = [
  'Usage:',
  '  pnpm --filter @wcl/wcl-client probe:guild-report-index <guildName> <serverSlug> <serverRegion> [gameFamily] [windowSizeMs]',
  '  pnpm --filter @wcl/wcl-client probe:guild-report-index <guildName> <serverSlug> <serverRegion> <startTimeMs> <endTimeMs> [gameFamily] [windowSizeMs]',
].join('\n');

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

const [
  guildNameRaw,
  serverSlugRaw,
  serverRegionRaw,
  fourthArg,
  fifthArg,
  sixthArg,
  seventhArg,
] = process.argv.slice(2);

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (!guildNameRaw || !serverSlugRaw || !serverRegionRaw) {
  fail(usage);
}

const isIntegerString = (value: string | undefined): value is string => /^-?\d+$/.test(value ?? '');

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

const promptForWindow = async (): Promise<{ startTimeMs: number; endTimeMs: number; label: string }> => {
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
    if (!selected) {
      fail('Report window must be 1 or 2');
    }
    return selected;
  } finally {
    rl.close();
  }
};

const hasExplicitRange = isIntegerString(fourthArg) && isIntegerString(fifthArg);
if (isIntegerString(fourthArg) && !fifthArg) {
  fail('startTimeMs requires endTimeMs');
}

const gameFamilyRaw = hasExplicitRange ? sixthArg : fourthArg;
const windowSizeMsRaw = hasExplicitRange ? seventhArg : fifthArg;
const gameFamily =
  gameFamilyRaw === undefined || gameFamilyRaw === 'retail' || gameFamilyRaw === 'mop_classic'
    ? gameFamilyRaw
    : fail('gameFamily must be retail or mop_classic when provided');
const windowSizeMs = windowSizeMsRaw ? toInteger(windowSizeMsRaw, 'windowSizeMs') : undefined;
const v1ClientKey = process.env.WCL_V1_CLIENT_KEY;

if (!v1ClientKey) {
  fail('Missing WCL_V1_CLIENT_KEY');
}

const window = hasExplicitRange
  ? {
      startTimeMs: toInteger(fourthArg, 'startTimeMs'),
      endTimeMs: toInteger(fifthArg, 'endTimeMs'),
      label: 'Explicit range',
    }
  : await promptForWindow();

if (window.startTimeMs > window.endTimeMs) {
  fail('startTimeMs must be before endTimeMs');
}

if (windowSizeMs !== undefined && windowSizeMs < 1) {
  fail('windowSizeMs must be a positive integer');
}

try {
  console.error(
    `Using ${window.label}: ${new Date(window.startTimeMs).toISOString()} - ${new Date(
      window.endTimeMs,
    ).toISOString()}`,
  );

  const result = await collectGuildReportIndex({
    guildName: guildNameRaw.trim(),
    guildServerSlug: serverSlugRaw,
    guildServerRegion: serverRegionRaw,
    ...(gameFamily ? { gameFamily } : {}),
    startTimeMs: window.startTimeMs,
    endTimeMs: window.endTimeMs,
    ...(windowSizeMs !== undefined ? { windowSizeMs } : {}),
    v1ClientKey,
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
