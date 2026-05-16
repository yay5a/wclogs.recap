import { describe, expect, it } from 'vitest';
import { normalizeRankings } from './rankings-normalizer.js';

describe('rankings normalizer', () => {
  it('selects the highest parse and keeps the lexicographic player-name tie-break', () => {
    const result = normalizeRankings({
      dps: [
        { scope: 'report', metric: 'rankPercent', value: 95, playerName: 'Zed', rankPercent: 95 },
        { scope: 'report', metric: 'rankPercent', value: 95, playerName: 'Alyra', rankPercent: 95 },
        { scope: 'report', metric: 'rankPercent', value: 99, playerName: 'Missing' },
      ],
      hps: [],
    });

    expect(result.highestParses.dps).toMatchObject({ playerName: 'Alyra', value: 95 });
    expect(result.highestParses.hps).toBeUndefined();
  });

  it('prefers WCL-provided aggregate averages and falls back to rankPercent averages', () => {
    const result = normalizeRankings({
      dps: [
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 79.8,
          playerName: 'Raikami',
          rankPercent: 79.8,
          performanceAverage: 82.4,
        },
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 100,
          playerName: 'DerivedOnly',
          rankPercent: 100,
        },
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 60,
          playerName: 'DerivedOnly',
          rankPercent: 60,
        },
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 70,
          playerName: 'Raikami',
          rankPercent: 70,
          performanceAverage: 82.4,
        },
      ],
      hps: [
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 67.7,
          playerName: 'Banson',
          rankPercent: 67.7,
          performanceAverage: 75.2,
        },
      ],
    });

    expect(result.highestAverageParse).toEqual([
      { playerName: 'Raikami', value: 82.4 },
      { playerName: 'DerivedOnly', value: 80 },
      { playerName: 'Banson', value: 75.2 },
    ]);
  });

  it('keeps DPS and HPS rankPercent averages separate before combining candidates', () => {
    const result = normalizeRankings({
      dps: [
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 100,
          playerName: 'Hybrid',
          rankPercent: 100,
        },
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 80,
          playerName: 'Hybrid',
          rankPercent: 80,
        },
      ],
      hps: [
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 20,
          playerName: 'Hybrid',
          rankPercent: 20,
        },
        {
          scope: 'report',
          metric: 'rankPercent',
          value: 40,
          playerName: 'Hybrid',
          rankPercent: 40,
        },
      ],
    });

    expect(result.highestAverageParse).toEqual([{ playerName: 'Hybrid', value: 90 }]);
  });
});
