import type {
  AvailableBaselineMetricComparison,
  BaselineMetricComparison,
  BaselineMetricName,
  CompareMode,
  ComparisonBaseline,
} from '@wcl/domain';
import { trustedSampleSize } from '@wcl/domain';

const EPHEMERAL_MESSAGE_FLAG = 64;

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

const metricLabels: Record<BaselineMetricName, string> = {
  parse: 'Parse',
  damageTotal: 'Damage total',
  healingTotal: 'Healing total',
  deaths: 'Deaths',
  interrupts: 'Interrupts',
  dispels: 'Dispels',
};

const performanceMetrics: BaselineMetricName[] = ['parse', 'damageTotal', 'healingTotal'];
const executionMetrics: BaselineMetricName[] = ['deaths', 'interrupts', 'dispels'];
const summaryPerformanceMetrics: BaselineMetricName[] = ['parse', 'damageTotal', 'healingTotal'];
const summaryExecutionMetrics: BaselineMetricName[] = ['deaths', 'interrupts', 'dispels'];

const summaryMetricLabels: Record<BaselineMetricName, { label: string; verb: 'is' | 'are' }> = {
  parse: { label: 'parse', verb: 'is' },
  damageTotal: { label: 'damage', verb: 'is' },
  healingTotal: { label: 'healing', verb: 'is' },
  deaths: { label: 'deaths', verb: 'are' },
  interrupts: { label: 'interrupts', verb: 'are' },
  dispels: { label: 'dispels', verb: 'are' },
};

export interface CompareBaselineResponseViewModel {
  characterName: string;
  mode: Extract<CompareMode, 'character'>;
  historyCount: number;
  baseline: ComparisonBaseline;
}

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  count === 1 ? singular : plural;

const formatMetricValue = (metricName: BaselineMetricName, value: number): string => {
  if (metricName === 'parse' || metricName === 'deaths' || metricName === 'interrupts' || metricName === 'dispels') {
    return decimalFormatter.format(value);
  }

  return numberFormatter.format(value);
};

const formatBaselineLabel = (label: AvailableBaselineMetricComparison['label']): string => {
  switch (label) {
    case 'above-baseline':
      return 'above baseline';
    case 'below-baseline':
      return 'below baseline';
    case 'near-baseline':
      return 'near baseline';
  }
};

const formatSummaryLabel = (label: AvailableBaselineMetricComparison['label']): string => {
  switch (label) {
    case 'above-baseline':
      return 'above';
    case 'below-baseline':
      return 'below';
    case 'near-baseline':
      return 'near';
  }
};

const getTrustedMetric = (
  baseline: ComparisonBaseline,
  metricName: BaselineMetricName,
): AvailableBaselineMetricComparison | undefined => {
  if (baseline.status !== 'ready') return undefined;

  const metric: BaselineMetricComparison = baseline.metrics[metricName];
  if (metric.label === 'unavailable') return undefined;
  if (metric.sampleSize < trustedSampleSize) return undefined;

  return metric;
};

const buildMetricLine = (
  metricName: BaselineMetricName,
  metric: AvailableBaselineMetricComparison,
): string =>
  `${metricLabels[metricName]}: ${formatMetricValue(metricName, metric.current)}, ${formatBaselineLabel(metric.label)} of ${formatMetricValue(metricName, metric.baselineAverage)} (samples: ${metric.sampleSize})`;

const buildMetricLines = (
  baseline: ComparisonBaseline,
  metricNames: readonly BaselineMetricName[],
): string[] =>
  metricNames.flatMap((metricName) => {
    const metric = getTrustedMetric(baseline, metricName);
    return metric ? [buildMetricLine(metricName, metric)] : [];
  });

const formatMetricList = (metricNames: readonly BaselineMetricName[]): string => {
  const labels = metricNames.map((metricName) => summaryMetricLabels[metricName].label);
  if (labels.length <= 1) return labels[0] ?? '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
};

const baselineNoun = (metricCount: number): string =>
  metricCount === 1 ? 'baseline' : 'baselines';

const selectSummaryMetrics = (
  baseline: ComparisonBaseline,
): Array<{ metricName: BaselineMetricName; metric: AvailableBaselineMetricComparison }> => {
  const visibleByName = new Map<BaselineMetricName, AvailableBaselineMetricComparison>();

  for (const metricName of [...summaryPerformanceMetrics, ...summaryExecutionMetrics]) {
    const metric = getTrustedMetric(baseline, metricName);
    if (metric) visibleByName.set(metricName, metric);
  }

  const nonNearPerformance = summaryPerformanceMetrics
    .filter((metricName) => {
      const metric = visibleByName.get(metricName);
      return metric !== undefined && metric.label !== 'near-baseline';
    })
    .slice(0, 2);
  const nonNearExecution = summaryExecutionMetrics
    .filter((metricName) => {
      const metric = visibleByName.get(metricName);
      return metric !== undefined && metric.label !== 'near-baseline';
    })
    .slice(0, 1);
  const selectedNames = [...nonNearPerformance, ...nonNearExecution];

  if (selectedNames.length === 0) {
    selectedNames.push(
      ...[...summaryPerformanceMetrics, ...summaryExecutionMetrics]
        .filter((metricName) => visibleByName.has(metricName))
        .slice(0, 2),
    );
  }

  return selectedNames.flatMap((metricName) => {
    const metric = visibleByName.get(metricName);
    return metric ? [{ metricName, metric }] : [];
  });
};

