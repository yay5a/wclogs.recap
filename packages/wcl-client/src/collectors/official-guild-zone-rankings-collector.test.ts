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
      progressSource: 'zoneRankings',
      speedSource: 'zoneRankings',
      executionSource: 'unavailable',
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
      progressSource: 'progressRaceData',
      speedSource: 'unavailable',
      executionSource: 'unavailable',
    });
  });

  it('queries official speed and execution fight rankings with mapped size, difficulty, and partition', async () => {
    const seenMetrics: unknown[] = [];
    const request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('query GuildZoneRanks')) {
        return { data: { guildData: { guild: { zoneRankings: {} } } } };
      }

      if (query.includes('query ProgressRaceFallback')) {
        return { data: { progressRaceData: { progressRace: null } } };
      }

      if (query.includes('query OfficialGuildEncounterRankings')) {
        expect(variables.difficulty).toBe(4);
        expect(variables.size).toBe(10);
        expect(variables.partition).toBe(4);
        expect(variables.serverSlug).toBe('stormrage');
        expect(variables.serverRegion).toBe('US');
        seenMetrics.push(variables.metric);
        return {
          data: {
            worldData: {
              encounter: {
                fightRankings: {
                  rankings: [
                    {
                      guild: {
                        name: 'Guild',
                        server: { slug: 'stormrage', region: { name: 'US' } },
                      },
                      percentile: variables.metric === 'speed' ? 91 : 84,
                    },
                  ],
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    });

    const result = await collectOfficialGuildZoneRankings(
      { request, getAuthModeKind: () => 'userLinked' } as never,
      {
        ...input,
        partition: 4,
        encounters: [{ id: 1, name: 'Jinrokh' }],
      },
    );

    expect(seenMetrics).toEqual(['speed', 'execution']);
    expect(result.speedMetrics?.overallBestPercentile).toBe(91);
    expect(result.executionMetrics?.overallBestPercentile).toBe(84);
    expect(result.speedSource).toBe('fightRankings');
    expect(result.executionSource).toBe('fightRankings');
  });
});
