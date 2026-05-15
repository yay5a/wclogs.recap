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
});
