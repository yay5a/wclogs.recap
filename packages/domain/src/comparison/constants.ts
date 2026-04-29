export const COMPARISON_THRESHOLDS = {
  trustedSampleSize: 3,
  historyLimit: 5,
  parseNearPercentilePoints: 5,
  outputNearPercent: 10,
  countNearDelta: 1,
} as const;

export const {
  trustedSampleSize,
  historyLimit,
  parseNearPercentilePoints,
  outputNearPercent,
  countNearDelta,
} = COMPARISON_THRESHOLDS;
