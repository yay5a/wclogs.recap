import {
  countNearDelta,
  outputNearPercent,
  parseNearPercentilePoints,
  trustedSampleSize,
} from './constants.js';

export type BaselineStatus = 'no-history' | 'insufficient-history' | 'ready';

export type BaselineMetricLabel =
  | 'above-baseline'
  | 'below-baseline'
  | 'near-baseline'
  | 'unavailable';

export type BaselineMetricName =
  | 'parse'
  | 'damageTotal'
  | 'healingTotal'
  | 'deaths'
  | 'interrupts'
  | 'dispels';

export type BaselineMetricDirection = 'higher' | 'lower';

export type UnavailableBaselineReason = 'missing-current' | 'no-baseline-samples';

export interface ComparisonBaselineRow {
  rankPercent?: number | null;
  damageTotal?: number | null;
  healingTotal?: number | null;
  deaths?: number | null;
  interrupts?: number | null;
  dispels?: number | null;
}

export interface AvailableBaselineMetricComparison {
  label: Exclude<BaselineMetricLabel, 'unavailable'>;
  current: number;
  baselineAverage: number;
  delta: number;
  deltaPercent?: number;
  sampleSize: number;
  favorableDirection: BaselineMetricDirection;
}

export interface UnavailableBaselineMetricComparison {
  label: 'unavailable';
  reason: UnavailableBaselineReason;
  sampleSize: number;
}

export type BaselineMetricComparison =
  | AvailableBaselineMetricComparison
  | UnavailableBaselineMetricComparison;

export type BaselineMetrics = Record<BaselineMetricName, BaselineMetricComparison>;

export interface ComparisonBaseline {
  status: BaselineStatus;
  sampleSize: number;
  metrics: BaselineMetrics;
  unavailableMetrics: BaselineMetricName[];
}

type MetricField = keyof ComparisonBaselineRow;

interface MetricDefinition {
  name: BaselineMetricName;
  field: MetricField;
  thresholdKind: 'absolute' | 'percent';
  nearThreshold: number;
  favorableDirection: BaselineMetricDirection;
}

const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    name: 'parse',
    field: 'rankPercent',
    thresholdKind: 'absolute',
    nearThreshold: parseNearPercentilePoints,
    favorableDirection: 'higher',
  },
  {
    name: 'damageTotal',
    field: 'damageTotal',
    thresholdKind: 'percent',
    nearThreshold: outputNearPercent,
    favorableDirection: 'higher',
  },
  {
    name: 'healingTotal',
    field: 'healingTotal',
    thresholdKind: 'percent',
    nearThreshold: outputNearPercent,
    favorableDirection: 'higher',
  },
  {
    name: 'deaths',
    field: 'deaths',
    thresholdKind: 'absolute',
    nearThreshold: countNearDelta,
    favorableDirection: 'lower',
  },
  {
    name: 'interrupts',
    field: 'interrupts',
    thresholdKind: 'absolute',
    nearThreshold: countNearDelta,
    favorableDirection: 'higher',
  },
  {
    name: 'dispels',
    field: 'dispels',
    thresholdKind: 'absolute',
    nearThreshold: countNearDelta,
    favorableDirection: 'higher',
  },
] as const;

const isComparableNumber = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const average = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  return values.reduce((total, value) => total + value, 0) / values.length;
};

const calculateDeltaPercent = (current: number, baselineAverage: number): number | undefined => {
  if (baselineAverage === 0) return undefined;
  return ((current - baselineAverage) / Math.abs(baselineAverage)) * 100;
};

const labelAbsoluteDelta = (
  current: number,
  baselineAverage: number,
  nearThreshold: number,
): Exclude<BaselineMetricLabel, 'unavailable'> => {
  const delta = current - baselineAverage;
  if (Math.abs(delta) <= nearThreshold) return 'near-baseline';
  return delta > 0 ? 'above-baseline' : 'below-baseline';
};

const labelPercentDelta = (
  current: number,
  baselineAverage: number,
  nearThreshold: number,
): Exclude<BaselineMetricLabel, 'unavailable'> => {
  const deltaPercent = calculateDeltaPercent(current, baselineAverage);

  if (deltaPercent === undefined) {
    if (current === baselineAverage) return 'near-baseline';
    return current > baselineAverage ? 'above-baseline' : 'below-baseline';
  }

  if (Math.abs(deltaPercent) <= nearThreshold) return 'near-baseline';
  return deltaPercent > 0 ? 'above-baseline' : 'below-baseline';
};

const compareMetric = (
  current: ComparisonBaselineRow,
  history: readonly ComparisonBaselineRow[],
  definition: MetricDefinition,
): BaselineMetricComparison => {
  const currentValue = current[definition.field];
  const historicalValues = history
    .map((row) => row[definition.field])
    .filter(isComparableNumber);

  if (!isComparableNumber(currentValue)) {
    return {
      label: 'unavailable',
      reason: 'missing-current',
      sampleSize: historicalValues.length,
    };
  }

  const baselineAverage = average(historicalValues);

  if (baselineAverage === undefined) {
    return {
      label: 'unavailable',
      reason: 'no-baseline-samples',
      sampleSize: 0,
    };
  }

  const label =
    definition.thresholdKind === 'percent'
      ? labelPercentDelta(currentValue, baselineAverage, definition.nearThreshold)
      : labelAbsoluteDelta(currentValue, baselineAverage, definition.nearThreshold);

  const delta = currentValue - baselineAverage;
  const deltaPercent = calculateDeltaPercent(currentValue, baselineAverage);

  return {
    label,
    current: currentValue,
    baselineAverage,
    delta,
    ...(deltaPercent === undefined ? {} : { deltaPercent }),
    sampleSize: historicalValues.length,
    favorableDirection: definition.favorableDirection,
  };
};

export const buildComparisonBaseline = (
  current: ComparisonBaselineRow,
  history: readonly ComparisonBaselineRow[],
): ComparisonBaseline => {
  const sampleSize = history.length;
  const status: BaselineStatus =
    sampleSize === 0
      ? 'no-history'
      : sampleSize < trustedSampleSize
        ? 'insufficient-history'
        : 'ready';

  const metrics = Object.fromEntries(
    METRIC_DEFINITIONS.map((definition) => [
      definition.name,
      compareMetric(current, history, definition),
    ]),
  ) as BaselineMetrics;

  const unavailableMetrics = METRIC_DEFINITIONS.filter(
    (definition) => metrics[definition.name].label === 'unavailable',
  ).map((definition) => definition.name);

  return {
    status,
    sampleSize,
    metrics,
    unavailableMetrics,
  };
};
