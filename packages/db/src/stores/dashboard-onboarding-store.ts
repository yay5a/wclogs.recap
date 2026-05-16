import { DashboardOnboardingModel } from '../models/dashboard-onboarding-model.js';

export interface DashboardOnboardingState {
  userKey: string;
  guildId?: string;
  seenSteps: string[];
  dismissedAt?: Date;
  onboardingVersion: number;
}

const toOnboardingState = (doc: unknown): DashboardOnboardingState | null => {
  if (typeof doc !== 'object' || doc === null) return null;
  const raw = doc as Record<string, unknown>;
  if (
    typeof raw.userKey !== 'string' ||
    !Array.isArray(raw.seenSteps) ||
    typeof raw.onboardingVersion !== 'number'
  ) {
    return null;
  }

  return {
    userKey: raw.userKey,
    ...(typeof raw.guildId === 'string' ? { guildId: raw.guildId } : {}),
    seenSteps: raw.seenSteps.filter((step): step is string => typeof step === 'string'),
    ...(raw.dismissedAt instanceof Date ? { dismissedAt: raw.dismissedAt } : {}),
    onboardingVersion: raw.onboardingVersion,
  };
};

export class MongoDashboardOnboardingStore {
  public async getOnboardingState(input: {
    userKey: string;
    guildId?: string;
    onboardingVersion: number;
  }): Promise<DashboardOnboardingState> {
    const found = await DashboardOnboardingModel.findOne({
      userKey: input.userKey,
      guildId: input.guildId,
      onboardingVersion: input.onboardingVersion,
      archivedAt: { $exists: false },
    }).lean();

    return (
      toOnboardingState(found) ?? {
        userKey: input.userKey,
        ...(input.guildId ? { guildId: input.guildId } : {}),
        seenSteps: [],
        onboardingVersion: input.onboardingVersion,
      }
    );
  }

  public async saveOnboardingState(
    input: DashboardOnboardingState,
  ): Promise<DashboardOnboardingState> {
    const saved = await DashboardOnboardingModel.findOneAndUpdate(
      {
        userKey: input.userKey,
        guildId: input.guildId,
        onboardingVersion: input.onboardingVersion,
      },
      {
        $set: {
          seenSteps: [...new Set(input.seenSteps)],
          ...(input.dismissedAt ? { dismissedAt: input.dismissedAt } : {}),
        },
        $unset: { archivedAt: '' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    const parsed = toOnboardingState(saved);
    if (!parsed) throw new Error('Failed to save dashboard onboarding state.');
    return parsed;
  }

  public async archiveGuildOnboarding(guildId: string, archivedAt = new Date()): Promise<void> {
    await DashboardOnboardingModel.updateMany(
      { guildId, archivedAt: { $exists: false } },
      { $set: { archivedAt } },
    );
  }
}
