<<<<<<< HEAD
import mongoose, { Schema } from 'mongoose';
import type {
  GameFamily,
  GuildConfig,
  GuildConfigInput,
  GuildConfigStore,
  NormalizedPlayer,
  RecapPostMode,
  CoachingShareability,
  ComparisonMode,
  AccountabilityVisibility,
} from '@wcl/domain';
=======
import mongoose, { Schema } from "mongoose";
>>>>>>> c1868b4 (generated framework through codex)

export const connectMongo = async (uri: string) => mongoose.connect(uri);

const guildSettingsSchema = new Schema(
<<<<<<< HEAD
  {
    guildId: { type: String, required: true, unique: true },
    defaultGameFamily: {
      type: String,
      enum: ['retail', 'mop_classic'],
      required: false,
    },
    compareModeDefault: {
      type: String,
      enum: ['character', 'account', 'mixed'],
      default: 'character',
    },
    accountabilityVisibility: {
      type: String,
      enum: ['off', 'officers-only', 'shareable'],
      default: 'off',
    },
    coachingShareabilityDefault: {
      type: String,
      enum: ['officers-only', 'shareable'],
      default: 'officers-only',
    },
    recapPostModeDefault: {
      type: String,
      enum: ['preview-only', 'allow-post'],
      default: 'allow-post',
    },
    officersRoleIds: [{ type: String }],
  },
  { timestamps: true },
);

const playerProfileSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    discordUserId: { type: String, index: true },
    displayName: { type: String, required: true },
    characterIdentityIds: [{ type: Schema.Types.ObjectId, ref: 'CharacterIdentity' }],
    confidenceScore: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const characterIdentitySchema = new Schema(
  {
    profileId: {
      type: Schema.Types.ObjectId,
      ref: 'PlayerProfile',
      index: true,
    },
    characterName: { type: String, required: true },
    realm: { type: String },
    gameFamily: {
      type: String,
      enum: ['retail', 'mop_classic'],
      required: true,
    },
    specHistory: [{ specName: String, firstSeenAt: Date, lastSeenAt: Date }],
    autoLinked: { type: Boolean, default: false },
    candidateLinks: [{ discordUserId: String, confidence: Number }],
  },
  { timestamps: true },
);

const reportCacheSchema = new Schema(
  {
    reportCode: { type: String, unique: true, required: true },
    sourceUrl: { type: String, required: true },
    gameFamily: {
      type: String,
      enum: ['retail', 'mop_classic'],
      required: true,
    },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    normalizedPayload: { type: Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

const raidSnapshotSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
    title: String,
    zoneName: String,
    gameFamily: String,
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true },
);

const fightSnapshotSchema = new Schema(
  {
    raidSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: 'RaidSnapshot',
      index: true,
    },
    fightId: Number,
    name: String,
    kill: Boolean,
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true },
);

const playerRaidSummarySchema = new Schema(
  {
    raidSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: 'RaidSnapshot',
      index: true,
    },
    playerProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'PlayerProfile',
      index: true,
    },
    characterName: String,
    bestParse: Number,
    averageParse: Number,
    executionScore: Number,
  },
  { timestamps: true },
);

const trendSnapshotSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    playerProfileId: {
      type: Schema.Types.ObjectId,
      ref: 'PlayerProfile',
      index: true,
    },
    metric: { type: String, required: true },
    window: { type: String, required: true },
    value: Number,
    capturedAt: Date,
  },
  { timestamps: true },
);

const accountabilityEventSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    reportCode: String,
    eventType: String,
    payload: Schema.Types.Mixed,
    visibility: {
      type: String,
      enum: ['off', 'officers-only', 'shareable'],
      default: 'off',
    },
  },
  { timestamps: true },
);

const jobSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    payload: Schema.Types.Mixed,
    runAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    lastError: String,
  },
  { timestamps: true },
);

