import { describe, expect, it, vi } from 'vitest';
import { collectReportRankings } from './report-rankings-collector.js';

describe('report rankings collector', () => {
  it('asks WCL to scope rankings to kill fight IDs and returns native dps/hps rows', async () => {
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
                      tanks: {
                        characters: [{ name: 'Tanky', amount: 100, rankPercent: 70 }],
                      },
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
      }));

    const result = await collectReportRankings({ request } as never, {
      reportCode: 'ABC123',
      killFightIds: [11],
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, expect.any(String), {
      code: 'ABC123',
      allowUnlisted: true,
      fightIDs: [11],
      playerMetric: 'dps',
    });
    expect(request).toHaveBeenNthCalledWith(2, expect.any(String), {
      code: 'ABC123',
      allowUnlisted: true,
      fightIDs: [11],
      playerMetric: 'hps',
    });
    expect(result.dps).toHaveLength(1);
    expect(result.hps).toHaveLength(1);
    expect(result).not.toHaveProperty('tankDps');
  });
});
