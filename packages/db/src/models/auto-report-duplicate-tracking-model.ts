import mongoose, { Schema } from 'mongoose';

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

export const AutoReportDuplicateTrackingModel = mongoose.model(
  'AutoReportDuplicateTracking',
  autoReportDuplicateTrackingSchema,
);
