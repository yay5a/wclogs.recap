import { describe, expect, it } from 'vitest';
import { buildComparisonBaseline, type ComparisonBaselineRow } from '../index.js';

const currentAllMetrics: ComparisonBaselineRow = {
  rankPercent: 80,
  damageTotal: 1100,
  healingTotal: 900,
  deaths: 1,
  interrupts: 5,
  dispels: 2,
};

const historyAllMetrics: ComparisonBaselineRow[] = [
  {
    rankPercent: 70,
    damageTotal: 1000,
    healingTotal: 1000,
    deaths: 2,
    interrupts: 4,
    dispels: 1,
  },
  {
    rankPercent: 75,
    damageTotal: 1000,
    healingTotal: 1000,
    deaths: 2,
    interrupts: 5,
    dispels: 2,
  },
  {
    rankPercent: 80,
    damageTotal: 1000,
    healingTotal: 1000,
    deaths: 2,
    interrupts: 6,
    dispels: 3,
  },
];

describe('comparison baseline status', () => {
  it('returns no-history with sampleSize 0 for empty history', () => {
    expect(buildComparisonBaseline(currentAllMetrics, [])).toMatchObject({
      status: 'no-history',
      sampleSize: 0,
    });
  });

  it('returns insufficient-history for one historical row', () => {
    expect(buildComparisonBaseline(currentAllMetrics, historyAllMetrics.slice(0, 1))).toMatchObject({
      status: 'insufficient-history',
      sampleSize: 1,
    });
  });

  it('returns insufficient-history for two historical rows', () => {
    expect(buildComparisonBaseline(currentAllMetrics, historyAllMetrics.slice(0, 2))).toMatchObject({
      status: 'insufficient-history',
      sampleSize: 2,
    });
  });

  it('returns ready for three historical rows', () => {
    expect(buildComparisonBaseline(currentAllMetrics, historyAllMetrics)).toMatchObject({
      status: 'ready',
      sampleSize: 3,
    });
  });
});

describe('comparison baseline metric availability', () => {
  it('marks a missing current metric as unavailable', () => {
    const baseline = buildComparisonBaseline({ ...currentAllMetrics, rankPercent: null }, historyAllMetrics);

    expect(baseline.metrics.parse).toEqual({
      label: 'unavailable',
      reason: 'missing-current',
      sampleSize: 3,
    });
    expect(baseline.unavailableMetrics).toContain('parse');
  });

  it('ignores missing historical metric values for that metric', () => {
    const baseline = buildComparisonBaseline(currentAllMetrics, [
      { rankPercent: 70 },
      { rankPercent: null },
      { rankPercent: 80 },
    ]);

    expect(baseline.metrics.parse).toMatchObject({
      label: 'near-baseline',
      baselineAverage: 75,
      sampleSize: 2,
    });
  });

  it('preserves zero current values as valid zeroes', () => {
    const baseline = buildComparisonBaseline({ deaths: 0 }, [{ deaths: 2 }, { deaths: 2 }, { deaths: 2 }]);

    expect(baseline.metrics.deaths).toMatchObject({
      label: 'below-baseline',
      current: 0,
      baselineAverage: 2,
      delta: -2,
    });
  });

  it('preserves zero historical values as valid zeroes', () => {
    const baseline = buildComparisonBaseline(
      { damageTotal: 0 },
      [{ damageTotal: 0 }, { damageTotal: 0 }, { damageTotal: 0 }],
    );

    expect(baseline.metrics.damageTotal).toMatchObject({
      label: 'near-baseline',
      current: 0,
      baselineAverage: 0,
      delta: 0,
    });
  });
});

describe('comparison baseline parse metrics', () => {
  it('labels parse above baseline', () => {
    const baseline = buildComparisonBaseline({ rankPercent: 90 }, [
      { rankPercent: 70 },
      { rankPercent: 75 },
      { rankPercent: 80 },
    ]);

    expect(baseline.metrics.parse).toMatchObject({
      label: 'above-baseline',
      baselineAverage: 75,
      delta: 15,
      favorableDirection: 'higher',
    });
  });

  it('labels parse below baseline', () => {
    const baseline = buildComparisonBaseline({ rankPercent: 60 }, [
      { rankPercent: 70 },
      { rankPercent: 75 },
      { rankPercent: 80 },
    ]);

    expect(baseline.metrics.parse).toMatchObject({
      label: 'below-baseline',
      baselineAverage: 75,
      delta: -15,
    });
  });

  it('labels parse near baseline', () => {
    const baseline = buildComparisonBaseline({ rankPercent: 79 }, [
      { rankPercent: 70 },
      { rankPercent: 75 },
      { rankPercent: 80 },
    ]);

    expect(baseline.metrics.parse).toMatchObject({
      label: 'near-baseline',
      baselineAverage: 75,
      delta: 4,
    });
  });
});

