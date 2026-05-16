import { getRankingWeekStart } from '@wcl/db';

const DAY_MS = 24 * 60 * 60 * 1000;

export type GuildRankReportWindowName = 'current' | 'baseline' | 'all';

export interface GuildRankReportWindow {
  label: string;
  startTimeMs: number;
  endTimeMs: number;
}

export const buildGuildRankReportWindows = (
  now: Date = new Date(),
): Record<GuildRankReportWindowName, GuildRankReportWindow> => {
  const currentStartMs = getRankingWeekStart(now).getTime();
  const currentEndMs = now.getTime();
  const baselineStartMs = currentStartMs - 14 * DAY_MS;
  const baselineEndMs = currentStartMs - 1;

  return {
    current: {
      label: 'Current lockout',
      startTimeMs: currentStartMs,
      endTimeMs: currentEndMs,
    },
    baseline: {
      label: 'Baseline (previous 14 calendar days)',
      startTimeMs: baselineStartMs,
      endTimeMs: baselineEndMs,
    },
    all: {
      label: 'Current + baseline',
      startTimeMs: baselineStartMs,
      endTimeMs: currentEndMs,
    },
  };
};
