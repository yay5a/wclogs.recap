import {
  connectMongo,
  migrateCharacterClaimIdentityFields,
  MongoAutoReportDuplicateTrackingStore,
  MongoAutoReportPromptStateStore,
  MongoCharacterClaimStore,
  MongoComparisonHistoryStore,
  MongoDashboardActivityStore,
  MongoDashboardOnboardingStore,
  MongoGuildConfigStore,
  MongoWclUserAuthStore,
  migrateWclUserAuthDiscordUserIndex,
} from '@wcl/db';
import { createLogger } from '@wcl/shared';
import { WclClient } from '@wcl/wcl-client';
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

const wclUserAuthStore = new MongoWclUserAuthStore({
  encryptionKey: env.WCL_TOKEN_ENCRYPTION_KEY,
});

const wclClient = new WclClient({
  clientId: env.WCL_CLIENT_ID,
  clientSecret: env.WCL_CLIENT_SECRET,
  apiBaseUrl: env.WCL_API_BASE_URL,
  ...(env.WCL_USER_API_BASE_URL ? { userApiBaseUrl: env.WCL_USER_API_BASE_URL } : {}),
  wclUserAuthStore,
});

const guildConfigStore = new MongoGuildConfigStore();
const autoReportPromptStateService = new MongoAutoReportPromptStateStore();
const autoReportDuplicateTrackingService = new MongoAutoReportDuplicateTrackingStore();
const comparisonHistoryStore = new MongoComparisonHistoryStore();
const characterClaimStore = new MongoCharacterClaimStore();
const dashboardActivityStore = new MongoDashboardActivityStore();
const dashboardOnboardingStore = new MongoDashboardOnboardingStore();
const dashboardAssetRootCandidates = [
  resolve(__dirname, '../../../../client'),
  resolve(__dirname, '../dist/client'),
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
  comparisonHistoryStore,
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
