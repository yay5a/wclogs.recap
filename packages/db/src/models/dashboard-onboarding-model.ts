import mongoose, { Schema, type Model } from 'mongoose';

export interface DashboardOnboardingDocument {
  userKey: string;
  guildId?: string;
  seenSteps: string[];
  dismissedAt?: Date;
  onboardingVersion: number;
  archivedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const dashboardOnboardingSchema = new Schema<DashboardOnboardingDocument>(
  {
    userKey: { type: String, required: true, index: true },
    guildId: { type: String, index: true },
    seenSteps: { type: [String], default: [] },
    dismissedAt: { type: Date },
    onboardingVersion: { type: Number, required: true, default: 1 },
    archivedAt: { type: Date },
  },
  { timestamps: true },
);

dashboardOnboardingSchema.index({ userKey: 1, guildId: 1, onboardingVersion: 1 }, { unique: true });

export const DashboardOnboardingModel: Model<DashboardOnboardingDocument> =
  (mongoose.models.DashboardOnboarding as Model<DashboardOnboardingDocument> | undefined) ??
  mongoose.model<DashboardOnboardingDocument>('DashboardOnboarding', dashboardOnboardingSchema);