describe('comparison baseline output totals', () => {
  it('labels damage total above baseline using percent threshold', () => {
    const baseline = buildComparisonBaseline({ damageTotal: 1200 }, [
      { damageTotal: 1000 },
      { damageTotal: 1000 },
      { damageTotal: 1000 },
    ]);

    expect(baseline.metrics.damageTotal).toMatchObject({
      label: 'above-baseline',
      baselineAverage: 1000,
      delta: 200,
      deltaPercent: 20,
      favorableDirection: 'higher',
    });
  });

  it('labels damage total below baseline using percent threshold', () => {
    const baseline = buildComparisonBaseline({ damageTotal: 850 }, [
      { damageTotal: 1000 },
      { damageTotal: 1000 },
      { damageTotal: 1000 },
    ]);

    expect(baseline.metrics.damageTotal).toMatchObject({
      label: 'below-baseline',
      baselineAverage: 1000,
      delta: -150,
      deltaPercent: -15,
    });
  });

  it('labels damage total near baseline using percent threshold', () => {
    const baseline = buildComparisonBaseline({ damageTotal: 1090 }, [
      { damageTotal: 1000 },
      { damageTotal: 1000 },
      { damageTotal: 1000 },
    ]);

    expect(baseline.metrics.damageTotal).toMatchObject({
      label: 'near-baseline',
      baselineAverage: 1000,
      delta: 90,
      deltaPercent: 9,
    });
  });

  it('labels healing total above baseline using percent threshold', () => {
    const baseline = buildComparisonBaseline({ healingTotal: 1200 }, [
      { healingTotal: 1000 },
      { healingTotal: 1000 },
      { healingTotal: 1000 },
    ]);

    expect(baseline.metrics.healingTotal).toMatchObject({
      label: 'above-baseline',
      baselineAverage: 1000,
      delta: 200,
      deltaPercent: 20,
      favorableDirection: 'higher',
    });
  });

  it('labels healing total below baseline using percent threshold', () => {
    const baseline = buildComparisonBaseline({ healingTotal: 850 }, [
      { healingTotal: 1000 },
      { healingTotal: 1000 },
      { healingTotal: 1000 },
    ]);

    expect(baseline.metrics.healingTotal).toMatchObject({
      label: 'below-baseline',
      baselineAverage: 1000,
      delta: -150,
      deltaPercent: -15,
    });
  });

  it('labels healing total near baseline using percent threshold', () => {
    const baseline = buildComparisonBaseline({ healingTotal: 1090 }, [
      { healingTotal: 1000 },
      { healingTotal: 1000 },
      { healingTotal: 1000 },
    ]);

    expect(baseline.metrics.healingTotal).toMatchObject({
      label: 'near-baseline',
      baselineAverage: 1000,
      delta: 90,
      deltaPercent: 9,
    });
  });
});

describe('comparison baseline execution counts', () => {
  it('labels deaths lower than baseline and marks lower as favorable', () => {
    const baseline = buildComparisonBaseline({ deaths: 0 }, [{ deaths: 2 }, { deaths: 2 }, { deaths: 2 }]);

    expect(baseline.metrics.deaths).toMatchObject({
      label: 'below-baseline',
      baselineAverage: 2,
      delta: -2,
      favorableDirection: 'lower',
    });
  });

  it('labels deaths higher than baseline', () => {
    const baseline = buildComparisonBaseline({ deaths: 4 }, [{ deaths: 2 }, { deaths: 2 }, { deaths: 2 }]);

    expect(baseline.metrics.deaths).toMatchObject({
      label: 'above-baseline',
      baselineAverage: 2,
      delta: 2,
      favorableDirection: 'lower',
    });
  });

  it('labels interrupts near baseline', () => {
    const baseline = buildComparisonBaseline({ interrupts: 5 }, [
      { interrupts: 4 },
      { interrupts: 5 },
      { interrupts: 6 },
    ]);

    expect(baseline.metrics.interrupts).toMatchObject({
      label: 'near-baseline',
      baselineAverage: 5,
      delta: 0,
      favorableDirection: 'higher',
    });
  });

  it('labels dispels near baseline', () => {
    const baseline = buildComparisonBaseline({ dispels: 3 }, [
      { dispels: 2 },
      { dispels: 3 },
      { dispels: 4 },
    ]);

    expect(baseline.metrics.dispels).toMatchObject({
      label: 'near-baseline',
      baselineAverage: 3,
      delta: 0,
      favorableDirection: 'higher',
    });
  });
});

describe('comparison baseline zero division handling', () => {
  it('does not divide by zero unsafely for positive current values against zero baseline', () => {
    const baseline = buildComparisonBaseline(
      { healingTotal: 10 },
      [{ healingTotal: 0 }, { healingTotal: 0 }, { healingTotal: 0 }],
    );

    expect(baseline.metrics.healingTotal).toMatchObject({
      label: 'above-baseline',
      current: 10,
      baselineAverage: 0,
      delta: 10,
    });
    expect('deltaPercent' in baseline.metrics.healingTotal).toBe(false);
  });
});
