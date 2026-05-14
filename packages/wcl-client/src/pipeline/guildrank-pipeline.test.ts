import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectGuildRankSummaryData } from './guildrank-pipeline.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('guildrank pipeline', () => {
  it('uses saved guild/zone input, applies 7d/14d windows, and prefers official progress ranks', async () => {
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('query ZoneResolver')) {
        return {
          data: {
            worldData: {
              zone: {
                id: 100,
                name: 'Throne',
                difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
                encounters: [{ id: 1, name: 'Jinrokh' }, { id: 2, name: 'Council' }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        const start = Number(variables.startTime);
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        if (start === currentStart) {
          return {
            data: {
              reportData: {
                reports: {
                  data: [
                    { code: 'C1', startTime: now - 2 * 24 * 60 * 60 * 1000, endTime: now - 2 * 24 * 60 * 60 * 1000 + 3600000, zone: { id: 100 } },
                  ],
                },
              },
            },
          };
        }

        return {
          data: {
            reportData: {
              reports: {
                data: [
                  { code: 'B1', startTime: now - 10 * 24 * 60 * 60 * 1000, endTime: now - 10 * 24 * 60 * 60 * 1000 + 3600000, zone: { id: 100 } },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        return {
          data: {
            guildData: {
              guild: {
                zoneRankings: {
                  progress: {
                    worldRank: { number: 12 },
                    regionRank: { number: 4 },
                    serverRank: { number: 1 },
                  },
                  speed: {
                    worldRank: { number: 18 },
                    regionRank: { number: 6 },
                    serverRank: { number: 2 },
                  },
                },
              },
            },
          },
        };
      }

      if (query.includes('query ReportIndex')) {
        const code = String(variables.code);
        if (code === 'C1') {
          return {
            data: {
              reportData: {
                report: {
                  title: 'C1',
                  startTime: now,
                  endTime: now + 1000,
                  zone: { id: 100, name: 'Throne', difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }] },
                  fights: [
                    { id: 11, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 0, endTime: 120000, kill: true },
                    { id: 12, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 130000, endTime: 220000, kill: false },
                    { id: 13, encounterID: 2, difficulty: 4, size: 10, name: 'Council', startTime: 230000, endTime: 400000, kill: true },
                  ],
                },
              },
            },
          };
        }

        return {
          data: {
            reportData: {
              report: {
                title: 'B1',
                startTime: now,
                endTime: now + 1000,
                zone: { id: 100, name: 'Throne', difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }] },
                fights: [
                  { id: 31, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 0, endTime: 180000, kill: true },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query ReportTableByType')) {
        const dataType = String(variables.dataType);
        if (dataType !== 'Deaths') {
          return {
            data: {
              reportData: {
                report: {
                  table: {
                    entries: [],
                  },
                },
              },
            },
          };
        }

        const fightIds = Array.isArray(variables.fightIDs) ? (variables.fightIDs as number[]) : [];
        const deathsByFight: Record<number, number> = { 11: 2, 12: 7, 13: 1, 31: 4 };
        const fightId = fightIds[0];
        return {
          data: {
            reportData: {
              report: {
                table: {
                  entries: [{ name: 'Any', deaths: typeof fightId === 'number' ? (deathsByFight[fightId] ?? 0) : 0 }],
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    });

    const summary = await collectGuildRankSummaryData(
      { request } as never,
      {
        guildName: 'Guild',
        guildServerSlug: 'stormrage',
        guildServerRegion: 'us',
        zoneId: 100,
        difficulty: 'heroic',
        size: '10man',
      },
    );

    expect(summary.window.currentStartIso).toBe(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());
    expect(summary.window.currentEndIso).toBe(new Date(now).toISOString());
    expect(summary.window.baselineStartIso).toBe(new Date(now - 21 * 24 * 60 * 60 * 1000).toISOString());
    expect(summary.window.baselineEndIso).toBe(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString());
    expect(summary.progress.ranks).toEqual({ world: 12, region: 4, realm: 1 });
    expect(summary.progress.ranksAvailable).toBe(true);
    expect(summary.progress.sourceLabel).toBe('Official WCL Rankings');
    expect(summary.speed.sourceLabel).toBe('Official WCL Rankings');
    expect(summary.speed.ranks).toEqual({ world: 18, region: 6, realm: 2 });
  });

  it('keeps official speed ranks authoritative when derived speed metrics disagree', async () => {
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('query ZoneResolver')) {
        return {
          data: {
            worldData: {
              zone: {
                id: 100,
                name: 'Throne',
                difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                encounters: [{ id: 1, name: 'Jinrokh' }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        const start = Number(variables.startTime);
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        const code = start === currentStart ? 'C1' : 'B1';
        return {
          data: {
            reportData: {
              reports: {
                data: [{ code, startTime: now - 1000, endTime: now, zone: { id: 100 } }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        return {
          data: {
            guildData: {
              guild: {
                zoneRankings: {
                  progress: {
                    worldRank: { number: 50 },
                    regionRank: { number: 20 },
                    serverRank: { number: 5 },
                  },
                  speed: {
                    worldRank: { number: 999 },
                    regionRank: { number: 250 },
                    serverRank: { number: 20 },
                  },
                },
              },
            },
          },
        };
      }

      if (query.includes('query ReportIndex')) {
        const code = String(variables.code);
        if (code === 'C1') {
          return {
            data: {
              reportData: {
                report: {
                  title: 'C1',
                  startTime: now,
                  endTime: now + 1000,
                  zone: { id: 100, name: 'Throne', difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }] },
                  fights: [
                    { id: 11, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 0, endTime: 260000, kill: true },
                  ],
                },
              },
            },
          };
        }

        return {
          data: {
            reportData: {
              report: {
                title: 'B1',
                startTime: now,
                endTime: now + 1000,
                zone: { id: 100, name: 'Throne', difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }] },
                fights: [
                  { id: 21, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 0, endTime: 110000, kill: true },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query ReportTableByType')) {
        const dataType = String(variables.dataType);
        if (dataType !== 'Deaths') {
          return {
            data: {
              reportData: {
                report: {
                  table: {
                    entries: [],
                  },
                },
              },
            },
          };
        }

        return {
          data: {
            reportData: {
              report: {
                table: {
                  entries: [{ name: 'Any', deaths: 2 }],
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    });

    const summary = await collectGuildRankSummaryData(
      { request } as never,
      {
        guildName: 'Guild',
        guildServerSlug: 'stormrage',
        guildServerRegion: 'us',
        zoneId: 100,
        difficulty: 'heroic',
        size: '10man',
      },
    );

    expect(summary.speed.sourceLabel).toBe('Official WCL Rankings');
    expect(summary.speed.ranks).toEqual({ world: 999, region: 250, realm: 20 });
    expect(summary.notes).not.toContain('Official speed ranks unavailable; showing derived report metrics.');
    expect(summary.speed.overall.bestPercentile).toBe(50);
  });

  it('uses derived fallback speed/execution from successful kills and excludes wipes from fallback metrics while counting wipes in progress', async () => {
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('query ZoneResolver')) {
        return {
          data: {
            worldData: {
              zone: {
                id: 100,
                name: 'Throne',
                difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                encounters: [{ id: 1, name: 'Jinrokh' }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        const start = Number(variables.startTime);
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        const code = start === currentStart ? 'C1' : 'B1';
        return {
          data: {
            reportData: {
              reports: {
                data: [{ code, startTime: now - 1000, endTime: now, zone: { id: 100 } }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        throw new Error('zone rankings unavailable');
      }

      if (query.includes('query ProgressRaceFallback')) {
        throw new Error('progress race unavailable');
      }

      if (query.includes('query ReportIndex')) {
        const code = String(variables.code);
        if (code === 'C1') {
          return {
            data: {
              reportData: {
                report: {
                  title: 'C1',
                  startTime: now,
                  endTime: now + 1000,
                  zone: { id: 100, name: 'Throne', difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }] },
                  fights: [
                    { id: 11, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 0, endTime: 200000, kill: true },
                    { id: 12, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 210000, endTime: 260000, kill: false },
                    { id: 13, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 270000, endTime: 320000, kill: false },
                  ],
                },
              },
            },
          };
        }

        return {
          data: {
            reportData: {
              report: {
                title: 'B1',
                startTime: now,
                endTime: now + 1000,
                zone: { id: 100, name: 'Throne', difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }] },
                fights: [
                  { id: 21, encounterID: 1, difficulty: 4, size: 10, name: 'Jinrokh', startTime: 0, endTime: 100000, kill: true },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query ReportTableByType')) {
        const dataType = String(variables.dataType);
        if (dataType !== 'Deaths') {
          return {
            data: {
              reportData: {
                report: {
                  table: {
                    entries: [],
                  },
                },
              },
            },
          };
        }

        const fightIds = Array.isArray(variables.fightIDs) ? (variables.fightIDs as number[]) : [];
        const deathsByFight: Record<number, number> = {
          11: 5,
          12: 0,
          13: 0,
          21: 1,
        };
        const fightId = fightIds[0];
        return {
          data: {
            reportData: {
              report: {
                table: {
                  entries: [{ name: 'Any', deaths: typeof fightId === 'number' ? (deathsByFight[fightId] ?? 0) : 0 }],
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    });

    const summary = await collectGuildRankSummaryData(
      { request } as never,
      {
        guildName: 'Guild',
        guildServerSlug: 'stormrage',
        guildServerRegion: 'us',
        zoneId: 100,
        difficulty: 'heroic',
        size: '10man',
      },
    );

    expect(summary.progress.ranksAvailable).toBe(false);
    expect(summary.progress.sourceLabel).toBe('Progress Only: Ranking Unavailable');
    expect(summary.progress.pulls).toBe(3);
    expect(summary.progress.wipes).toBe(2);
    expect(summary.speed.sourceLabel).toBe('Derived from WCL Reports');
    expect(summary.execution.sourceLabel).toBe('Derived from WCL Reports');
    expect(summary.notes).toContain(
      'Official progress ranks unavailable; showing derived clear/pull context only.',
    );
    expect(summary.notes).toContain(
      'Official speed ranks unavailable; showing derived report metrics.',
    );

    const speedEncounter = summary.speed.encounters.find((row) => row.encounterName === 'Jinrokh');
    const executionEncounter = summary.execution.encounters.find(
      (row) => row.encounterName === 'Jinrokh',
    );

    expect(speedEncounter?.speed.bestPercentile).toBe(50);
    expect(executionEncounter?.execution.bestPercentile).toBe(50);
  });
});
