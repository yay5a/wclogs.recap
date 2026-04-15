export type AccountabilityVisibility = 'off' | 'officers-only' | 'shareable';
export type CoachingShareability = 'private' | 'shareable';

export interface CoachingViewService {
  buildShareableCoachingView(reportCode: string): Promise<unknown>;
}

export interface AccountabilityViewService {
  buildAccountabilityView(
    reportCode: string,
    visibility: AccountabilityVisibility,
  ): Promise<unknown>;
}

export interface SubscriptionService {
  scheduleReportSubscription(guildId: string, channelId: string): Promise<void>;
}

export interface IdentityMergeReviewService {
  enqueueCandidateReview(profileId: string): Promise<void>;
}
