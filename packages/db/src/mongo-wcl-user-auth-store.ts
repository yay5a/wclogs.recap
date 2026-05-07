import { WclUserAuthModel, type WclUserAuthDocument } from "./models/wcl-user-auth-model.js";
import {
    decryptWclToken,
    encryptWclToken,
    isWclTokenEnvelope,
    parseWclTokenEncryptionKey,
} from "./wcl-token-encryption.js";
import type { WclTokenEnvelope } from "./wcl-token-encryption.js";

export type UpsertWclUserAuthInput = {
    discordUserId: string;
    provider: "warcraftlogs";
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    updatedAt: Date;
};

export type WclUserAuthStatus = {
    discordUserId: string;
    provider?: "warcraftlogs";
    tokenType?: string;
    scope?: string;
    expiresAt?: Date;
    linkedAt?: Date;
    updatedAt?: Date;
};

export type WclUserAuthRecord = WclUserAuthStatus & {
    accessToken?: string;
    refreshToken?: string;
};

type MongoWclUserAuthStoreOptions = {
    encryptionKey: string;
};

type WclUserAuthLeanRecord = WclUserAuthDocument & {
    accessTokenEnvelope?: WclTokenEnvelope;
    refreshTokenEnvelope?: WclTokenEnvelope;
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

    async getStatusByDiscordUserId(
        discordUserId: string,
    ): Promise<WclUserAuthStatus | null> {
        const record = await WclUserAuthModel.findOne({ discordUserId })
            .select("discordUserId provider tokenType scope expiresAt linkedAt updatedAt")
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
        const unset: Record<string, ""> = {};
        unset.accessToken = "";
        unset.refreshToken = "";
        if (!entry.refreshToken) unset.refreshTokenEnvelope = "";
        if (!entry.tokenType) unset.tokenType = "";
        if (!entry.scope) unset.scope = "";
        if (!entry.expiresAt) unset.expiresAt = "";

        const accessTokenEnvelope = encryptWclToken(
            entry.accessToken,
            this.encryptionKey,
        );
        const refreshTokenEnvelope = entry.refreshToken
            ? encryptWclToken(entry.refreshToken, this.encryptionKey)
            : undefined;

        await WclUserAuthModel.findOneAndUpdate(
            { discordUserId: entry.discordUserId },
            {
                $set: {
                    provider: entry.provider,
                    accessTokenEnvelope,
                    updatedAt: entry.updatedAt,
                    ...(refreshTokenEnvelope ? { refreshTokenEnvelope } : {}),
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
        const hasAccessEnvelope = isWclTokenEnvelope(record.accessTokenEnvelope);
        const hasRefreshEnvelope = isWclTokenEnvelope(record.refreshTokenEnvelope);
        const legacyAccessToken =
            typeof record.accessToken === "string" && record.accessToken.length > 0
                ? record.accessToken
                : undefined;
        const legacyRefreshToken =
            typeof record.refreshToken === "string" && record.refreshToken.length > 0
                ? record.refreshToken
                : undefined;

        const accessToken = hasAccessEnvelope
            ? decryptWclToken(record.accessTokenEnvelope, this.encryptionKey)
            : legacyAccessToken;
        const refreshToken = hasRefreshEnvelope
            ? decryptWclToken(record.refreshTokenEnvelope, this.encryptionKey)
            : legacyRefreshToken;

        if (!accessToken) {
            throw new Error("WCL linked auth token material is unavailable.");
        }

        if (!hasAccessEnvelope && legacyAccessToken) {
            await this.upgradeLegacyPlaintextRecord({
                discordUserId: record.discordUserId,
                accessToken: legacyAccessToken,
                ...(legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {}),
            });
        } else if (hasAccessEnvelope && (record.accessToken || record.refreshToken)) {
            await this.removeLegacyPlaintextFields(record.discordUserId);
        }

        return {
            discordUserId: record.discordUserId,
            ...(record.provider ? { provider: record.provider } : {}),
            accessToken,
            ...(refreshToken ? { refreshToken } : {}),
            ...(record.tokenType ? { tokenType: record.tokenType } : {}),
            ...(record.scope ? { scope: record.scope } : {}),
            ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
            ...(record.linkedAt ? { linkedAt: record.linkedAt } : {}),
            ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
        };
    }

    private async upgradeLegacyPlaintextRecord(input: {
        discordUserId: string;
        accessToken: string;
        refreshToken?: string;
    }): Promise<void> {
        const accessTokenEnvelope = encryptWclToken(
            input.accessToken,
            this.encryptionKey,
        );
        const refreshTokenEnvelope = input.refreshToken
            ? encryptWclToken(input.refreshToken, this.encryptionKey)
            : undefined;

        await WclUserAuthModel.updateOne(
            { discordUserId: input.discordUserId },
            {
                $set: {
                    accessTokenEnvelope,
                    ...(refreshTokenEnvelope ? { refreshTokenEnvelope } : {}),
                },
                $unset: {
                    accessToken: "",
                    refreshToken: "",
                    ...(refreshTokenEnvelope ? {} : { refreshTokenEnvelope: "" }),
                },
            },
        );
    }

    private async removeLegacyPlaintextFields(discordUserId: string): Promise<void> {
        await WclUserAuthModel.updateOne(
            { discordUserId },
            {
                $unset: {
                    accessToken: "",
                    refreshToken: "",
                },
            },
        );
    }
}

export const migrateWclUserAuthDiscordUserIndex = async (): Promise<void> => {
    const indexes = await WclUserAuthModel.collection.indexes();
    const legacyProviderIndex = indexes.find(
        (index) => index.name === "provider_1" && index.unique === true,
    );
    if (legacyProviderIndex?.name) {
        await WclUserAuthModel.collection.dropIndex(legacyProviderIndex.name);
    }

    await WclUserAuthModel.collection.createIndex(
        { discordUserId: 1 },
        { unique: true, name: "discordUserId_1" },
    );
    await WclUserAuthModel.collection.createIndex(
        { provider: 1 },
        { name: "provider_1" },
    );
};
