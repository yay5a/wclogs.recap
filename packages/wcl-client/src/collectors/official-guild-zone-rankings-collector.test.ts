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

  it('queries zoneRanking(zoneId) and maps official rank positions', async () => {
    const request = vi
      .fn()
      .mockImplementation((query: string, variables: Record<string, unknown>) => {
        expect(query).toContain('zoneRanking(zoneId: $zoneId)');
        expect(query).toContain('speed(size: $size, difficulty: $difficulty)');
        expect(query).toContain('completeRaidSpeed(size: $size, difficulty: $difficulty)');
        expect(query).not.toContain('percentile');
        expect(query).not.toContain('zoneRanking(');
        expect(query).not.toContain('zoneId:');
        expect(variables).toEqual({
          guildName: 'Guild',
          guildServerSlug: 'stormrage',
          guildServerRegion: 'US',
          zoneId: 100,
          difficulty: 4,
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
                  speed: {
                    worldRank: { number: 1273 },
                    regionRank: { number: 489 },
                    serverRank: { number: 296 },
                  },
                  completeRaidSpeed: {
                    worldRank: { number: 389 },
                    regionRank: { number: 136 },
                    serverRank: { number: 120 },
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
      speed: { world: 1273, region: 489, realm: 296 },
      completeRaidSpeed: { world: 389, region: 136, realm: 120 },
      source: 'zoneRanking',
      progressSource: 'zoneRanking',
    });
  });

  it('falls back to explicit progressRace rank fields when zoneRanking progress is unavailable', async () => {
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
      .mockImplementationOnce((query: string, variables: Record<string, unknown>) => {
        expect(query).toContain('progressRace(');
        expect(query).toContain('zoneId: $zoneId');
        expect(variables).toMatchObject({ zoneId: 100 });
        return {
          data: {
            progressRaceData: {
              progressRace: {
                worldRank: 42,
                regionRank: { number: 12 },
                serverRank: 3,
              },
            },
          },
        };
      });

    const result = await collectOfficialGuildZoneRankings({ request } as never, input);

    expect(result).toEqual({
      progress: { world: 42, region: 12, realm: 3 },
      speed: {},
      completeRaidSpeed: {},
      source: 'progressRaceData',
      progressSource: 'progressRaceData',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable ranks when explicit progressRace rank fields are missing', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: { guildData: { guild: { zoneRanking: {} } } } })
      .mockResolvedValueOnce({
        data: {
          progressRaceData: {
            progressRace: {
              nested: {
                worldRankGuess: 1,
                regionRankGuess: 2,
                serverRankGuess: 3,
              },
            },
          },
        },
      });

    const result = await collectOfficialGuildZoneRankings({ request } as never, input);

    expect(result).toEqual({
      progress: {},
      speed: {},
      completeRaidSpeed: {},
      source: 'unavailable',
      progressSource: 'unavailable',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable ranks when progressRace payload is incompatible', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('zoneRanking unavailable'))
      .mockResolvedValueOnce({
        data: {
          progressRaceData: {
            progressRace: 'not json',
          },
        },
      });

    const result = await collectOfficialGuildZoneRankings({ request } as never, input);

    expect(result).toEqual({
      progress: {},
      speed: {},
      completeRaidSpeed: {},
      source: 'unavailable',
      progressSource: 'unavailable',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
