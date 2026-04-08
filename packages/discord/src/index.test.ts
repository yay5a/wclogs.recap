import { describe, expect, it, vi } from 'vitest';
import { InteractionType } from 'discord-interactions';
import type { GuildConfigStore, NormalizedReport, NormalizedPlayer } from '@wcl/domain';
import { handleInteraction } from './index.js';

const makeReport = (): NormalizedReport => ({
  reportCode: 'ABC123',
  title: 'Raid Night',
  startTime: Date.now(),
  endTime: Date.now(),
  gameFamily: 'retail',
  comparisonMode: 'character',
  sourceHost: 'www.warcraftlogs.com',
  zoneName: 'Vault',
  fights: [{ id: 1, name: 'Boss', startTime: 0, endTime: 1, kill: true }],
  players: [
    {
      id: '1',
      name: 'Alyra',
      performance: { bestSingleBossParse: 90, averageParseAcrossKills: 85 },
      execution: { executionScore: 88 },
    },
  ],
});

describe('handleInteraction', () => {
  it('saves guild config values', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue(undefined);
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn(),
      saveGuildConfig,
    };
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        data: {
          name: 'config',
          options: [
            { name: 'game_family', value: 'mop_classic' },
            { name: 'compare_mode', value: 'mixed' },
          ],
        },
      },
      { wclClient, guildConfigStore },
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
    });
    expect(response.type).toBeDefined();
  });

  it('creates report recap preview and post flow', async () => {
    const report = makeReport();
    const previous: NormalizedPlayer[] = [];
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(report),
      findPreviousRaidSummaries: vi.fn().mockResolvedValue(previous),
    } as never;
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn(),
      saveGuildConfig: vi.fn(),
    };

    const preview = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        data: {
          name: 'report',
          options: [
            {
              name: 'recap',
              options: [{ name: 'url', value: 'https://www.warcraftlogs.com/reports/ABC123' }],
            },
          ],
        },
      },
      { wclClient, guildConfigStore },
    );

    const components = ((preview.data as { components?: Array<{ components: Array<{ custom_id: string }> }> }).components ?? []);
    const customId = components[0]?.components[0]?.custom_id;
    expect(customId).toContain('post_recap:ABC123:');

    const posted = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: customId ?? '' },
      },
      { wclClient, guildConfigStore },
    );

    expect((posted.data as { embeds?: unknown[] }).embeds?.length).toBe(1);
  });
});
