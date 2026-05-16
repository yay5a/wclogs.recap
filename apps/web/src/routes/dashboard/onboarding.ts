import type { DashboardAuthContext, DashboardOnboardingState } from './types.js';
import { ONBOARDING_VERSION } from './types.js';

export const onboardingUserKey = (auth: DashboardAuthContext): string =>
  auth.kind === 'discord' ? `discord:${auth.discordUserId}` : 'admin-secret';

export const defaultOnboardingState = (
  userKey: string,
  guildId: string,
): DashboardOnboardingState => ({
  userKey,
  guildId,
  seenSteps: [],
  onboardingVersion: ONBOARDING_VERSION,
});
