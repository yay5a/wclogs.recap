import {
  connectMongo,
  migrateCharacterClaimIdentityFields,
  MongoAutoReportDuplicateTrackingStore,
  MongoAutoReportPromptStateStore,
  MongoCharacterClaimStore,
  MongoDashboardActivityStore,
  MongoDashboardOnboardingStore,
  MongoGuildConfigStore,
  MongoGuildReportMetadataStore,
  MongoReportIndexCacheStore,
  MongoReportRankingsStore,
  MongoWclUserAuthStore,
  migrateReportRankingsPartitionIndexes,
  migrateWclUserAuthDiscordUserIndex,
} from '@wcl/db';
import { createLogger } from '@wcl/shared';
import {
  WclClient,
  type GuildRankReportMetadataReader,
  type GuildRankReportMetadataRow,
} from '@wcl/wcl-client';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createWebApp } from './app.js';
import { parseWebEnv } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, '../../../.env');

if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const env = parseWebEnv(process.env);
const logger = createLogger('web');

class GuildRankMongoMetadataReader implements GuildRankReportMetadataReader {
  public constructor(private readonly store: MongoGuildReportMetadataStore) {}

  public async summarizeReports(
    input: Parameters<GuildRankReportMetadataReader['summarizeReports']>[0],
  ): Promise<GuildRankReportMetadataRow[]> {
    const summary = await this.store.summarizeReports({
      scope: {
        guildName: input.guildName,
        guildServerSlug: input.guildServerSlug,
        guildServerRegion: input.guildServerRegion,
        gameFamily: input.gameFamily,
      },
      startTimeMs: input.startTimeMs,
      endTimeMs: input.endTimeMs,
      ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
    });

    return summary.raidNights.flatMap((raidNight) =>
      raidNight.reports.map((report) => ({
        reportCode: report.reportCode,
        ...(report.title ? { title: report.title } : {}),
        ...(report.owner ? { owner: report.owner } : {}),
        ...(typeof report.zoneId === 'number' ? { zoneId: report.zoneId } : {}),
        startTime: report.startTime,
        ...(typeof report.endTime === 'number' ? { endTime: report.endTime } : {}),
        raidNightKey: String(raidNight.startTime),
      })),
    );
  }
}

const wclUserAuthStore = new MongoWclUserAuthStore({
  encryptionKey: env.WCL_TOKEN_ENCRYPTION_KEY,
});
const reportIndexCacheStore = new MongoReportIndexCacheStore();
const guildReportMetadataStore = new MongoGuildReportMetadataStore();
const reportRankingsStore = new MongoReportRankingsStore();

const wclClient = new WclClient({
  publicClientAuth: env.wclPublicClientAuth,
  apiBaseUrl: env.WCL_API_BASE_URL,
  ...(env.WCL_USER_API_BASE_URL ? { userApiBaseUrl: env.WCL_USER_API_BASE_URL } : {}),
  ...(env.WCL_V1_CLIENT_KEY ? { v1ClientKey: env.WCL_V1_CLIENT_KEY } : {}),
  wclUserAuthStore,
  reportIndexCacheStore,
  guildReportMetadataStore: new GuildRankMongoMetadataReader(guildReportMetadataStore),
  guildRankTrendReader: reportRankingsStore,
});

const guildConfigStore = new MongoGuildConfigStore();
const autoReportPromptStateService = new MongoAutoReportPromptStateStore();
const autoReportDuplicateTrackingService = new MongoAutoReportDuplicateTrackingStore();
const characterClaimStore = new MongoCharacterClaimStore();
const dashboardActivityStore = new MongoDashboardActivityStore();
const dashboardOnboardingStore = new MongoDashboardOnboardingStore();
const dashboardAssetRootCandidates = [
  resolve(__dirname, '../../client'),
  resolve(__dirname, '../dist/client'),
  resolve(__dirname, '../client'),
] as const;
const dashboardAssetRoot =
  dashboardAssetRootCandidates.find((candidate) => existsSync(resolve(candidate, 'index.html'))) ??
  dashboardAssetRootCandidates[0];

const app = await createWebApp({
  env,
  logger,
  wclClient,
  guildConfigStore,
  dashboardGuildConfigStore: guildConfigStore,
  dashboardCharacterClaimStore: characterClaimStore,
  dashboardActivityStore,
  dashboardOnboardingStore,
  autoReportPromptStateService,
  autoReportDuplicateTrackingService,
  characterClaimStore,
  wclUserAuthStore,
  dashboardStatic: {
    enabled: existsSync(resolve(dashboardAssetRoot, 'index.html')),
    assetRoot: dashboardAssetRoot,
  },
});

const start = async () => {
  await connectMongo(env.MONGODB_URI);
  await migrateCharacterClaimIdentityFields();
  await migrateWclUserAuthDiscordUserIndex();
  await migrateReportRankingsPartitionIndexes();
  await app.listen({ port: env.PORT, host: '127.0.0.1' });
  logger.info({ port: env.PORT }, 'web app started');
};

start().catch((error) => {
  logger.fatal({ error }, 'web app failed to start');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  logger.info('received SIGTERM');
  await app.close();
  process.exit(0);
});
