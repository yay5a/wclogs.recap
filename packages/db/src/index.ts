import mongoose, { Schema } from 'mongoose';

export * from './models/wcl-user-auth-model.js';
export * from './models/character-claim-model.js';
export * from './models/comparison-snapshot-model.js';
export * from './mongo-wcl-user-auth-store.js';
export * from './stores/character-claim-store.js';
export * from './stores/comparison-history-store.js';
export * from './stores/guild-config-store.js';
export * from './stores/recap-preview-state-store.js';
export * from './stores/auto-recap-prompt-state-store.js';
export * from './stores/auto-recap-duplicate-tracking-store.js';
export * from './services/trend-tracking-service.js';

export const connectMongo = async (uri: string) => mongoose.connect(uri);

const guildSettingsSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },
    defaultGameFamily: {
      type: String,
      enum: ['retail', 'mop_classic'],
      default: 'retail',
    },
    compareModeDefault: {
      type: String,
      enum: ['character', 'mixed'],
      default: 'character',
    },

    accountabilityVisibility: {
      type: String,
      enum: ['off', 'officers-only', 'shareable'],
      default: 'off',
    },
    coachingShareabilityDefault: {
      type: String,
      enum: ['private', 'shareable'],
      default: 'private',
    },
    recapPostModeDefault: {
      type: String,
      enum: ['preview-and-post', 'preview-only'],
      default: 'preview-and-post',
    },
    autoRecapMode: {
      type: String,
      enum: ['off', 'prompt', 'auto_preview', 'auto_post'],
      default: 'prompt',
    },
    autoRecapChannelIds: {
      type: [String],
      default: [],
    },
    compareAccessMode: {
      type: String,
      enum: ['officer_only', 'owner_or_officer', 'owner_opt_in_or_officer', 'owner_only'],
      default: 'officer_only',
    },
    compareOfficerUserIds: {
      type: [String],
      default: [],
    },
    comparePublicPostingEnabled: {
      type: Boolean,
      default: false,
    },
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
    guildId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
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
    capturedAt: Date,
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
    playerName: { type: String, index: true },
    metric: { type: String, required: true },
    window: { type: String, required: true },
    value: Number,
    capturedAt: Date,
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
    startedAt: Date,
    leaseExpiresAt: { type: Date, index: true },
    completedAt: Date,
  },
  { timestamps: true },
);
jobSchema.index({ status: 1, runAt: 1, leaseExpiresAt: 1 });

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

const recapPreviewStateSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
    sourceUrl: { type: String, required: true },
    summaryPayload: { type: Schema.Types.Mixed, required: true },
    createdByUserId: { type: String, required: true, index: true },
    interactionId: { type: String, index: true },
    messageId: { type: String, index: true },
    createdAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);
recapPreviewStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
recapPreviewStateSchema.index({ interactionId: 1, messageId: 1 });
recapPreviewStateSchema.index({ guildId: 1, channelId: 1, reportCode: 1 }, { unique: true });

const autoRecapPromptStateSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
    gameFamily: {
      type: String,
      enum: ['retail', 'mop_classic'],
      required: true,
    },
    sourceUrl: { type: String, required: true },
    sourceMessageId: { type: String, required: true, unique: true },
    sourceAuthorId: { type: String, required: true, index: true },
    promptMessageId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
autoRecapPromptStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const autoRecapDuplicateTrackingSchema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, index: true },
    reportCode: { type: String, required: true, index: true },
    gameFamily: {
      type: String,
      enum: ['retail', 'mop_classic'],
      required: true,
    },
    sourceUrl: { type: String, required: true },
    sourceMessageId: { type: String, required: true, index: true },
    sourceAuthorId: { type: String, required: true, index: true },
    mode: {
      type: String,
      enum: ['prompt', 'auto_preview', 'auto_post'],
      required: true,
    },
    status: {
      type: String,
      enum: ['processing', 'prompted', 'preview_posted', 'final_posted', 'ignored', 'failed'],
      required: true,
      default: 'processing',
    },
    latestOutputMessageId: { type: String },
    latestOutputKind: {
      type: String,
      enum: [
        'prompt',
        'public_preview',
        'public_final_recap',
        'duplicate_confirmation',
        'public_failure',
      ],
    },
    duplicateConfirmationMessageId: { type: String },
    confirmationNonce: { type: String, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
autoRecapDuplicateTrackingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
autoRecapDuplicateTrackingSchema.index(
  { guildId: 1, channelId: 1, reportCode: 1 },
  { unique: true },
);

export const GuildSettingsModel = mongoose.model('GuildSettings', guildSettingsSchema);
export const PlayerProfileModel = mongoose.model('PlayerProfile', playerProfileSchema);
export const CharacterIdentityModel = mongoose.model('CharacterIdentity', characterIdentitySchema);
export const ReportCacheModel = mongoose.model('ReportCache', reportCacheSchema);
export const RaidSnapshotModel = mongoose.model('RaidSnapshot', raidSnapshotSchema);

export const FightSnapshotModel = mongoose.model('FightSnapshot', fightSnapshotSchema);
export const PlayerRaidSummaryModel = mongoose.model('PlayerRaidSummary', playerRaidSummarySchema);
export const TrendSnapshotModel = mongoose.model('TrendSnapshot', trendSnapshotSchema);
export const JobModel = mongoose.model('Job', jobSchema);
export const AuditLogModel = mongoose.model('AuditLog', auditLogSchema);
export const RecapPreviewStateModel = mongoose.model('RecapPreviewState', recapPreviewStateSchema);
export const AutoRecapPromptStateModel = mongoose.model(
  'AutoRecapPromptState',
  autoRecapPromptStateSchema,
);
export const AutoRecapDuplicateTrackingModel = mongoose.model(
  'AutoRecapDuplicateTracking',
  autoRecapDuplicateTrackingSchema,
);

export const migrateRecapPreviewStateIndexes = async (): Promise<void> => {
  const oldUniqueKey = { guildId: 1, reportCode: 1 };
  const indexes = await RecapPreviewStateModel.collection.indexes();
  await Promise.all(
    indexes
      .filter((index) => {
        const key = index.key as Record<string, unknown> | undefined;
        return (
          index.unique === true &&
          key?.guildId === oldUniqueKey.guildId &&
          key?.reportCode === oldUniqueKey.reportCode &&
          !('channelId' in key)
        );
      })
      .map(async (index) => {
        if (!index.name) return;
        await RecapPreviewStateModel.collection.dropIndex(index.name);
      }),
  );
  await RecapPreviewStateModel.collection.createIndex(
    { guildId: 1, channelId: 1, reportCode: 1 },
    { unique: true },
  );
};