const auditLogSchema = new Schema(
  {
    actorType: { type: String, required: true },
    actorId: { type: String, required: true },
    action: { type: String, required: true },
    targetType: String,
    targetId: String,
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const GuildSettingsModel = mongoose.model('GuildSettings', guildSettingsSchema);
export const PlayerProfileModel = mongoose.model('PlayerProfile', playerProfileSchema);
export const CharacterIdentityModel = mongoose.model('CharacterIdentity', characterIdentitySchema);
export const ReportCacheModel = mongoose.model('ReportCache', reportCacheSchema);
export const RaidSnapshotModel = mongoose.model('RaidSnapshot', raidSnapshotSchema);
export const FightSnapshotModel = mongoose.model('FightSnapshot', fightSnapshotSchema);
export const PlayerRaidSummaryModel = mongoose.model('PlayerRaidSummary', playerRaidSummarySchema);
export const TrendSnapshotModel = mongoose.model('TrendSnapshot', trendSnapshotSchema);
export const AccountabilityEventModel = mongoose.model('AccountabilityEvent', accountabilityEventSchema);
export const JobModel = mongoose.model('Job', jobSchema);
export const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);

const DEFAULT_COMPARE_MODE: ComparisonMode = 'character';
const DEFAULT_VISIBILITY: AccountabilityVisibility = 'off';
const DEFAULT_COACHING: CoachingShareability = 'officers-only';
const DEFAULT_RECAP_POST: RecapPostMode = 'allow-post';

const toGuildConfig = (guildId: string, doc?: Record<string, unknown> | null): GuildConfig => {
  const config: GuildConfig = {
    guildId,
    compareModeDefault: (doc?.compareModeDefault as ComparisonMode | undefined) ?? DEFAULT_COMPARE_MODE,
    accountabilityVisibility: (doc?.accountabilityVisibility as AccountabilityVisibility | undefined) ?? DEFAULT_VISIBILITY,
    coachingShareabilityDefault:
      (doc?.coachingShareabilityDefault as CoachingShareability | undefined) ?? DEFAULT_COACHING,
    recapPostModeDefault: (doc?.recapPostModeDefault as RecapPostMode | undefined) ?? DEFAULT_RECAP_POST,
  };

  const defaultGameFamily = doc?.defaultGameFamily as GameFamily | undefined;
  if (defaultGameFamily) config.defaultGameFamily = defaultGameFamily;

  return config;
};

export class MongoGuildConfigStore implements GuildConfigStore {
  public async getGuildConfig(guildId: string): Promise<GuildConfig> {
    const doc = await GuildSettingsModel.findOne({ guildId }).lean();
    return toGuildConfig(guildId, doc);
  }

  public async saveGuildConfig(guildId: string, input: GuildConfigInput): Promise<GuildConfig> {
    const update: Record<string, unknown> = {};
    if (input.defaultGameFamily !== undefined) update.defaultGameFamily = input.defaultGameFamily;
    if (input.compareModeDefault !== undefined) update.compareModeDefault = input.compareModeDefault;
    if (input.accountabilityVisibility !== undefined) {
      update.accountabilityVisibility = input.accountabilityVisibility;
    }
    if (input.coachingShareabilityDefault !== undefined) {
      update.coachingShareabilityDefault = input.coachingShareabilityDefault;
    }
    if (input.recapPostModeDefault !== undefined) {
      update.recapPostModeDefault = input.recapPostModeDefault;
    }

    const doc = await GuildSettingsModel.findOneAndUpdate(
      { guildId },
      { $set: update, $setOnInsert: { guildId } },
      { upsert: true, new: true },
    ).lean();

    return toGuildConfig(guildId, doc);
  }
}

export const toNormalizedPlayersFromRaidSummary = (
  rows: Array<{
    characterName?: string | undefined;
    bestParse?: number | undefined;
    averageParse?: number | undefined;
    executionScore?: number | undefined;
  }>,
): NormalizedPlayer[] =>
  rows
    .filter((row) => typeof row.characterName === 'string' && row.characterName.length > 0)
    .map((row, index) => {
      const performance: NormalizedPlayer['performance'] = {};
      const execution: NormalizedPlayer['execution'] = {};
      if (typeof row.bestParse === 'number') performance.bestSingleBossParse = row.bestParse;
      if (typeof row.averageParse === 'number') performance.averageParseAcrossKills = row.averageParse;
      if (typeof row.executionScore === 'number') execution.executionScore = row.executionScore;

      return {
        id: `${index}:${row.characterName}`,
        name: row.characterName ?? 'Unknown',
        performance,
        execution,
      };
    });
=======
    {
        guildId: { type: String, required: true, unique: true },
        accountabilityVisibility: {
            type: String,
            enum: ["off", "officers-only", "shareable"],
            default: "off",
        },
        officersRoleIds: [{ type: String }],
    },
    { timestamps: true },
);

const playerProfileSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        discordUserId: { type: String, index: true },
        displayName: { type: String, required: true },
        characterIdentityIds: [
            { type: Schema.Types.ObjectId, ref: "CharacterIdentity" },
        ],
        confidenceScore: { type: Number, default: 0 },
    },
    { timestamps: true },
);

