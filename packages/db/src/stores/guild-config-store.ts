import {
    defaultGuildConfigFor,
    parseAutoRecapMode,
    parseCompareAccessMode,
    parseCompareMode,
} from "@wcl/domain";
import type {
    AccountabilityVisibility,
    CoachingShareability,
    GameFamily,
    GuildConfig,
    GuildConfigStore,
    RecapPostMode,
} from "@wcl/domain";
import { GuildSettingsModel } from "../index.js";

const parseGameFamily = (value: unknown): GameFamily =>
    value === "mop_classic" ? "mop_classic" : "retail";
const parseVisibility = (value: unknown): AccountabilityVisibility =>
    value === "officers-only" || value === "shareable" ? value : "off";
const parseCoachingShareability = (value: unknown): CoachingShareability =>
    value === "shareable" ? "shareable" : "private";
const parseRecapPostMode = (value: unknown): RecapPostMode =>
    value === "preview-only" ? "preview-only" : "preview-and-post";
const parseCompareOfficerRoleIds = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((roleId): roleId is string => typeof roleId === "string") : [];
const parseAutoRecapChannelIds = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((channelId): channelId is string => typeof channelId === "string"))] : [];
const parseBoolean = (value: unknown): boolean =>
    typeof value === "boolean" ? value : false;

const toGuildConfig = (guildId: string, doc: unknown): GuildConfig => {
    const fallback = defaultGuildConfigFor(guildId);
    const raw = doc as Record<string, unknown> | null;
    if (!raw) return fallback;

    return {
        guildId,
        defaultGameFamily: parseGameFamily(raw.defaultGameFamily),
        compareModeDefault:
            parseCompareMode(raw.compareModeDefault) ?? fallback.compareModeDefault,
        accountabilityVisibility: parseVisibility(raw.accountabilityVisibility),
        coachingShareabilityDefault: parseCoachingShareability(
            raw.coachingShareabilityDefault,
        ),
        recapPostModeDefault: parseRecapPostMode(raw.recapPostModeDefault),
        autoRecapMode:
            parseAutoRecapMode(raw.autoRecapMode) ?? fallback.autoRecapMode,
        autoRecapChannelIds: parseAutoRecapChannelIds(raw.autoRecapChannelIds),
        compareAccessMode:
            parseCompareAccessMode(raw.compareAccessMode) ?? fallback.compareAccessMode,
        compareOfficerRoleIds: parseCompareOfficerRoleIds(raw.compareOfficerRoleIds),
        comparePublicPostingEnabled: parseBoolean(raw.comparePublicPostingEnabled),
    };
};

export class MongoGuildConfigStore implements GuildConfigStore {
    public async getGuildConfig(guildId: string): Promise<GuildConfig> {
        const existing = await GuildSettingsModel.findOne({ guildId }).lean();
        return toGuildConfig(guildId, existing);
    }

    public async saveGuildConfig(
        guildId: string,
        update: Partial<Omit<GuildConfig, "guildId">>,
    ): Promise<GuildConfig> {
        const saved = await GuildSettingsModel.findOneAndUpdate(
            { guildId },
            {
                $set: {
                    ...update,
                },
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true,
            },
        ).lean();

        return toGuildConfig(guildId, saved);
    }
}
