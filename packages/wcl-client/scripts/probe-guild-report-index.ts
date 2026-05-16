import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { collectGuildReportIndex } from '../src/collectors/guild-report-index-collector.js';

const RESET_WEEK_START_DAY = 2; // Tuesday
const usage = [
  'Usage:',
  '  pnpm --filter @wcl/wcl-client probe:guild-report-index <guildName> <serverSlug> <serverRegion> [gameFamily] [windowSizeMs] [--window-none]',
  '  pnpm --filter @wcl/wcl-client probe:guild-report-index <guildName> <serverSlug> <serverRegion> <startTimeMs> <endTimeMs> [gameFamily] [windowSizeMs]',
  'Window:',
  '  --window-none skips the prompt and uses current lockout plus the previous 14 calendar days.',
].join('\n');

type ProbeWindow = {
  startTimeMs: number;
  endTimeMs: number;
  label: string;
};

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

const rawArgs = process.argv.slice(2);
const windowNone = rawArgs.includes('--window-none');
const unknownFlag = rawArgs.find((arg) => arg.startsWith('--') && arg !== '--window-none');
const positionalArgs = rawArgs.filter((arg) => !arg.startsWith('--'));
const [guildNameArg, serverSlugArg, serverRegionArg, fourthArg, fifthArg, sixthArg, seventhArg] =
  positionalArgs;

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (unknownFlag) {
  fail(`Unknown option: ${unknownFlag}\n${usage}`);
}

const isIntegerString = (value: string | undefined): value is string => /^-?\d+$/.test(value ?? '');

const requireCliArg = (value: string | undefined): string => {
  return value || fail(usage);
};

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

const buildProbeWindows = (): {
  current: ProbeWindow;
  baseline: ProbeWindow;
  all: ProbeWindow;
} => {
  const now = new Date();
  const currentResetStart = getMostRecentResetStart(now);
  const baselineStart = subtractLocalDays(currentResetStart, 14);

  return {
    current: {
      label: 'Current lockout',
      startTimeMs: currentResetStart.getTime(),
      endTimeMs: now.getTime(),
    },
    baseline: {
      label: 'Previous 14 calendar days',
      startTimeMs: baselineStart.getTime(),
      endTimeMs: currentResetStart.getTime() - 1,
    },
    all: {
      label: 'Current lockout + previous 14 calendar days',
      startTimeMs: baselineStart.getTime(),
      endTimeMs: now.getTime(),
    },
  };
};

const formatWindowRange = (window: ProbeWindow): string =>
  `${new Date(window.startTimeMs).toISOString()} - ${new Date(window.endTimeMs).toISOString()}`;

const promptForWindow = async (): Promise<ProbeWindow> => {
  const windows = buildProbeWindows();
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
    const choice =
      choices.find((item) => item.key === answer) ?? fail('Report window must be 1 or 2');
    return choice.window;
  } finally {
    rl.close();
  }
};

const hasExplicitRange = isIntegerString(fourthArg) && isIntegerString(fifthArg);
if (isIntegerString(fourthArg) && !fifthArg) {
  fail('startTimeMs requires endTimeMs');
}
if (hasExplicitRange && windowNone) {
  fail('--window-none cannot be used with explicit startTimeMs/endTimeMs');
}

const guildNameRaw = requireCliArg(guildNameArg);
const serverSlugRaw = requireCliArg(serverSlugArg);
const serverRegionRaw = requireCliArg(serverRegionArg);
const gameFamilyRaw = hasExplicitRange ? sixthArg : fourthArg;
const windowSizeMsRaw = hasExplicitRange ? seventhArg : fifthArg;
const gameFamily =
  gameFamilyRaw === undefined || gameFamilyRaw === 'retail' || gameFamilyRaw === 'mop_classic'
    ? gameFamilyRaw
    : fail('gameFamily must be retail or mop_classic when provided');
const windowSizeMs = windowSizeMsRaw ? toInteger(windowSizeMsRaw, 'windowSizeMs') : undefined;
const v1ClientKey = process.env.WCL_V1_CLIENT_KEY ?? fail('Missing WCL_V1_CLIENT_KEY');

const window = hasExplicitRange
  ? {
      startTimeMs: toInteger(fourthArg, 'startTimeMs'),
      endTimeMs: toInteger(fifthArg, 'endTimeMs'),
      label: 'Explicit range',
    }
  : windowNone
    ? buildProbeWindows().all
  : await promptForWindow();

if (window.startTimeMs > window.endTimeMs) {
  fail('startTimeMs must be before endTimeMs');
}

if (windowSizeMs !== undefined && windowSizeMs < 1) {
  fail('windowSizeMs must be a positive integer');
}

try {
  console.error(`Using ${window.label}: ${formatWindowRange(window)}`);

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
