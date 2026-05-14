import { describe, expect, it, vi } from 'vitest';
import { collectOfficialGuildZoneRankings } from './official-guild-zone-rankings-collector.js';

describe('official guild/zone rankings collector', () => {
  const input = {
    guildName: 'Guild',
    guildServerSlug: 'stormrage',
    guildServerRegion: 'us',
    zoneId: 100,
    difficulty: 4,
    size: 10,
  };

  it('queries zoneRanking(zoneId) and maps official progress rank positions', async () => {
    const request = vi.fn().mockImplementation((query: string, variables: Record<string, unknown>) => {
      expect(query).toContain('zoneRanking(zoneId: $zoneId)');
      expect(query).not.toContain('zoneRankings');
      expect(query).not.toContain('zoneID: $zoneId');
      expect(variables).toEqual({
        guildName: 'Guild',
        guildServerSlug: 'stormrage',
        guildServerRegion: 'US',
        zoneId: 100,
        size: 10,
      });

      return {
        data: {
          guildData: {
            guild: {
              zoneRanking: {
                progress: {
                  worldRank: { number: 868 },
                  regionRank: { number: 279 },
                  serverRank: { number: 241 },
                },
              },
            },
          },
        },
      };
    });

    const result = await collectOfficialGuildZoneRankings({ request } as never, input);

    expect(result).toEqual({
      progress: { world: 868, region: 279, realm: 241 },
      source: 'zoneRanking',
      progressSource: 'zoneRanking',
    });
  });

  it('falls back to progressRaceData when zoneRanking progress is unavailable', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          guildData: {
            guild: {
              zoneRanking: {},
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          progressRaceData: {
            progressRace: {
              worldRank: 33,
              regionRank: 7,
              serverRank: 3,
            },
          },
        },
      });

    const result = await collectOfficialGuildZoneRankings({ request } as never, input);

    expect(result).toEqual({
      progress: { world: 33, region: 7, realm: 3 },
      source: 'progressRaceData',
      progressSource: 'progressRaceData',
    });
  });
});
