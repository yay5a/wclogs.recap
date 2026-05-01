import {
  defaultGuildConfigFor,
  parseAutoRecapMode,
  parseCompareAccessMode,
  parseCompareMode,
  parseGameFamily,
} from '@wcl/domain';
import type {
  AccountabilityVisibility,
  AutoRecapMode,
  CoachingShareability,
  CompareAccessMode,
  CompareMode,
  GameFamily,
  GuildConfig,
  GuildConfigStore,
  RecapPostMode,
} from '@wcl/domain';
import { GuildSettingsModel } from '../index.js';

const parseVisibility = (value: unknown): AccountabilityVisibility =>
  value === 'officers-only' || value === 'shareable' ? value : 'off';
const parseCoachingShareability = (value: unknown): CoachingShareability =>
  value === 'shareable' ? 'shareable' : 'private';
const parseRecapPostMode = (value: unknown): RecapPostMode =>
  value === 'preview-only' ? 'preview-only' : 'preview-and-post';
const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    : [];
const parseAutoRecapChannelIds = (value: unknown): string[] => parseStringArray(value);
const parseBoolean = (value: unknown): boolean => (typeof value === 'boolean' ? value : false);

const normalizeDiscordUserId = (discordUserId: string): string => {
  const normalized = discordUserId.trim();
  if (!normalized) throw new Error('discordUserId is required');
  return normalized;
};

const toGuildConfig = (guildId: string, doc: unknown): GuildConfig => {
  const fallback = defaultGuildConfigFor(guildId);
  const raw = doc as Record<string, unknown> | null;
  if (!raw) return fallback;

  return {
    guildId,
    defaultGameFamily: parseGameFamily(raw.defaultGameFamily) ?? fallback.defaultGameFamily,
    compareModeDefault: parseCompareMode(raw.compareModeDefault) ?? fallback.compareModeDefault,
    accountabilityVisibility: parseVisibility(raw.accountabilityVisibility),
    coachingShareabilityDefault: parseCoachingShareability(raw.coachingShareabilityDefault),
    recapPostModeDefault: parseRecapPostMode(raw.recapPostModeDefault),
    autoRecapMode: parseAutoRecapMode(raw.autoRecapMode) ?? fallback.autoRecapMode,
    autoRecapChannelIds: parseAutoRecapChannelIds(raw.autoRecapChannelIds),
    compareAccessMode: parseCompareAccessMode(raw.compareAccessMode) ?? fallback.compareAccessMode,
    compareOfficerUserIds: parseStringArray(raw.compareOfficerUserIds),
    comparePublicPostingEnabled: parseBoolean(raw.comparePublicPostingEnabled),
  };
};

type DashboardGuildConfigSummaryShape = {
  guildId: string;
  compareModeDefault: CompareMode;
  compareAccessMode: CompareAccessMode;
  comparePublicPostingEnabled: boolean;
  autoRecapMode: AutoRecapMode;
  defaultGameFamily: GameFamily;
  compareOfficerUserCount: number;
  autoRecapChannelCount: number;
  updatedAt?: string;
};

const toSummary = (doc: Record<string, unknown>): DashboardGuildConfigSummaryShape | null => {
  if (typeof doc.guildId !== 'string') return null;
  const config = toGuildConfig(doc.guildId, doc);
  const summary: DashboardGuildConfigSummaryShape = {
    guildId: config.guildId,
    compareModeDefault: config.compareModeDefault,
    compareAccessMode: config.compareAccessMode,
    comparePublicPostingEnabled: config.comparePublicPostingEnabled,
    autoRecapMode: config.autoRecapMode,
    defaultGameFamily: config.defaultGameFamily,
    compareOfficerUserCount: config.compareOfficerUserIds.length,
    autoRecapChannelCount: config.autoRecapChannelIds.length,
  };
  if (doc.updatedAt instanceof Date) {
    summary.updatedAt = doc.updatedAt.toISOString();
  }
  return summary;
};

export class MongoGuildConfigStore implements GuildConfigStore {
  public async getGuildConfig(guildId: string): Promise<GuildConfig> {
    const existing = await GuildSettingsModel.findOne({ guildId }).lean();
    return toGuildConfig(guildId, existing);
  }

  public async listGuildConfigSummaries(): Promise<DashboardGuildConfigSummaryShape[]> {
    const docs = await GuildSettingsModel.find({}).lean();
    return docs
      .map((doc) => toSummary(doc as Record<string, unknown>))
      .filter((summary): summary is DashboardGuildConfigSummaryShape => summary !== null)
      .sort((left, right) => left.guildId.localeCompare(right.guildId));
  }

  public async getExistingGuildConfig(guildId: string): Promise<GuildConfig | null> {
    const existing = await GuildSettingsModel.findOne({ guildId }).lean();
    return existing ? toGuildConfig(guildId, existing) : null;
  }

  public async createDefaultGuildConfig(guildId: string): Promise<GuildConfig> {
    const saved = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      {
        $setOnInsert: defaultGuildConfigFor(guildId),
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    return toGuildConfig(guildId, saved);
  }

  public async saveExistingGuildConfig(
    guildId: string,
    update: Partial<Omit<GuildConfig, 'guildId'>>,
  ): Promise<GuildConfig | null> {
    if (Object.keys(update).length === 0) {
      return this.getExistingGuildConfig(guildId);
    }

    const saved = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      {
        $set: {
          ...update,
        },
      },
      {
        new: true,
      },
    ).lean();

    return saved ? toGuildConfig(guildId, saved) : null;
  }

  public async saveGuildConfig(
    guildId: string,
    update: Partial<Omit<GuildConfig, 'guildId'>>,
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

  public async addCompareOfficerUser(guildId: string, discordUserId: string): Promise<GuildConfig> {
    const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
    const saved = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      {
        $setOnInsert: { guildId },
        $addToSet: { compareOfficerUserIds: normalizedDiscordUserId },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    return toGuildConfig(guildId, saved);
  }

  public async addOfficerToExistingGuild(
    guildId: string,
    discordUserId: string,
  ): Promise<GuildConfig | null> {
    const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
    const saved = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      {
        $addToSet: { compareOfficerUserIds: normalizedDiscordUserId },
      },
      {
        new: true,
      },
    ).lean();

    return saved ? toGuildConfig(guildId, saved) : null;
  }

  public async removeCompareOfficerUser(
    guildId: string,
    discordUserId: string,
  ): Promise<GuildConfig> {
    const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
    const saved = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      {
        $setOnInsert: { guildId },
        $pull: { compareOfficerUserIds: normalizedDiscordUserId },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    return toGuildConfig(guildId, saved);
  }

  public async removeOfficerFromExistingGuild(
    guildId: string,
    discordUserId: string,
  ): Promise<GuildConfig | null> {
    const normalizedDiscordUserId = normalizeDiscordUserId(discordUserId);
    const saved = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      {
        $pull: { compareOfficerUserIds: normalizedDiscordUserId },
      },
      {
        new: true,
      },
    ).lean();

    return saved ? toGuildConfig(guildId, saved) : null;
  }
}
