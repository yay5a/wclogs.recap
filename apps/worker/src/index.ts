import {
  MongoAutoReportDuplicateTrackingStore,
  MongoAutoReportPromptStateStore,
  MongoDashboardActivityStore,
  MongoGuildConfigStore,
  MongoReportIndexCacheStore,
  MongoWclUserAuthStore,
  connectMongo,
  migrateCharacterClaimIdentityFields,
  migrateWclUserAuthDiscordUserIndex,
} from '@wcl/db';
import type { AutoReportSendableChannel } from '@wcl/discord';
import { REPORT_RUNTIME_FINGERPRINT, handleAutoReportMessageCreate } from '@wcl/discord';
import { createLogger } from '@wcl/shared';
import { WclClient } from '@wcl/wcl-client';
import { ChannelType, Client, Events, GatewayIntentBits, type Guild } from 'discord.js';
import { parseWorkerEnv } from './config.js';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, '../../../.env');

if (existsSync(envPath)) {
  loadEnvFile(envPath);
}

const env = parseWorkerEnv(process.env);
const logger = createLogger('worker');
const SAFE_ALLOWED_MENTIONS = { parse: [] as string[] };
const WORKER_PACKAGE_ID = '@wcl/worker@0.1.0';
const WORKER_APP_IDENTIFIER = 'worker-gateway';

const resolveRuntimeModule = (specifier: string): string | undefined => {
  try {
    return import.meta.resolve(specifier);
  } catch {
    return undefined;
  }
};

const guildConfigStore = new MongoGuildConfigStore();
const autoReportPromptStateService = new MongoAutoReportPromptStateStore();
const autoReportDuplicateTrackingService = new MongoAutoReportDuplicateTrackingStore();
const dashboardActivityStore = new MongoDashboardActivityStore();
const wclUserAuthStore = new MongoWclUserAuthStore({
  encryptionKey: env.WCL_TOKEN_ENCRYPTION_KEY,
});
const reportIndexCacheStore = new MongoReportIndexCacheStore();

const wclClient = new WclClient({
  publicClientAuth: env.wclPublicClientAuth,
  apiBaseUrl: env.WCL_API_BASE_URL,
  ...(env.WCL_USER_API_BASE_URL ? { userApiBaseUrl: env.WCL_USER_API_BASE_URL } : {}),
  ...(env.WCL_V1_CLIENT_KEY ? { v1ClientKey: env.WCL_V1_CLIENT_KEY } : {}),
  wclUserAuthStore,
  reportIndexCacheStore,
});

class InMemoryFailureThrottle {
  private readonly entries = new Map<string, number>();

  public shouldPostFailure(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const existingExpiresAt = this.entries.get(key);
    if (existingExpiresAt && existingExpiresAt > now) return false;
    this.entries.set(key, now + ttlMs);
    for (const [entryKey, expiresAt] of this.entries.entries()) {
      if (expiresAt <= now) this.entries.delete(entryKey);
    }
    return true;
  }
}

const failureThrottle = new InMemoryFailureThrottle();

type DiscordSendableChannel = {
  type?: ChannelType;
  send(body: Record<string, unknown>): Promise<{ id: string }>;
  isSendable?: () => boolean;
};

const isDiscordSendableTextChannel = (value: unknown): value is DiscordSendableChannel => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DiscordSendableChannel>;
  const type = candidate.type;
  const isTextType = type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement;
  const sendable = typeof candidate.isSendable === 'function' ? candidate.isSendable() : true;
  return isTextType && sendable && typeof candidate.send === 'function';
};

const toAutoReportChannel = (channel: unknown): AutoReportSendableChannel | null => {
  if (!isDiscordSendableTextChannel(channel)) return null;
  return {
    send: async (body: Record<string, unknown>) => {
      const sent = await channel.send(body);
      return { id: sent.id };
    },
  };
};

const sendGuildCreateNotice = async (guild: Guild): Promise<void> => {
  const content = [
    'Thanks for adding **wclogs.report**.',
    '',
    'Run `/config` to check setup status.',
    '',
    'To enable passive Warcraft Logs detection, run:',
    '`/config auto_report_channel:#raid-logs`',
    '',
    'You can also use `/report <wcl_report_url>` anytime.',
  ].join('\n');

  const channel =
    toAutoReportChannel(guild.systemChannel) ??
    toAutoReportChannel(
      guild.channels.cache.find((candidate) => isDiscordSendableTextChannel(candidate)),
    );
  if (!channel) {
    logger.info(
      { guildId: guild.id },
      'guildCreate setup notice skipped; no sendable text channel',
    );
    return;
  }
  try {
    await channel.send({ content, allowed_mentions: SAFE_ALLOWED_MENTIONS });
  } catch (error) {
    logger.warn({ guildId: guild.id, error }, 'guildCreate setup notice failed');
  }
};

const startDiscordGateway = async (): Promise<Client> => {
  logger.info(
    {
      intents: ['Guilds', 'GuildMessages', 'MessageContent'],
      cwd: process.cwd(),
      packageId: WORKER_PACKAGE_ID,
      workerAppIdentifier: WORKER_APP_IDENTIFIER,
      reportRuntimeFingerprint: REPORT_RUNTIME_FINGERPRINT,
      reportPath: 'gateway-startup',
      publicBodySent: false,
      discordModuleResolved: resolveRuntimeModule('@wcl/discord'),
    },
    'starting Discord Gateway; MessageContent intent requested',
  );
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
  client.on(Events.MessageCreate, (message) => {
    void handleAutoReportMessageCreate({
      message: {
        guildId: message.guildId,
        channelId: message.channelId,
        messageId: message.id,
        authorId: message.author.id,
        authorBot: message.author.bot,
        content: message.content,
      },
      channel: toAutoReportChannel(message.channel),
      handleOptions: {
        wclClient,
        guildConfigStore,
        autoReportPromptStateService,
        autoReportDuplicateTrackingService,
        botActivityStore: dashboardActivityStore,
      },
      failureThrottle,
    });
  });
  client.on(Events.GuildCreate, (guild) => {
    void sendGuildCreateNotice(guild);
  });
  client.once(Events.ClientReady, (readyClient) => {
    logger.info(
      { userId: readyClient.user.id, guildCount: readyClient.guilds.cache.size },
      'Discord Gateway ready',
    );
  });
  await client.login(env.DISCORD_BOT_TOKEN);
  return client;
};

const start = async () => {
  await connectMongo(env.MONGODB_URI);
  await migrateCharacterClaimIdentityFields();
  await migrateWclUserAuthDiscordUserIndex();
  await startDiscordGateway();
  logger.info('worker started');
};

start().catch((error) => {
  logger.fatal({ error }, 'worker startup failed');
  process.exit(1);
});
