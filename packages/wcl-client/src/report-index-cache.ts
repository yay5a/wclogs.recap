import type { GameFamily, ReportIndexData } from '@wcl/domain';

export interface ReportIndexCacheKey {
  reportCode: string;
  gameFamily: GameFamily;
}

export type ReportIndexCacheReadResult =
  | { status: 'hit'; data: ReportIndexData }
  | { status: 'miss' }
  | { status: 'stale'; expiresAt?: Date };

export interface ReportIndexCacheStore {
  getReportIndex(key: ReportIndexCacheKey): Promise<ReportIndexCacheReadResult>;
  saveReportIndex(
    input: ReportIndexCacheKey & {
      data: ReportIndexData;
      expiresAt?: Date;
    },
  ): Promise<void>;
}

const SHORT_CACHE_TTL_MS = 10 * 60 * 1000;
const RECENT_REPORT_MS = 2 * 60 * 60 * 1000;

export const getReportIndexCacheExpiresAt = (
  index: ReportIndexData,
  now = new Date(),
): Date | undefined => {
  const hasLiveFight = index.allBossFights.some((fight) => fight.inProgress === true);
  if (hasLiveFight) return new Date(now.getTime() + SHORT_CACHE_TTL_MS);

  const latestEndTime = Math.max(
    index.endTime,
    ...index.allBossFights.map((fight) => fight.endTime),
  );
  if (latestEndTime > now.getTime() - RECENT_REPORT_MS) {
    return new Date(now.getTime() + SHORT_CACHE_TTL_MS);
  }

  return undefined;
};
