import { describe, expect, it } from 'vitest';
import { buildRecapSummary } from './index.js';

describe('buildRecapSummary', () => {
  it('omits most improved when no prior data', () => {
    const summary = buildRecapSummary({
      reportCode: 'abc',
      title: 'Raid Night',
      startTime: Date.now(),
      endTime: Date.now(),
      gameFamily: 'retail',
      comparisonMode: 'character',
      sourceHost: 'www.warcraftlogs.com',
      fights: [{ id: 1, name: 'Boss', startTime: 0, endTime: 1, kill: true }],
      players: [
        {
          id: '1',
          name: 'A',
          performance: { averageParseAcrossKills: 75, bestSingleBossParse: 90 },
          execution: { executionScore: 88 },
        },
      ],
    });

    expect(summary.mostImprovedPlayer).toBeUndefined();
  });

  it('calculates best metrics from normalized performance/execution fields', () => {
    const summary = buildRecapSummary(
      {
        reportCode: 'abc',
        title: 'Raid Night',
        startTime: Date.now(),
        endTime: Date.now(),
        gameFamily: 'retail',
        comparisonMode: 'character',
        sourceHost: 'www.warcraftlogs.com',
        fights: [
          { id: 1, name: 'Boss1', startTime: 0, endTime: 1, kill: true },
          { id: 2, name: 'Boss2', startTime: 0, endTime: 1, kill: true },
        ],
        players: [
          {
            id: '1',
            name: 'A',
            performance: { averageParseAcrossKills: 75, bestSingleBossParse: 90 },
            execution: { executionScore: 70 },
          },
          {
            id: '2',
            name: 'B',
            performance: { averageParseAcrossKills: 85, bestSingleBossParse: 80 },
            execution: { executionScore: 95 },
          },
        ],
      },
      [
        {
          id: '1',
          name: 'A',
          performance: { averageParseAcrossKills: 70 },
          execution: {},
        },
        {
          id: '2',
          name: 'B',
          performance: { averageParseAcrossKills: 86 },
          execution: {},
        },
      ],
    );

    expect(summary.bestSingleBossParse?.playerName).toBe('A');
    expect(summary.bestAverageParse?.playerName).toBe('B');
    expect(summary.bestExecution?.playerName).toBe('B');
    expect(summary.mostImprovedPlayer?.playerName).toBe('A');
  });
});
