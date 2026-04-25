import { defaultGuildConfigFor } from "@wcl/domain";
import type {
    AccountabilityVisibility,
    CoachingShareability,
    CompareMode,
    GameFamily,
    GuildConfig,
    GuildConfigStore,
    RecapPostMode,
} from "@wcl/domain";
import { GuildSettingsModel } from "../index.js";

const parseGameFamily = (value: unknown): GameFamily =>
    value === "mop_classic" ? "mop_classic" : "retail";
const parseCompareMode = (value: unknown): CompareMode =>
    value === "mixed" ? "mixed" : "character";
const parseVisibility = (value: unknown): AccountabilityVisibility =>
    value === "officers-only" || value === "shareable" ? value : "off";
const parseCoachingShareability = (value: unknown): CoachingShareability =>
    value === "shareable" ? "shareable" : "private";
const parseRecapPostMode = (value: unknown): RecapPostMode =>
    value === "preview-only" ? "preview-only" : "preview-and-post";

const toGuildConfig = (guildId: string, doc: unknown): GuildConfig => {
    const fallback = defaultGuildConfigFor(guildId);
    const raw = doc as Record<string, unknown> | null;
    if (!raw) return fallback;

    return {
        guildId,
        defaultGameFamily: parseGameFamily(raw.defaultGameFamily),
        compareModeDefault: parseCompareMode(raw.compareModeDefault),
        accountabilityVisibility: parseVisibility(raw.accountabilityVisibility),
        coachingShareabilityDefault: parseCoachingShareability(
            raw.coachingShareabilityDefault,
        ),
        recapPostModeDefault: parseRecapPostMode(raw.recapPostModeDefault),
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
