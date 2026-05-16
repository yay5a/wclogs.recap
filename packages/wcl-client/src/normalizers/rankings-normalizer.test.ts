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

  it('uses WCL-provided aggregate averages instead of deriving averages from rankPercent rows', () => {
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
      { playerName: 'Banson', value: 75.2 },
    ]);
  });
});
