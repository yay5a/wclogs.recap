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

  it('prefers zoneRankings when available', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        guildData: {
          guild: {
            zoneRankings: {
              progress: {
                worldRank: { number: 5 },
                regionRank: { number: 2 },
                serverRank: { number: 1 },
              },
              speed: {
                worldRank: { number: 9 },
                regionRank: { number: 3 },
                serverRank: { number: 1 },
              },
            },
          },
        },
      },
    });

    const result = await collectOfficialGuildZoneRankings({ request } as never, input);
    expect(result).toEqual({
      progress: { world: 5, region: 2, realm: 1 },
      speed: { world: 9, region: 3, realm: 1 },
      source: 'zoneRankings',
    });
  });

  it('falls back to progressRaceData when zoneRankings is unavailable', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('missing field'))
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
      speed: {},
      source: 'progressRaceData',
    });
  });
});
