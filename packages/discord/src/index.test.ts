import { describe, expect, it, vi } from 'vitest';
import { InteractionResponseType, InteractionType } from 'discord-interactions';
import { commandDefinitions, handleInteraction } from './index.js';
import { buildGuildRankResponseBody } from './renderers/guildrank.js';

const makeHandleOptions = () =>
  ({
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
    expect(commandDefinitions.every((command) => command.type === 1)).toBe(true);

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
    const optionNames = configCommand?.options?.map((option) => option.name) ?? [];
    expect(optionNames).toContain('wcl_guild_name');
    expect(optionNames).toContain('wcl_guild_server_name');
    expect(optionNames).toContain('wcl_guild_server_region');
    expect(optionNames).toContain('wcl_zone_id');
  });

  it('defers /report publicly and schedules background execution', async () => {
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
          options: [
            { name: 'wcl_report_url', value: 'https://www.warcraftlogs.com/reports/ABC123' },
          ],
        },
      },
      options,
    );

    expect(response).toEqual({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
    expect(tasks).toHaveLength(1);
  });

  it('defers /guildrank publicly and schedules background execution', async () => {
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
          name: 'guildrank',
          options: [
            { name: 'difficulty', value: 'heroic' },
            { name: 'size', value: '10man' },
          ],
        },
      },
      options,
    );

    expect(response).toEqual({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    });
    expect(tasks).toHaveLength(1);
  });

  it('renders /guildrank response bodies without ephemeral flags', () => {
    const response = buildGuildRankResponseBody({
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
    });

    expect(response).not.toHaveProperty('flags');
  });

  it('renders official Progress ranks while keeping Speed and Execution derived', () => {
    const response = buildGuildRankResponseBody({
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
        clearedEncounters: 13,
        totalEncounters: 13,
        pulls: 4,
        wipes: 1,
        ranks: { world: 868, region: 279, realm: 241 },
        ranksAvailable: true,
        sourceLabel: 'Official WCL Rankings',
      },
      speed: {
        sourceLabel: 'Derived from WCL Reports',
        ranks: { world: 1273, region: 489, realm: 296 },
        completeRaidRanks: { world: 389, region: 136, realm: 120 },
        overall: {
          bestDerivedPercentile: 91,
          bestDerivedPercentileDelta: 3,
          medianDerivedPercentile: 88,
          medianDerivedPercentileDelta: -2,
        },
        encounters: [
          {
            encounterName: 'Jinrokh',
            speed: {
              bestDerivedPercentile: 95,
              bestDerivedPercentileDelta: 5,
              medianDerivedPercentile: 90,
              medianDerivedPercentileDelta: -1,
            },
            execution: {},
          },
        ],
      },
      execution: {
        sourceLabel: 'Derived from WCL Reports',
        overall: {
          bestDerivedPercentile: 84,
          bestDerivedPercentileDelta: 4,
          medianDerivedPercentile: 82,
          medianDerivedPercentileDelta: 2,
        },
        encounters: [
          {
            encounterName: 'Jinrokh',
            speed: {},
            execution: {
              bestDerivedPercentile: 86,
              bestDerivedPercentileDelta: 6,
              medianDerivedPercentile: 80,
              medianDerivedPercentileDelta: -3,
            },
          },
        ],
      },
      notes: [],
    });

    const fields = response.embeds[0]?.fields ?? [];
    expect(fields.map((field) => field.name)).toEqual([
      'Progress',
      'Guild Rankings',
      'Speed',
      'Speed - Per Encounter',
      'Execution',
      'Execution - Per Encounter',
      'Window',
    ]);
    const progressValue = fields.find((field) => field.name === 'Progress')?.value ?? '';
    expect(progressValue).toContain('================================\n\nCleared');
    expect(progressValue).toContain('Cleared: 13/13');
    expect(progressValue).toContain('World: #868');
    expect(progressValue).toContain('Region: #279');
    expect(progressValue).toContain('Realm: #241');
    const speedValue = fields.find((field) => field.name === 'Speed')?.value ?? '';
    expect(speedValue).toContain('================================\n\nSource');
    expect(speedValue).toContain('Source: Derived from WCL Reports');
    expect(speedValue).toContain('All-Star Ranks:');
    expect(speedValue).toContain('World 🌍 #1273');
    expect(speedValue).toContain('Region 🗾 #489');
    expect(speedValue).toContain('Realm 🪐 #296');
    expect(speedValue).toContain('Complete Raid Ranks:');
    expect(speedValue).toContain('World 🌍 #389');
    expect(speedValue).toContain('Region 🗾 #136');
    expect(speedValue).toContain('Realm 🪐 #120');
    expect(speedValue).toContain('Best Derived Relative Percentile: 91 (prev 88, +3)');
    expect(speedValue).toContain('Median Derived Relative Percentile: 88 (prev 90, -2)');
    expect(fields.find((field) => field.name === 'Execution')?.value).toContain(
      'Source: Derived from WCL Reports',
    );
    expect(fields.find((field) => field.name === 'Execution')?.value).toContain(
      'Best Derived Relative Percentile: 84 (prev 80, +4)',
    );
    expect(JSON.stringify(response)).not.toContain('Official progress ranks unavailable');
    const speedEncounterValue =
      fields.find((field) => field.name === 'Speed - Per Encounter')?.value ?? '';
    expect(speedEncounterValue).toContain('• Jinrokh');
    expect(speedEncounterValue).toContain('  Best Derived Relative Percentile: 95 (prev 90, +5)');
    const executionEncounterValue =
      fields.find((field) => field.name === 'Execution - Per Encounter')?.value ?? '';
    expect(executionEncounterValue).toContain('• Jinrokh');
    expect(executionEncounterValue).toContain(
      '  Best Derived Relative Percentile: 86 (prev 80, +6)',
    );
    expect(fields.some((field) => field.name === 'Jinrokh')).toBe(false);
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