const buildSummaryClause = (
  characterName: string,
  label: AvailableBaselineMetricComparison['label'],
  metricNames: readonly BaselineMetricName[],
  isPrimaryClause: boolean,
): string => {
  const metricList = formatMetricList(metricNames);
  const direction = formatSummaryLabel(label);

  if (isPrimaryClause) {
    return `${characterName} is ${direction} recent ${metricList} ${baselineNoun(metricNames.length)}`;
  }

  const onlyMetricName = metricNames[0];
  const verb =
    metricNames.length === 1 && onlyMetricName
      ? summaryMetricLabels[onlyMetricName].verb
      : 'are';
  return `${metricList} ${verb} ${direction} recent ${baselineNoun(metricNames.length)}`;
};

const buildReadySummary = (
  characterName: string,
  baseline: ComparisonBaseline,
): string => {
  const visibleMetrics = selectSummaryMetrics(baseline);

  if (visibleMetrics.length === 0) {
    return 'No trusted metric baseline is available yet.';
  }

  const groups = new Map<AvailableBaselineMetricComparison['label'], BaselineMetricName[]>();
  for (const { metricName, metric } of visibleMetrics) {
    groups.set(metric.label, [...(groups.get(metric.label) ?? []), metricName]);
  }

  const clauses = Array.from(groups.entries()).map(([label, metricNames], index) =>
    buildSummaryClause(characterName, label, metricNames, index === 0),
  );

  return `${clauses[0]}${clauses.length > 1 ? `, while ${clauses.slice(1).join(', and ')}` : ''}.`;
};

const buildSummary = (
  characterName: string,
  baseline: ComparisonBaseline,
): string => {
  if (baseline.status === 'no-history') {
    return `No prior character history was found for ${characterName}.`;
  }

  if (baseline.status === 'insufficient-history') {
    return `Insufficient history for a trusted baseline: ${baseline.sampleSize} prior ${pluralize(baseline.sampleSize, 'report')} found; ${trustedSampleSize} required.`;
  }

  return buildReadySummary(characterName, baseline);
};

const buildSampleSizeLine = (baseline: ComparisonBaseline): string => {
  if (baseline.status !== 'ready') {
    return `Metric sample size: ${baseline.sampleSize} ${pluralize(baseline.sampleSize, 'report')} (trusted threshold: ${trustedSampleSize})`;
  }

  const visibleSamples = [...performanceMetrics, ...executionMetrics].flatMap((metricName) => {
    const metric = getTrustedMetric(baseline, metricName);
    return metric ? [{ label: metricLabels[metricName].toLowerCase(), sampleSize: metric.sampleSize }] : [];
  });

  if (visibleSamples.length === 0) {
    return `Metric sample size: 0 trusted metrics (trusted threshold: ${trustedSampleSize})`;
  }

  const uniqueSampleSizes = new Set(visibleSamples.map((sample) => sample.sampleSize));
  if (uniqueSampleSizes.size === 1) {
    return `Metric sample size: ${visibleSamples[0]?.sampleSize ?? 0}`;
  }

  return `Metric sample sizes: ${visibleSamples
    .map((sample) => `${sample.label} ${sample.sampleSize}`)
    .join(', ')}`;
};

export const buildCompareResponseBody = ({
  characterName,
  mode,
  historyCount,
  baseline,
}: CompareBaselineResponseViewModel): { content: string; flags: number } => {
  const performanceLines = buildMetricLines(baseline, performanceMetrics);
  const executionLines = buildMetricLines(baseline, executionMetrics);

  return {
    flags: EPHEMERAL_MESSAGE_FLAG,
    content: [
      `Comparison: ${characterName}`,
      `Mode: ${mode}`,
      `History: ${historyCount} prior ${pluralize(historyCount, 'report')}`,
      '',
      'Summary:',
      buildSummary(characterName, baseline),
      '',
      'Performance:',
      ...(performanceLines.length > 0
        ? performanceLines
        : ['No trusted performance baseline is available.']),
      '',
      'Execution:',
      ...(executionLines.length > 0
        ? executionLines
        : ['No trusted execution baseline is available.']),
      '',
      'Context:',
      'Compared exact character history only.',
      `Historical reports: ${historyCount}`,
      buildSampleSizeLine(baseline),
    ].join('\n'),
  };
};

export const buildPublicCompareResponseBody = (
  viewModel: CompareBaselineResponseViewModel,
): { content: string } => {
  const { flags: _flags, ...body } = buildCompareResponseBody(viewModel);
  return body;
};

export const buildCompareErrorBody = (content: string): { content: string; flags: number } => ({
  content,
  flags: EPHEMERAL_MESSAGE_FLAG,
});

export const buildMixedCompareUnavailableBody = (): { content: string; flags: number } =>
  buildCompareErrorBody(
    'Mixed comparisons require explicit player-character mapping and are not available yet. Alts are not guessed automatically.',
  );
