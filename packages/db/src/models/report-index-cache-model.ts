import type { GameFamily, ReportIndexData } from '@wcl/domain';
import mongoose, { Schema, type Model } from 'mongoose';

export interface ReportIndexCacheDocument {
  reportCode: string;
  gameFamily: GameFamily;
  data: ReportIndexData;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const reportIndexCacheSchema = new Schema<ReportIndexCacheDocument>(
  {
    reportCode: { type: String, required: true, index: true },
    gameFamily: {
      type: String,
      enum: ['retail', 'mop_classic'],
      required: true,
      index: true,
    },
    data: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, index: true },
  },
  { timestamps: true, minimize: false },
);

reportIndexCacheSchema.index({ reportCode: 1, gameFamily: 1 }, { unique: true });

export const ReportIndexCacheModel: Model<ReportIndexCacheDocument> =
  (mongoose.models.ReportIndexCache as Model<ReportIndexCacheDocument> | undefined) ??
  mongoose.model<ReportIndexCacheDocument>('ReportIndexCache', reportIndexCacheSchema);
