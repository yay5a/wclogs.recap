import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  connectMongo,
  type GuildEncounterWeeklyTrendRow,
  MongoReportRankingsStore,
} from '@wcl/db';

type ProbeGameFamily = 'retail' | 'mop_classic';

const usage = [
  'Usage:',
  '  pnpm --filter @wcl/worker probe:guild-encounter-trends <guildName> <serverSlug> <serverRegion> [gameFamily]',
].join('\n');

for (const envPath of ['.env', '../../.env'].map((path) => resolve(process.cwd(), path))) {
  if (existsSync(envPath)) {
    process.loadEnvFile?.(envPath);
    break;
  }
}

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

const [guildNameRaw, serverSlugRaw, serverRegionRaw, gameFamilyRaw] = process.argv.slice(2);
const guildName = readRequiredString(guildNameRaw, usage);
const guildServerSlug = readRequiredString(serverSlugRaw, usage);
const guildServerRegion = readRequiredString(serverRegionRaw, usage);
const gameFamily = parseGameFamily(gameFamilyRaw);
const mongoUri = readRequiredString(process.env.MONGODB_URI, 'Missing MONGODB_URI');
const scope = {
  guildName,
  guildServerSlug,
  guildServerRegion,
  gameFamily,
};

const toJsonTrend = (trend: GuildEncounterWeeklyTrendRow) => ({
  encounterId: trend.encounterId,
  difficulty: trend.difficulty,
  size: trend.size,
  ...(typeof trend.partition === 'number' ? { partition: trend.partition } : {}),
  weekStart: trend.weekStart.toISOString(),
  timeframe: trend.timeframe,
  compareMode: trend.compareMode,
  sampleCount: trend.sampleCount,
  ...(typeof trend.speedMedian === 'number' ? { speedMedian: trend.speedMedian } : {}),
  ...(typeof trend.speedP90 === 'number' ? { speedP90: trend.speedP90 } : {}),
  ...(typeof trend.speedMedianDelta === 'number'
    ? { speedMedianDelta: trend.speedMedianDelta }
    : {}),
  ...(typeof trend.executionMedian === 'number'
    ? { executionMedian: trend.executionMedian }
    : {}),
  ...(typeof trend.executionP90 === 'number' ? { executionP90: trend.executionP90 } : {}),
  ...(typeof trend.executionMedianDelta === 'number'
    ? { executionMedianDelta: trend.executionMedianDelta }
    : {}),
});

const connection = await connectMongo(mongoUri);

try {
  const trends = await new MongoReportRankingsStore().listWeeklyTrends({ scope });
  console.log(
    JSON.stringify(
      {
        scope,
        rowCount: trends.length,
        trends: trends.map(toJsonTrend),
      },
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
