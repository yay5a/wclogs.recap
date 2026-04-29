import Fastify from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import fastifyCookie from '@fastify/cookie';
import {
  connectMongo,
  MongoComparisonHistoryStore,
  MongoGuildConfigStore,
  MongoRecapPreviewStateStore,
  MongoWclUserAuthStore,
  ReportCacheModel,
} from '@wcl/db';
import { createLogger } from '@wcl/shared';
import { WclClient, type ReportCacheStore } from '@wcl/wcl-client';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseWebEnv } from './config.js';
import { registerWclAuthRoutes } from './auth/routes.js';
import { registerRecapRoutes } from './routes/recap.js';
import { registerDiscordInteractionRoutes } from './routes/discord-interactions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, '../../../.env');

if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const env = parseWebEnv(process.env);
const logger = createLogger('web');
const app = Fastify({ logger: false });

const reportCacheStore: ReportCacheStore = {
  async getByReportCode(reportCode: string) {
    return ReportCacheModel.findOne({ reportCode }).lean();
  },
  async upsert(entry) {
    await ReportCacheModel.findOneAndUpdate({ reportCode: entry.reportCode }, entry, {
      upsert: true,
    });
  },
};

await app.register(fastifyRawBody, {
  field: 'rawBody',
  global: false,
  encoding: 'utf8',
  runFirst: true,
});

await app.register(fastifyCookie, {
  secret: env.COOKIE_SECRET,
});

const wclClient = new WclClient({
  clientId: env.WCL_CLIENT_ID,
  clientSecret: env.WCL_CLIENT_SECRET,
  apiBaseUrl: env.WCL_API_BASE_URL,
  reportCacheStore,
});

const guildConfigStore = new MongoGuildConfigStore();
const recapPreviewStateService = new MongoRecapPreviewStateStore();
const comparisonHistoryStore = new MongoComparisonHistoryStore();
const wclUserAuthStore = new MongoWclUserAuthStore();

app.get('/health', async () => ({ status: 'ok' }));

await app.register(registerWclAuthRoutes, {
  env,
  logger,
  wclUserAuthStore,
});

await app.register(registerRecapRoutes, {
  wclClient,
  logger,
});

await app.register(registerDiscordInteractionRoutes, {
  env,
  wclClient,
  guildConfigStore,
  recapPreviewStateService,
  comparisonHistoryStore,
  logger,
});

const start = async () => {
  await connectMongo(env.MONGODB_URI);
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
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
