import { beforeEach, describe, expect, it, vi } from 'vitest';

const collectGuildRankSummaryData = vi.hoisted(() => vi.fn());

vi.mock('./pipeline/guildrank-pipeline.js', () => ({
  collectGuildRankSummaryData,
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
