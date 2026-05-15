import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildRankPipelineOptions } from './pipeline/guildrank-pipeline.js';

const collectGuildRankSummaryData = vi.hoisted(() => vi.fn());
const collectGuildReportIndex = vi.hoisted(() => vi.fn());

vi.mock('./pipeline/guildrank-pipeline.js', () => ({
  collectGuildRankSummaryData,
}));

vi.mock('./collectors/guild-report-index-collector.js', () => ({
  collectGuildReportIndex,
}));

import { WclClient } from './wcl-client.js';

const guildRankInput = {
  guildName: 'Guild',
  guildServerSlug: 'stormrage',
  guildServerRegion: 'us',
  zoneId: 100,
  difficulty: 'heroic',
  size: '10man',
} as const;

const summary = (guildName: string) => ({
  guildName,
  zoneName: 'Throne',
  difficultyLabel: 'Heroic',
  sizeLabel: '10man',
  window: {
    currentStartIso: new Date(0).toISOString(),
    currentEndIso: new Date(1).toISOString(),
    baselineStartIso: new Date(2).toISOString(),
    baselineEndIso: new Date(3).toISOString(),
  },
  progress: {
    clearedEncounters: 0,
    totalEncounters: 0,
    pulls: 0,
    wipes: 0,
    ranks: {},
    ranksAvailable: false,
    sourceLabel: 'Progress Only: Ranking Unavailable' as const,
  },
  speed: { sourceLabel: 'Derived from WCL Reports' as const, overall: {}, encounters: [] },
  execution: { sourceLabel: 'Derived from WCL Reports' as const, overall: {}, encounters: [] },
  notes: [],
});

describe('WclClient guildrank auth order', () => {
  beforeEach(() => {
    collectGuildRankSummaryData.mockReset();
    collectGuildReportIndex.mockReset();
  });

  it('prefers linked user auth for guildrank when available', async () => {
    collectGuildRankSummaryData.mockImplementationOnce(async (client: { getAuthModeKind: () => string }) =>
      summary(client.getAuthModeKind()),
    );
    const client = new WclClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiBaseUrl: 'https://www.warcraftlogs.com/api/v2/client',
      wclUserAuthStore: {
        getByDiscordUserId: vi.fn().mockResolvedValue({ accessToken: 'linked-token' }),
      },
    });

    const result = await client.fetchGuildRankSummary(guildRankInput, { discordUserId: 'user-1' });

    expect(result.guildName).toBe('userLinked');
    expect(collectGuildRankSummaryData).toHaveBeenCalledTimes(1);
  });

  it('falls back to public client auth when linked guildrank lookup fails', async () => {
    collectGuildRankSummaryData
      .mockImplementationOnce(async () => {
        throw new Error('user lookup failed');
      })
      .mockImplementationOnce(async (client: { getAuthModeKind: () => string }) =>
        summary(client.getAuthModeKind()),
      );
    const client = new WclClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiBaseUrl: 'https://www.warcraftlogs.com/api/v2/client',
      wclUserAuthStore: {
        getByDiscordUserId: vi.fn().mockResolvedValue({ accessToken: 'linked-token' }),
      },
    });

    const result = await client.fetchGuildRankSummary(guildRankInput, { discordUserId: 'user-1' });

    expect(result.guildName).toBe('publicClient');
    expect(collectGuildRankSummaryData).toHaveBeenCalledTimes(2);
  });
});

describe('WclClient guild report index', () => {
  beforeEach(() => {
    collectGuildRankSummaryData.mockReset();
    collectGuildReportIndex.mockReset();
  });

  it('passes the server-side v1 key to the guild report index collector', async () => {
    collectGuildReportIndex.mockResolvedValue({
      rows: [],
      windowsQueried: 0,
      complexity: { apiCalls: 'O(W)', parseAndDedupe: 'O(N)', memory: 'O(U)' },
    });
    const fetchImpl = vi.fn();
    const client = new WclClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiBaseUrl: 'https://www.warcraftlogs.com/api/v2/client',
      v1ClientKey: 'server-side-v1-key',
      fetchImpl,
    });

    await client.fetchGuildReportIndex({
      guildName: 'Guild',
      guildServerSlug: 'stormrage',
      guildServerRegion: 'us',
      startTimeMs: 0,
      endTimeMs: 1000,
    });

    expect(collectGuildReportIndex).toHaveBeenCalledWith({
      guildName: 'Guild',
      guildServerSlug: 'stormrage',
      guildServerRegion: 'us',
      startTimeMs: 0,
      endTimeMs: 1000,
      v1ClientKey: 'server-side-v1-key',
      fetchImpl,
    });
  });

  it('fails clearly when the v1 key is not configured', async () => {
    const client = new WclClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiBaseUrl: 'https://www.warcraftlogs.com/api/v2/client',
    });

    await expect(
      client.fetchGuildReportIndex({
        guildName: 'Guild',
        guildServerSlug: 'stormrage',
        guildServerRegion: 'us',
        startTimeMs: 0,
        endTimeMs: 1000,
      }),
    ).rejects.toThrow(/WCL_V1_CLIENT_KEY/);
    expect(collectGuildReportIndex).not.toHaveBeenCalled();
  });

  it('wires guildrank metadata reader and maps live report index rows', async () => {
    const metadataReader = {
      summarizeReports: vi.fn().mockResolvedValue([]),
    };
    collectGuildReportIndex.mockResolvedValue({
      rows: [
        {
          code: 'ABC123',
          title: 'Raid Night',
          owner: 'Logger',
          zoneId: 1046,
          startTime: 100,
          endTime: 200,
        },
      ],
      windowsQueried: 1,
      complexity: { apiCalls: 'O(W)', parseAndDedupe: 'O(N)', memory: 'O(U)' },
    });
    collectGuildRankSummaryData.mockImplementationOnce(
      async (_client: unknown, _input: unknown, options: GuildRankPipelineOptions) => {
        expect(options.metadataReader).toBe(metadataReader);
        await expect(
          options.liveReportIndexFetcher({
            guildName: 'Guild',
            guildServerSlug: 'stormrage',
            guildServerRegion: 'us',
            gameFamily: 'mop_classic',
            startTimeMs: 0,
            endTimeMs: 1000,
            limit: 30,
          }),
        ).resolves.toEqual([
          {
            reportCode: 'ABC123',
            title: 'Raid Night',
            owner: 'Logger',
            zoneId: 1046,
            startTime: 100,
            endTime: 200,
          },
        ]);
        return summary('wired');
      },
    );
    const client = new WclClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      apiBaseUrl: 'https://www.warcraftlogs.com/api/v2/client',
      v1ClientKey: 'server-side-v1-key',
      guildReportMetadataStore: metadataReader,
    });

    const result = await client.fetchGuildRankSummary({
      ...guildRankInput,
      gameFamily: 'mop_classic',
    });

    expect(result.guildName).toBe('wired');
    expect(collectGuildReportIndex).toHaveBeenCalledWith({
      guildName: 'Guild',
      guildServerSlug: 'stormrage',
      guildServerRegion: 'us',
      gameFamily: 'mop_classic',
      startTimeMs: 0,
      endTimeMs: 1000,
      v1ClientKey: 'server-side-v1-key',
    });
  });
});
