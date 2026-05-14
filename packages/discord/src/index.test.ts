import { describe, expect, it, vi } from 'vitest';
import { InteractionResponseType, InteractionType } from 'discord-interactions';
import {
  commandDefinitions,
  handleInteraction,
} from './index.js';

const makeHandleOptions = () => ({
  wclClient: {
    fetchReportSummary: vi.fn().mockResolvedValue({
      reportCode: 'ABC123',
      reportTitle: 'Raid',
      reportLink: 'https://www.warcraftlogs.com/reports/ABC123',
      dateISO: new Date(0).toISOString(),
      startTimeISO: new Date(0).toISOString(),
      endTimeISO: new Date(1).toISOString(),
      durationMs: 1,
      bossPulls: 1,
      totalKills: 1,
      totalWipes: 0,
      encounters: [],
      highestParses: { dtpsAvailable: false },
      topPlayers: {
        highestAverageParse: [],
        highestTotalDamage: [],
        highestTotalHealing: [],
        highestTotalDamageTaken: [],
        highestTotalDps: [],
        highestHps: [],
        highestDamageTakenRate: [],
        mostDeaths: [],
        mostInterrupts: [],
        mostDispels: [],
      },
      partialDataNotes: [],
    }),
    fetchGuildRankSummary: vi.fn().mockResolvedValue({
      guildName: 'Guild',
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
        clearedEncounters: 1,
        totalEncounters: 1,
        pulls: 1,
        wipes: 0,
        ranks: {},
        ranksAvailable: false,
        sourceLabel: 'Progress Only: Ranking Unavailable',
      },
      speed: { sourceLabel: 'Derived from WCL Reports', overall: {}, encounters: [] },
      execution: { sourceLabel: 'Derived from WCL Reports', overall: {}, encounters: [] },
      notes: [],
    }),
    resolveZoneName: vi.fn().mockResolvedValue('Throne of Thunder'),
  },
  guildConfigStore: {
    getGuildConfig: vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      compareAccessMode: 'officer_only',
      compareOfficerUserIds: [],
      dashboardOfficerAccessEnabled: false,
      comparePublicPostingEnabled: false,
      autoReportMode: 'prompt',
      autoReportChannelIds: [],
      wclGuildName: 'Guild',
      wclGuildServerSlug: 'stormrage',
      wclGuildServerRegion: 'us',
      wclZoneId: 100,
    }),
    saveGuildConfig: vi.fn().mockImplementation(async (_guildId, update) => ({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      compareAccessMode: 'officer_only',
      compareOfficerUserIds: [],
      dashboardOfficerAccessEnabled: false,
      comparePublicPostingEnabled: false,
      autoReportMode: 'prompt',
      autoReportChannelIds: [],
      wclGuildName: typeof update?.wclGuildName === 'string' ? update.wclGuildName : 'Guild',
      wclGuildServerSlug:
        typeof update?.wclGuildServerSlug === 'string' ? update.wclGuildServerSlug : 'stormrage',
      wclGuildServerRegion:
        typeof update?.wclGuildServerRegion === 'string' ? update.wclGuildServerRegion : 'us',
      wclZoneId: typeof update?.wclZoneId === 'number' ? update.wclZoneId : 100,
    })),
  },
}) as never;

describe('discord command surfaces', () => {
  it('registers report and guildrank commands with expected options', () => {
    expect(commandDefinitions.find((command) => command.name === 'report')).toMatchObject({
      options: [{ name: 'wcl_report_url', type: 3, required: true }],
    });

    expect(commandDefinitions.find((command) => command.name === 'guildrank')).toMatchObject({
      options: [
        {
          name: 'difficulty',
          type: 3,
          required: true,
          choices: [
            { name: 'normal', value: 'normal' },
            { name: 'heroic', value: 'heroic' },
          ],
        },
        {
          name: 'size',
          type: 3,
          required: true,
          choices: [
            { name: '10man', value: '10man' },
            { name: '25man', value: '25man' },
          ],
        },
      ],
    });

    const configCommand = commandDefinitions.find((command) => command.name === 'config');
    const optionNames =
      configCommand && 'options' in configCommand
        ? configCommand.options?.map((option) => option.name) ?? []
        : [];
    expect(optionNames).toContain('wcl_guild_name');
    expect(optionNames).toContain('wcl_guild_server_name');
    expect(optionNames).toContain('wcl_guild_server_region');
    expect(optionNames).toContain('wcl_zone_id');
  });

  it('returns explicit temporary-unavailable response for /compare', async () => {
    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        data: {
          name: 'compare',
          options: [
            { name: 'report', value: 'https://www.warcraftlogs.com/reports/ABC123' },
            { name: 'character', value: 'Alyra' },
            { name: 'mode', value: 'character' },
          ],
        },
      },
      makeHandleOptions(),
    );

    expect(response).toEqual({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '/compare is temporarily unavailable while the report pipeline migration is in progress.',
        flags: 64,
      },
    });
  });

  it('defers /report and schedules background execution', async () => {
    const tasks: Array<() => void> = [];
    const baseOptions = makeHandleOptions() as Record<string, unknown>;
    const options = {
      ...baseOptions,
      scheduleBackgroundTask: (task: () => void) => {
        tasks.push(task);
      },
    } as never;

    const response = await handleInteraction(
      {
        id: 'i1',
        application_id: 'app',
        token: 'tok',
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' }, permissions: '32' },
        data: {
          name: 'report',
          options: [{ name: 'wcl_report_url', value: 'https://www.warcraftlogs.com/reports/ABC123' }],
        },
      },
      options,
    );

    expect(response).toEqual({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });
    expect(tasks).toHaveLength(1);
  });

  it('does not render raw zone IDs in /config status output', async () => {
    const options = makeHandleOptions();
    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' }, permissions: '32' },
        data: {
          name: 'config',
          options: [],
        },
      },
      options,
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    });
    const content = (response as { data?: { content?: string } }).data?.content ?? '';
    expect(content).toContain('Server name: `Stormrage`');
    expect(content).toContain('Zone: `Throne of Thunder`');
    expect(content).not.toContain('Zone ID:');
    expect(content).not.toContain('`100`');
  });

  it('normalizes /config server name input to canonical server slug before save', async () => {
    const options = makeHandleOptions() as Record<string, unknown>;
    const guildConfigStore = options.guildConfigStore as {
      saveGuildConfig: ReturnType<typeof vi.fn>;
    };
    await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' }, permissions: '32' },
        data: {
          name: 'config',
          options: [{ name: 'wcl_guild_server_name', value: 'Galakras' }],
        },
      },
      options as never,
    );

    expect(guildConfigStore.saveGuildConfig).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({ wclGuildServerSlug: 'galakras' }),
    );
  });
});
