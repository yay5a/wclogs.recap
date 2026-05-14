import { describe, expect, it, vi } from 'vitest';
import { collectReportRankings } from './report-rankings-collector.js';

describe('report rankings collector', () => {
  it('returns available metrics when one ranking metric request fails', async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async () => ({
        data: {
          reportData: {
            report: {
              rankings: {
                data: [
                  {
                    fightID: 11,
                    encounter: { name: 'Boss A' },
                    roles: {
                      dps: {
                        characters: [{ name: 'Damage', amount: 123, rankPercent: 90 }],
                      },
                      healers: { characters: [] },
                      tanks: { characters: [] },
                    },
                  },
                ],
              },
            },
          },
        },
      }))
      .mockImplementationOnce(async () => ({
        data: {
          reportData: {
            report: {
              rankings: {
                data: [
                  {
                    fightID: 11,
                    encounter: { name: 'Boss A' },
                    roles: {
                      dps: { characters: [] },
                      healers: {
                        characters: [{ name: 'Healer', amount: 321, rankPercent: 80 }],
                      },
                      tanks: { characters: [] },
                    },
                  },
                ],
              },
            },
          },
        },
      }))
      .mockRejectedValueOnce(new Error('krsi unavailable'));

    const result = await collectReportRankings(
      { request } as never,
      { reportCode: 'ABC123', killFightIds: [11] },
    );

    expect(request).toHaveBeenCalledTimes(3);
    expect(result.dps).toHaveLength(1);
    expect(result.hps).toHaveLength(1);
    expect(result.krsi).toEqual([]);
  });
});
