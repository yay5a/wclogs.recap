import { describe, expect, it, vi } from 'vitest';
import {
  collectReportRankingEnrichment,
  getReportRankingEnrichmentQueryHashes,
} from './report-ranking-enrichment-collector.js';

describe('report ranking enrichment collector', () => {
  it('fetches bounded timeframe/compare combinations and normalizes fight facts', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        reportData: {
          report: {
            rankings: {
              data: [
                {
                  fightID: 11,
                  speed: 93.2,
                  execution: 81.4,
                  rank: 12,
                  outOf: 200,
                  duration: 321000,
                },
              ],
            },
          },
        },
      },
    });

    const result = await collectReportRankingEnrichment({ request } as never, {
      reportCode: 'ABC123',
      reportStartTime: 1_700_000_000_000,
      fights: [
        {
          fightId: 11,
          encounterId: 101,
          difficulty: 5,
          size: 25,
          kill: true,
        },
      ],
      timeframes: ['today'],
      compareModes: ['rankings'],
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      code: 'ABC123',
      allowUnlisted: true,
      fightIDs: [11],
      timeframe: 'Today',
      compare: 'Rankings',
      playerMetric: 'playerspeed',
    });
    expect(result.rawPayloads).toHaveLength(1);
    expect(result.rawPayloads[0]).toMatchObject({
      reportCode: 'ABC123',
      timeframe: 'today',
      compareMode: 'rankings',
      payloadJson: {
        data: [
          {
            fightID: 11,
            speed: 93.2,
            execution: 81.4,
            rank: 12,
            outOf: 200,
            duration: 321000,
          },
        ],
      },
    });
    expect(result.rawPayloads[0]?.queryVarsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.rawPayloads[0]?.queryVarsHash).toBe(
      getReportRankingEnrichmentQueryHashes({
        reportCode: 'ABC123',
        fights: [
          {
            fightId: 11,
            encounterId: 101,
            difficulty: 5,
            size: 25,
            kill: true,
          },
        ],
        timeframes: ['today'],
        compareModes: ['rankings'],
      })[0],
    );
    expect(result.facts).toEqual([
      expect.objectContaining({
        reportCode: 'ABC123',
        reportStartTime: 1_700_000_000_000,
        fightId: 11,
        encounterId: 101,
        difficulty: 5,
        size: 25,
        timeframe: 'today',
        compareMode: 'rankings',
        speedPercentile: 93.2,
        executionPercentile: 81.4,
        rank: 12,
        outOf: 200,
        durationMs: 321000,
        kill: true,
      }),
    ]);
    expect(result.contexts).toEqual([{ timeframe: 'today', compareMode: 'rankings' }]);
  });

  it('marks ranked wipe rows when the source returns a non-kill fight', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        reportData: {
          report: {
            rankings: {
              data: [{ fightID: 22, executionScore: 55.5 }],
            },
          },
        },
      },
    });

    const result = await collectReportRankingEnrichment({ request } as never, {
      reportCode: 'ABC123',
      reportStartTime: 1_700_000_000_000,
      fights: [
        {
          fightId: 22,
          encounterId: 102,
          difficulty: 5,
          size: 25,
          kill: false,
        },
      ],
      timeframes: ['historical'],
      compareModes: ['rankings'],
    });

    expect(result.facts[0]).toMatchObject({
      fightId: 22,
      kill: false,
      isWipeRanked: true,
      executionPercentile: 55.5,
    });
  });

  it('reads nested speed and execution metric objects', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        reportData: {
          report: {
            rankings: {
              data: [
                {
                  fightID: 33,
                  speed: {
                    rankPercent: 97.6,
                    rank: 4,
                    totalParses: 321,
                  },
                  execution: {
                    rankPercent: 88.1,
                    rank: 9,
                    totalParses: 300,
                  },
                  executionRank: 9,
                },
              ],
            },
          },
        },
      },
    });

    const result = await collectReportRankingEnrichment({ request } as never, {
      reportCode: 'ABC123',
      reportStartTime: 1_700_000_000_000,
      fights: [
        {
          fightId: 33,
          encounterId: 103,
          difficulty: 5,
          size: 25,
          kill: true,
        },
      ],
      timeframes: ['today'],
      compareModes: ['rankings'],
    });

    expect(result.facts[0]).toMatchObject({
      fightId: 33,
      speedPercentile: 97.6,
      executionPercentile: 88.1,
      rank: 4,
      outOf: 321,
    });
  });
});
