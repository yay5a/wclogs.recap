import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectGuildRankSummaryData } from './guildrank-pipeline.js';
import type {
  GuildRankLiveReportIndexFetcher,
  GuildRankReportMetadataRow,
} from './guildrank-candidate-selector.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const pipelineOptionsFor = (rows: GuildRankReportMetadataRow[]) => ({
  liveReportIndexFetcher: vi.fn(async () => rows),
});

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
                encounters: [
                  { id: 1, name: 'Jinrokh' },
                  { id: 2, name: 'Council' },
                ],
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
                    {
                      code: 'C1',
                      startTime: now - 2 * 24 * 60 * 60 * 1000,
                      endTime: now - 2 * 24 * 60 * 60 * 1000 + 3600000,
                      zone: { id: 100 },
                    },
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
                  {
                    code: 'B1',
                    startTime: now - 10 * 24 * 60 * 60 * 1000,
                    endTime: now - 10 * 24 * 60 * 60 * 1000 + 3600000,
                    zone: { id: 100 },
                  },
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
                  completeRaidSpeed: {
                    worldRank: { number: 8 },
                    regionRank: { number: 3 },
                    serverRank: { number: 1 },
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
                  zone: {
                    id: 100,
                    name: 'Throne',
                    difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
                  },
                  fights: [
                    {
                      id: 11,
                      encounterID: 1,
                      difficulty: 4,
                      size: 10,
                      name: 'Jinrokh',
                      startTime: 0,
                      endTime: 120000,
                      kill: true,
                    },
                    {
                      id: 12,
                      encounterID: 1,
                      difficulty: 4,
                      size: 10,
                      name: 'Jinrokh',
                      startTime: 130000,
                      endTime: 220000,
                      kill: false,
                    },
                    {
                      id: 13,
                      encounterID: 2,
                      difficulty: 4,
                      size: 10,
                      name: 'Council',
                      startTime: 230000,
                      endTime: 400000,
                      kill: true,
                    },
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
                zone: {
                  id: 100,
                  name: 'Throne',
                  difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
                },
                fights: [
                  {
                    id: 31,
                    encounterID: 1,
                    difficulty: 4,
                    size: 10,
                    name: 'Jinrokh',
                    startTime: 0,
                    endTime: 180000,
                    kill: true,
                  },
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
                  entries: [
                    {
                      name: 'Any',
                      deaths: typeof fightId === 'number' ? (deathsByFight[fightId] ?? 0) : 0,
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
      pipelineOptionsFor([
        {
          reportCode: 'C1',
          zoneId: 100,
          startTime: now - 2 * DAY_MS,
          endTime: now - 2 * DAY_MS + 3600000,
        },
        {
          reportCode: 'B1',
          zoneId: 100,
          startTime: now - 10 * DAY_MS,
          endTime: now - 10 * DAY_MS + 3600000,
        },
      ]),
    );

    expect(summary.window.currentStartIso).toBe(
      new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(summary.window.currentEndIso).toBe(new Date(now).toISOString());
    expect(summary.window.baselineStartIso).toBe(
      new Date(now - 21 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(summary.window.baselineEndIso).toBe(
      new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(summary.progress.ranks).toEqual({ world: 12, region: 4, realm: 1 });
    expect(summary.speed.ranks).toEqual({ world: 18, region: 6, realm: 2 });
    expect(summary.speed.completeRaidRanks).toEqual({ world: 8, region: 3, realm: 1 });
    expect(summary.progress.ranksAvailable).toBe(true);
    expect(summary.progress.sourceLabel).toBe('Official WCL Rankings');
    expect(summary.notes).not.toContain(
      'Official progress ranks unavailable; showing derived clear/pull context only.',
    );
    expect(summary.speed.sourceLabel).toBe('Derived from WCL Reports');
    expect(summary.execution.sourceLabel).toBe('Derived from WCL Reports');
  });

  it('keeps Speed and Execution as derived relative percentiles when official percentiles are unavailable', async () => {
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
                partitions: [{ id: 4, name: 'Phase 4', compactName: 'P4', default: true }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        const start = Number(variables.startTime);
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        const isCurrent = start === currentStart;
        const code = isCurrent ? 'C1' : 'B1';
        const reportStart = isCurrent ? now - 1000 : now - 10 * 24 * 60 * 60 * 1000;
        return {
          data: {
            reportData: {
              reports: {
                data: [
                  { code, startTime: reportStart, endTime: reportStart + 1000, zone: { id: 100 } },
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
                    worldRank: { number: 50 },
                    regionRank: { number: 20 },
                    serverRank: { number: 5 },
                  },
                  speed: {
                    worldRank: { number: 999 },
                    regionRank: { number: 250 },
                    serverRank: { number: 20 },
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
                  zone: {
                    id: 100,
                    name: 'Throne',
                    difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                  },
                  fights: [
                    {
                      id: 11,
                      encounterID: 1,
                      difficulty: 4,
                      size: 10,
                      name: 'Jinrokh',
                      startTime: 0,
                      endTime: 260000,
                      kill: true,
                    },
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
                zone: {
                  id: 100,
                  name: 'Throne',
                  difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                },
                fights: [
                  {
                    id: 21,
                    encounterID: 1,
                    difficulty: 4,
                    size: 10,
                    name: 'Jinrokh',
                    startTime: 0,
                    endTime: 110000,
                    kill: true,
                  },
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
      pipelineOptionsFor([
        {
          reportCode: 'C1',
          zoneId: 100,
          startTime: now - 1000,
          endTime: now,
        },
        {
          reportCode: 'B1',
          zoneId: 100,
          startTime: now - 10 * DAY_MS,
          endTime: now - 10 * DAY_MS + 1000,
        },
      ]),
    );

    expect(summary.progress.ranks).toEqual({ world: 50, region: 20, realm: 5 });
    expect(summary.progress.sourceLabel).toBe('Official WCL Rankings');
    expect(summary.speed.sourceLabel).toBe('Derived from WCL Reports');
    expect(summary.speed.ranks).toEqual({ world: 999, region: 250, realm: 20 });
    expect(summary.speed.completeRaidRanks).toEqual({ world: 389, region: 136, realm: 120 });
    expect(summary.notes).toContain(
      'Derived relative percentiles are computed from sampled report windows, not official leaderboard percentiles.',
    );
    expect(summary.speed.overall.bestDerivedPercentile).toBe(50);
    expect(summary.execution.sourceLabel).toBe('Derived from WCL Reports');
    expect(summary.execution.overall.bestDerivedPercentile).toBe(100);
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
        const isCurrent = start === currentStart;
        const code = isCurrent ? 'C1' : 'B1';
        const reportStart = isCurrent ? now - 1000 : now - 10 * 24 * 60 * 60 * 1000;
        return {
          data: {
            reportData: {
              reports: {
                data: [
                  { code, startTime: reportStart, endTime: reportStart + 1000, zone: { id: 100 } },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        throw new Error('zone rankings unavailable');
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
                  zone: {
                    id: 100,
                    name: 'Throne',
                    difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                  },
                  fights: [
                    {
                      id: 11,
                      encounterID: 1,
                      difficulty: 4,
                      size: 10,
                      name: 'Jinrokh',
                      startTime: 0,
                      endTime: 200000,
                      kill: true,
                    },
                    {
                      id: 12,
                      encounterID: 1,
                      difficulty: 4,
                      size: 10,
                      name: 'Jinrokh',
                      startTime: 210000,
                      endTime: 260000,
                      kill: false,
                    },
                    {
                      id: 13,
                      encounterID: 1,
                      difficulty: 4,
                      size: 10,
                      name: 'Jinrokh',
                      startTime: 270000,
                      endTime: 320000,
                      kill: false,
                    },
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
                zone: {
                  id: 100,
                  name: 'Throne',
                  difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                },
                fights: [
                  {
                    id: 21,
                    encounterID: 1,
                    difficulty: 4,
                    size: 10,
                    name: 'Jinrokh',
                    startTime: 0,
                    endTime: 100000,
                    kill: true,
                  },
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
                  entries: [
                    {
                      name: 'Any',
                      deaths: typeof fightId === 'number' ? (deathsByFight[fightId] ?? 0) : 0,
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
      pipelineOptionsFor([
        {
          reportCode: 'C1',
          zoneId: 100,
          startTime: now - 1000,
          endTime: now,
        },
        {
          reportCode: 'B1',
          zoneId: 100,
          startTime: now - 10 * DAY_MS,
          endTime: now - 10 * DAY_MS + 1000,
        },
      ]),
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
      'Derived relative percentiles are computed from sampled report windows, not official leaderboard percentiles.',
    );

    const speedEncounter = summary.speed.encounters.find((row) => row.encounterName === 'Jinrokh');
    const executionEncounter = summary.execution.encounters.find(
      (row) => row.encounterName === 'Jinrokh',
    );

    expect(speedEncounter?.speed.bestDerivedPercentile).toBe(50);
    expect(executionEncounter?.execution.bestDerivedPercentile).toBe(50);
  });

  it('adds a precise note when current-window reports are discovered but filtered out by difficulty/size', async () => {
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
                encounters: [{ id: 1, name: 'Jinrokh' }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        const start = Number(variables.startTime);
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        const isCurrent = start === currentStart;
        const code = isCurrent ? 'C1' : 'B1';
        const reportStart = isCurrent ? now - 1000 : now - 10 * 24 * 60 * 60 * 1000;
        return {
          data: {
            reportData: {
              reports: {
                data: [
                  { code, startTime: reportStart, endTime: reportStart + 1000, zone: { id: 100 } },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        throw new Error('zone rankings unavailable');
      }

      if (query.includes('query ReportIndex')) {
        return {
          data: {
            reportData: {
              report: {
                title: 'C1',
                startTime: now,
                endTime: now + 1000,
                zone: {
                  id: 100,
                  name: 'Throne',
                  difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
                },
                fights: [
                  {
                    id: 11,
                    encounterID: 1,
                    difficulty: 4,
                    size: 25,
                    name: 'Jinrokh',
                    startTime: 0,
                    endTime: 200000,
                    kill: true,
                  },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query ReportTableByType')) {
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
      pipelineOptionsFor([
        {
          reportCode: 'C1',
          zoneId: 100,
          startTime: now - 1000,
          endTime: now,
        },
        {
          reportCode: 'B1',
          zoneId: 100,
          startTime: now - 10 * DAY_MS,
          endTime: now - 10 * DAY_MS + 1000,
        },
      ]),
    );

    expect(summary.progress.pulls).toBe(0);
    expect(summary.progress.wipes).toBe(0);
    expect(summary.notes).toContain(
      'Current-window reports were discovered, but none matched the configured difficulty/size filters.',
    );
    expect(summary.notes).not.toContain(
      'No current-window reports were discovered for the configured guild and zone.',
    );
  });

  it('keeps the no-current-window note when discovery returns zero current candidates', async () => {
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const request = vi.fn(async (query: string) => {
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
        return {
          data: {
            reportData: {
              reports: {
                data: [],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        throw new Error('zone rankings unavailable');
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
      pipelineOptionsFor([]),
    );

    expect(summary.notes).toContain(
      'No current-window reports were discovered for the configured guild and zone.',
    );
  });

  it('normalizes an Area 52 server name before collector calls and derives metrics', async () => {
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    const reportStart = 1778716776327;
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('query ZoneResolver')) {
        return {
          data: {
            worldData: {
              zone: {
                id: 1046,
                name: 'Throne of Thunder',
                difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
                encounters: Array.from({ length: 13 }, (_, index) => ({
                  id: index + 1,
                  name: `Encounter ${index + 1}`,
                })),
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        expect(variables.guildName).toBe('Shenanigans');
        expect(variables.guildServerSlug).toBe('area-52');
        expect(variables.guildServerRegion).toBe('US');
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        return {
          data: {
            reportData: {
              reports: {
                data:
                  Number(variables.startTime) === currentStart
                    ? [
                        {
                          code: 'XLWjxmYh37GNnyJK',
                          startTime: reportStart,
                          endTime: reportStart + 3_600_000,
                          zone: { id: 1046, name: 'Throne of Thunder' },
                        },
                      ]
                    : [],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        expect(variables.guildServerSlug).toBe('area-52');
        expect(variables.guildServerRegion).toBe('US');
        throw new Error('rankings unavailable');
      }

      if (query.includes('query ReportIndex')) {
        return {
          data: {
            reportData: {
              report: {
                title: 'Heroic ToT 10M',
                startTime: reportStart,
                endTime: reportStart + 3_600_000,
                zone: {
                  id: 1046,
                  name: 'Throne of Thunder',
                  difficulties: [{ id: 4, name: 'Heroic', sizes: [10, 25] }],
                },
                fights: [
                  {
                    id: 11,
                    encounterID: 1,
                    difficulty: 4,
                    size: 10,
                    name: "Jin'rokh the Breaker",
                    startTime: 0,
                    endTime: 120_000,
                    kill: true,
                  },
                  {
                    id: 12,
                    encounterID: 1,
                    difficulty: 4,
                    size: 10,
                    name: "Jin'rokh the Breaker",
                    startTime: 130_000,
                    endTime: 200_000,
                    kill: false,
                  },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query ReportTableByType')) {
        const dataType = String(variables.dataType);
        const fightIds = Array.isArray(variables.fightIDs) ? (variables.fightIDs as number[]) : [];
        const fightId = fightIds[0];
        return {
          data: {
            reportData: {
              report: {
                table: {
                  entries:
                    dataType === 'Deaths' ? [{ name: 'Any', deaths: fightId === 11 ? 2 : 4 }] : [],
                },
              },
            },
          },
        };
      }

      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    });

    const liveReportIndexFetcher: GuildRankLiveReportIndexFetcher = vi.fn(async (input) => {
      expect(input.guildName).toBe('Shenanigans');
      expect(input.guildServerSlug).toBe('area-52');
      expect(input.guildServerRegion).toBe('us');
      expect(input.gameFamily).toBe('mop_classic');
      return [
        {
          reportCode: 'XLWjxmYh37GNnyJK',
          zoneId: 1046,
          zoneName: 'Throne of Thunder',
          startTime: reportStart,
          endTime: reportStart + 3_600_000,
        },
      ];
    });

    const summary = await collectGuildRankSummaryData(
      { request } as never,
      {
        guildName: 'Shenanigans',
        guildServerSlug: 'Area 52',
        guildServerRegion: 'us',
        zoneId: 1046,
        difficulty: 'heroic',
        size: '10man',
        gameFamily: 'mop_classic',
      },
      { liveReportIndexFetcher },
    );

    expect(summary.progress.clearedEncounters).toBe(1);
    expect(summary.progress.totalEncounters).toBe(13);
    expect(summary.progress.pulls).toBe(2);
    expect(summary.progress.wipes).toBe(1);
    expect(summary.speed.overall.bestDerivedPercentile).toBe(100);
    expect(summary.execution.overall.bestDerivedPercentile).toBe(100);
    expect(summary.notes).not.toContain(
      'No current-window reports were discovered for the configured guild and zone.',
    );
  });

  it('matches by zone name only when report zone ID is missing', async () => {
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('query ZoneResolver')) {
        return {
          data: {
            worldData: {
              zone: {
                id: 1046,
                name: 'Throne of Thunder',
                difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                encounters: [{ id: 1, name: "Jin'rokh the Breaker" }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        return {
          data: {
            reportData: {
              reports: {
                data:
                  Number(variables.startTime) === currentStart
                    ? [
                        {
                          code: 'NAMEONLY',
                          startTime: now - 1000,
                          endTime: now,
                          zone: { name: 'Throne of Thunder' },
                        },
                      ]
                    : [],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        throw new Error('rankings unavailable');
      }

      if (query.includes('query ReportIndex')) {
        return {
          data: {
            reportData: {
              report: {
                title: 'Name only zone report',
                startTime: now - 1000,
                endTime: now,
                zone: {
                  name: 'Throne of Thunder',
                  difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                },
                fights: [
                  {
                    id: 11,
                    encounterID: 1,
                    difficulty: 4,
                    size: 10,
                    name: "Jin'rokh the Breaker",
                    startTime: 0,
                    endTime: 120_000,
                    kill: true,
                  },
                ],
              },
            },
          },
        };
      }

      if (query.includes('query ReportTableByType')) {
        return {
          data: { reportData: { report: { table: { entries: [] } } } },
        };
      }

      throw new Error(`Unexpected query: ${query.slice(0, 60)}`);
    });

    const summary = await collectGuildRankSummaryData(
      { request } as never,
      {
        guildName: 'Shenanigans',
        guildServerSlug: 'Galakras',
        guildServerRegion: 'us',
        zoneId: 1046,
        difficulty: 'heroic',
        size: '10man',
      },
      pipelineOptionsFor([
        {
          reportCode: 'NAMEONLY',
          zoneName: 'Throne of Thunder',
          startTime: now - 1000,
          endTime: now,
        },
      ]),
    );

    expect(summary.progress.pulls).toBe(1);
    expect(summary.notes).not.toContain(
      'Current-window reports were discovered, but none matched the configured zone filter.',
    );
  });

  it('keeps zone ID authoritative when report zone ID and zone name disagree', async () => {
    const now = Date.UTC(2026, 4, 14, 12, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const request = vi.fn(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('query ZoneResolver')) {
        return {
          data: {
            worldData: {
              zone: {
                id: 1046,
                name: 'Throne of Thunder',
                difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                encounters: [{ id: 1, name: "Jin'rokh the Breaker" }],
              },
            },
          },
        };
      }

      if (query.includes('query GuildReportDiscovery')) {
        const currentStart = now - 7 * 24 * 60 * 60 * 1000;
        return {
          data: {
            reportData: {
              reports: {
                data:
                  Number(variables.startTime) === currentStart
                    ? [
                        {
                          code: 'WRONGZONE',
                          startTime: now - 1000,
                          endTime: now,
                          zone: { id: 9999, name: 'Throne of Thunder' },
                        },
                      ]
                    : [],
              },
            },
          },
        };
      }

      if (query.includes('query GuildZoneRanks')) {
        throw new Error('rankings unavailable');
      }

      if (query.includes('query ReportIndex')) {
        return {
          data: {
            reportData: {
              report: {
                title: 'Wrong zone report',
                startTime: now - 1000,
                endTime: now,
                zone: {
                  id: 9999,
                  name: 'Throne of Thunder',
                  difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
                },
                fights: [
                  {
                    id: 11,
                    encounterID: 1,
                    difficulty: 4,
                    size: 10,
                    name: "Jin'rokh the Breaker",
                    startTime: 0,
                    endTime: 120_000,
                    kill: true,
                  },
                ],
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
        guildName: 'Shenanigans',
        guildServerSlug: 'Galakras',
        guildServerRegion: 'us',
        zoneId: 1046,
        difficulty: 'heroic',
        size: '10man',
      },
      pipelineOptionsFor([
        {
          reportCode: 'WRONGZONE',
          zoneName: 'Throne of Thunder',
          startTime: now - 1000,
          endTime: now,
        },
      ]),
    );

    expect(summary.progress.pulls).toBe(0);
    expect(summary.notes).toContain(
      'Current-window reports were discovered, but none matched the configured zone filter.',
    );
    expect(summary.notes).not.toContain(
      'No current-window reports were discovered for the configured guild and zone.',
    );
  });
});
