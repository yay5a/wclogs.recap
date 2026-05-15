import mongoose, { Schema } from 'mongoose';

export * from './models/wcl-user-auth-model.js';
export * from './models/character-claim-model.js';
export * from './models/dashboard-activity-model.js';
export * from './models/dashboard-onboarding-model.js';
export * from './models/guild-report-metadata-model.js';
export * from './models/report-index-cache-model.js';
export * from './mongo-wcl-user-auth-store.js';
export * from './wcl-token-encryption.js';
export * from './stores/character-claim-store.js';
export * from './stores/guild-config-store.js';
export * from './stores/dashboard-activity-store.js';
export * from './stores/dashboard-onboarding-store.js';
export * from './stores/auto-report-prompt-state-store.js';
export * from './stores/auto-report-duplicate-tracking-store.js';
export * from './stores/guild-report-metadata-store.js';
export * from './stores/report-index-cache-store.js';

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
    autoReportMode: {
      type: String,
      enum: ['off', 'prompt', 'auto_preview', 'auto_post'],
      default: 'prompt',
    },
    autoReportChannelIds: {
      type: [String],
      default: [],
    },
    wclGuildName: {
      type: String,
    },
    wclGuildServerSlug: {
      type: String,
    },
    wclGuildServerRegion: {
      type: String,
    },
    wclZoneId: {
      type: Number,
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
    dashboardOfficerAccessEnabled: {
      type: Boolean,
      default: false,
    },
    comparePublicPostingEnabled: {
      type: Boolean,
      default: false,
    },
    dashboardDeconfiguredAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

const autoReportPromptStateSchema = new Schema(
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
autoReportPromptStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const autoReportDuplicateTrackingSchema = new Schema(
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
        'public_final_report',
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
autoReportDuplicateTrackingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
autoReportDuplicateTrackingSchema.index(
  { guildId: 1, channelId: 1, reportCode: 1 },
  { unique: true },
);

export const GuildSettingsModel = mongoose.model('GuildSettings', guildSettingsSchema);
export const AutoReportPromptStateModel = mongoose.model(
  'AutoReportPromptState',
  autoReportPromptStateSchema,
);
export const AutoReportDuplicateTrackingModel = mongoose.model(
  'AutoReportDuplicateTracking',
  autoReportDuplicateTrackingSchema,
);