const characterIdentitySchema = new Schema(
    {
        profileId: {
            type: Schema.Types.ObjectId,
            ref: "PlayerProfile",
            index: true,
        },
        characterName: { type: String, required: true },
        realm: { type: String },
        gameFamily: {
            type: String,
            enum: ["retail", "mop_classic"],
            required: true,
        },
        specHistory: [
            { specName: String, firstSeenAt: Date, lastSeenAt: Date },
        ],
        autoLinked: { type: Boolean, default: false },
        candidateLinks: [{ discordUserId: String, confidence: Number }],
    },
    { timestamps: true },
);

const reportCacheSchema = new Schema(
    {
        reportCode: { type: String, unique: true, required: true },
        sourceUrl: { type: String, required: true },
        gameFamily: {
            type: String,
            enum: ["retail", "mop_classic"],
            required: true,
        },
        rawPayload: { type: Schema.Types.Mixed, required: true },
        normalizedPayload: { type: Schema.Types.Mixed, required: true },
        fetchedAt: { type: Date, required: true },
    },
    { timestamps: true },
);

const raidSnapshotSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        reportCode: { type: String, required: true, index: true },
        title: String,
        zoneName: String,
        gameFamily: String,
        startedAt: Date,
        endedAt: Date,
    },
    { timestamps: true },
);

const fightSnapshotSchema = new Schema(
    {
        raidSnapshotId: {
            type: Schema.Types.ObjectId,
            ref: "RaidSnapshot",
            index: true,
        },
        fightId: Number,
        name: String,
        kill: Boolean,
        startedAt: Date,
        endedAt: Date,
    },
    { timestamps: true },
);

const playerRaidSummarySchema = new Schema(
    {
        raidSnapshotId: {
            type: Schema.Types.ObjectId,
            ref: "RaidSnapshot",
            index: true,
        },
        playerProfileId: {
            type: Schema.Types.ObjectId,
            ref: "PlayerProfile",
            index: true,
        },
        characterName: String,
        bestParse: Number,
        averageParse: Number,
        executionScore: Number,
    },
    { timestamps: true },
);

const trendSnapshotSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        playerProfileId: {
            type: Schema.Types.ObjectId,
            ref: "PlayerProfile",
            index: true,
        },
        metric: { type: String, required: true },
        window: { type: String, required: true },
        value: Number,
        capturedAt: Date,
    },
    { timestamps: true },
);

const accountabilityEventSchema = new Schema(
    {
        guildId: { type: String, required: true, index: true },
        reportCode: String,
        eventType: String,
        payload: Schema.Types.Mixed,
        visibility: {
            type: String,
            enum: ["off", "officers-only", "shareable"],
            default: "off",
        },
    },
    { timestamps: true },
);

const jobSchema = new Schema(
    {
        type: { type: String, required: true, index: true },
        status: {
            type: String,
            enum: ["pending", "running", "completed", "failed"],
            default: "pending",
        },
        payload: Schema.Types.Mixed,
        runAt: { type: Date, default: Date.now },
        attempts: { type: Number, default: 0 },
        lastError: String,
    },
    { timestamps: true },
);

const auditLogSchema = new Schema(
    {
        actorType: { type: String, required: true },
        actorId: { type: String, required: true },
        action: { type: String, required: true },
        targetType: String,
        targetId: String,
        metadata: Schema.Types.Mixed,
    },
    { timestamps: true },
);

export const GuildSettingsModel = mongoose.model(
    "GuildSettings",
    guildSettingsSchema,
);
export const PlayerProfileModel = mongoose.model(
    "PlayerProfile",
    playerProfileSchema,
);
export const CharacterIdentityModel = mongoose.model(
    "CharacterIdentity",
    characterIdentitySchema,
);
export const ReportCacheModel = mongoose.model(
    "ReportCache",
    reportCacheSchema,
);
export const RaidSnapshotModel = mongoose.model(
    "RaidSnapshot",
    raidSnapshotSchema,
);
export const FightSnapshotModel = mongoose.model(
    "FightSnapshot",
    fightSnapshotSchema,
);
export const PlayerRaidSummaryModel = mongoose.model(
    "PlayerRaidSummary",
    playerRaidSummarySchema,
);
export const TrendSnapshotModel = mongoose.model(
    "TrendSnapshot",
    trendSnapshotSchema,
);
export const AccountabilityEventModel = mongoose.model(
    "AccountabilityEvent",
    accountabilityEventSchema,
);
export const JobModel = mongoose.model("Job", jobSchema);
export const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);
>>>>>>> c1868b4 (generated framework through codex)
