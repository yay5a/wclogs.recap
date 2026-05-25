import mongoose, { Schema } from 'mongoose';

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

export const AutoReportPromptStateModel = mongoose.model(
  'AutoReportPromptState',
  autoReportPromptStateSchema,
);
