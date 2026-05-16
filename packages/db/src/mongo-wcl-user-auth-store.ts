import { WclUserAuthModel, type WclUserAuthDocument } from './models/wcl-user-auth-model.js';
import {
  decryptWclToken,
  encryptWclToken,
  isWclTokenEnvelope,
  parseWclTokenEncryptionKey,
} from './wcl-token-encryption.js';
import type { WclTokenEnvelope } from './wcl-token-encryption.js';

export type UpsertWclUserAuthInput = {
  discordUserId: string;
  provider: 'warcraftlogs';
  userAccessToken: string;
  userRefreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: Date;
  updatedAt: Date;
};

export type WclUserAuthStatus = {
  discordUserId: string;
  provider?: 'warcraftlogs';
  tokenType?: string;
  scope?: string;
  expiresAt?: Date;
  linkedAt?: Date;
  updatedAt?: Date;
};

export type WclUserAuthRecord = WclUserAuthStatus & {
  userAccessToken?: string;
  userRefreshToken?: string;
};

type MongoWclUserAuthStoreOptions = {
  encryptionKey: string;
};

type WclUserAuthLeanRecord = WclUserAuthDocument & {
  userAccessTokenEnvelope?: WclTokenEnvelope;
  userRefreshTokenEnvelope?: WclTokenEnvelope;
};

export class MongoWclUserAuthStore {
  private readonly encryptionKey: Buffer;

  public constructor(options: MongoWclUserAuthStoreOptions) {
    this.encryptionKey = parseWclTokenEncryptionKey(options.encryptionKey);
  }

  async getByDiscordUserId(discordUserId: string): Promise<WclUserAuthRecord | null> {
    const record = await WclUserAuthModel.findOne({ discordUserId }).lean();
    if (!record) return null;
    const normalized = await this.decryptRecord(record as WclUserAuthLeanRecord);
    return normalized;
  }

  async getStatusByDiscordUserId(discordUserId: string): Promise<WclUserAuthStatus | null> {
    const record = await WclUserAuthModel.findOne({ discordUserId })
      .select('discordUserId provider tokenType scope expiresAt linkedAt updatedAt')
      .lean();
    return record
      ? {
          discordUserId: record.discordUserId,
          ...(record.provider ? { provider: record.provider } : {}),
          ...(record.tokenType ? { tokenType: record.tokenType } : {}),
          ...(record.scope ? { scope: record.scope } : {}),
          ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
          ...(record.linkedAt ? { linkedAt: record.linkedAt } : {}),
          ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
        }
      : null;
  }

  async upsertForDiscordUser(entry: UpsertWclUserAuthInput) {
    const unset: Record<string, ''> = {};
    if (!entry.userRefreshToken) unset.userRefreshTokenEnvelope = '';
    if (!entry.tokenType) unset.tokenType = '';
    if (!entry.scope) unset.scope = '';
    if (!entry.expiresAt) unset.expiresAt = '';

    const userAccessTokenEnvelope = encryptWclToken(entry.userAccessToken, this.encryptionKey);
    const userRefreshTokenEnvelope = entry.userRefreshToken
      ? encryptWclToken(entry.userRefreshToken, this.encryptionKey)
      : undefined;

    await WclUserAuthModel.findOneAndUpdate(
      { discordUserId: entry.discordUserId },
      {
        $set: {
          provider: entry.provider,
          userAccessTokenEnvelope,
          updatedAt: entry.updatedAt,
          ...(userRefreshTokenEnvelope ? { userRefreshTokenEnvelope } : {}),
          ...(entry.tokenType ? { tokenType: entry.tokenType } : {}),
          ...(entry.scope ? { scope: entry.scope } : {}),
          ...(entry.expiresAt ? { expiresAt: entry.expiresAt } : {}),
        },
        $setOnInsert: {
          discordUserId: entry.discordUserId,
          linkedAt: entry.updatedAt,
        },
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { upsert: true },
    );
  }

  async deleteForDiscordUser(discordUserId: string) {
    await WclUserAuthModel.deleteOne({ discordUserId });
  }

  private async decryptRecord(record: WclUserAuthLeanRecord): Promise<WclUserAuthRecord> {
    const hasUserAccessEnvelope = isWclTokenEnvelope(record.userAccessTokenEnvelope);
    const hasUserRefreshEnvelope = isWclTokenEnvelope(record.userRefreshTokenEnvelope);
    const userAccessToken = hasUserAccessEnvelope
      ? decryptWclToken(record.userAccessTokenEnvelope, this.encryptionKey)
      : undefined;
    const userRefreshToken = hasUserRefreshEnvelope
      ? decryptWclToken(record.userRefreshTokenEnvelope, this.encryptionKey)
      : undefined;

    if (!userAccessToken) {
      throw new Error('WCL linked auth token material is unavailable.');
    }

    return {
      discordUserId: record.discordUserId,
      ...(record.provider ? { provider: record.provider } : {}),
      userAccessToken,
      ...(userRefreshToken ? { userRefreshToken } : {}),
      ...(record.tokenType ? { tokenType: record.tokenType } : {}),
      ...(record.scope ? { scope: record.scope } : {}),
      ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
      ...(record.linkedAt ? { linkedAt: record.linkedAt } : {}),
      ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
    };
  }
}

export const migrateWclUserAuthDiscordUserIndex = async (): Promise<void> => {
  const indexes = await WclUserAuthModel.collection.indexes();
  const legacyProviderIndex = indexes.find(
    (index) => index.name === 'provider_1' && index.unique === true,
  );
  if (legacyProviderIndex?.name) {
    await WclUserAuthModel.collection.dropIndex(legacyProviderIndex.name);
  }

  await WclUserAuthModel.collection.createIndex(
    { discordUserId: 1 },
    { unique: true, name: 'discordUserId_1' },
  );
  await WclUserAuthModel.collection.createIndex({ provider: 1 }, { name: 'provider_1' });
};
