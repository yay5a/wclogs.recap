import mongoose, { Schema } from 'mongoose';

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

export const GuildSettingsModel = mongoose.model('GuildSettings', guildSettingsSchema);
