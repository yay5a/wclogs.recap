import { describe, expect, it, vi } from 'vitest';
import { InteractionResponseType, InteractionType } from 'discord-interactions';
import { commandDefinitions, handleInteraction } from './index.js';
import { buildGuildRankResponseBody } from './renderers/guildrank.js';

const SECTION_SEPARATOR = '='.repeat(32);

const sectionValue = (
  fields: Array<{ name: string; value: string; inline?: boolean }>,
  title: string,
): string => fields.find((field) => field.value.startsWith(`**${title}**`))?.value ?? '';

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
        highestParses: {},
        topPlayers: {
          highestAverageParse: [],
          highestTotalDamage: [],
          highestTotalHealing: [],
          highestTotalDps: [],
          highestHps: [],
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
        metricSource: 'derived_report_scan',
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
      metricSource: 'derived_report_scan',
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
      metricSource: 'derived_report_scan',
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
    expect(fields.map((field) => field.name)).toEqual(Array(7).fill(SECTION_SEPARATOR));
    const progressValue = sectionValue(fields, 'Progress');
    expect(progressValue).toContain('**Progress**\n\nCleared');
    expect(progressValue).toContain('Cleared: 13/13');
    expect(progressValue).toContain('World: #868');
    expect(progressValue).toContain('Region: #279');
    expect(progressValue).toContain('Realm: #241');
    const speedValue = sectionValue(fields, 'Speed');
    expect(speedValue).toContain('**Speed**\n\nSource');
    expect(speedValue).toContain('Source: Derived from WCL Reports');
    expect(speedValue).toContain('All-Star Ranks:');
    expect(speedValue).toContain('All-Star Ranks:\nWorld 🌍 #1273\nRegion 🗾 #489\nRealm 🪐 #296');
    expect(speedValue).toContain('Realm 🪐 #296\n\nComplete Raid Ranks:');
    expect(speedValue).not.toContain('/ Region 🗾 #489');
    expect(speedValue).not.toContain('/ Realm 🪐 #296');
    expect(speedValue).toContain('Complete Raid Ranks:');
    expect(speedValue).toContain(
      'Complete Raid Ranks:\nWorld 🌍 #389\nRegion 🗾 #136\nRealm 🪐 #120',
    );
    expect(speedValue).not.toContain('/ Region 🗾 #136');
    expect(speedValue).not.toContain('/ Realm 🪐 #120');
    expect(speedValue).toContain('Best Percentile: 91 (prev 88, +3)');
    expect(speedValue).not.toContain('Median Percentile');
    expect(sectionValue(fields, 'Execution')).toContain('Source: Derived from WCL Reports');
    expect(sectionValue(fields, 'Execution')).toContain('Best Percentile: 84 (prev 80, +4)');
    expect(JSON.stringify(response)).not.toContain('Official progress ranks unavailable');
    const speedEncounterValue = sectionValue(fields, 'Speed - Per Encounter');
    expect(speedEncounterValue).toContain('• Jinrokh');
    expect(speedEncounterValue).toContain('Best Percentile: 95 (prev 90, +5)');
    const executionEncounterValue = sectionValue(fields, 'Execution - Per Encounter');
    expect(executionEncounterValue).toContain('• Jinrokh');
    expect(executionEncounterValue).toContain('Best Percentile: 86 (prev 80, +6)');
    expect(fields.some((field) => field.value.startsWith('**Jinrokh**'))).toBe(false);
  });

  it('renders cached guildrank trends as WCL percentiles and ranking samples', () => {
    const response = buildGuildRankResponseBody({
      guildName: 'Guild',
      zoneName: 'Throne',
      difficultyLabel: 'Heroic',
      sizeLabel: '10man',
      metricSource: 'trend_cache',
      window: {
        currentStartIso: new Date(0).toISOString(),
        currentEndIso: new Date(1).toISOString(),
        baselineStartIso: new Date(2).toISOString(),
        baselineEndIso: new Date(3).toISOString(),
      },
      progress: {
        clearedEncounters: 1,
        totalEncounters: 1,
        pulls: 29,
        wipes: 0,
        ranks: {},
        ranksAvailable: false,
        sourceLabel: 'Progress Only: Ranking Unavailable',
      },
      speed: {
        sourceLabel: 'Cached WCL Rankings',
        ranks: { world: 1273, region: 489, realm: 296 },
        completeRaidRanks: { world: 391, region: 136, realm: 120 },
        bestEncounterGain: { encounterName: 'Jinrokh', delta: 5 },
        overall: {
          bestDerivedPercentile: 91,
          bestDerivedPercentileDelta: 3,
          medianDerivedPercentile: 91,
          medianDerivedPercentileDelta: -2,
        },
        encounters: [
          {
            encounterName: 'Jinrokh',
            speed: {
              bestDerivedPercentile: 95,
              bestDerivedPercentileDelta: 5,
              medianDerivedPercentile: 95,
              medianDerivedPercentileDelta: -1,
            },
            execution: {},
          },
        ],
      },
      execution: {
        sourceLabel: 'Cached WCL Rankings',
        overall: {
          bestDerivedPercentile: 84,
          bestDerivedPercentileDelta: -4,
          medianDerivedPercentile: 82,
          medianDerivedPercentileDelta: 2,
        },
        encounters: [],
      },
      notes: ['Speed and execution are read from cached WCL ranking trends.'],
    });

    const fields = response.embeds[0]?.fields ?? [];
    const rankingValue = sectionValue(fields, 'Guild Rankings');
    const speedValue = sectionValue(fields, 'Speed');
    const speedEncounterValue = sectionValue(fields, 'Speed - Per Encounter');
    const executionValue = sectionValue(fields, 'Execution');
    const readValue = sectionValue(fields, 'How to Read');
    const responseJson = JSON.stringify(response);

    expect(rankingValue).toContain('Ranking samples: 29');
    expect(rankingValue).not.toContain('Pulls/Wipes');
    expect(speedValue).toContain('Source: Cached WCL Rankings');
    expect(speedValue).toContain('Best WCL Percentile: 91 (prev 88, +3)');
    expect(speedValue).toContain('Best Encounter Gain: Jinrokh 95 (+5)');
    expect(speedValue).not.toContain('Median WCL Percentile');
    expect(speedValue).not.toContain('median prev');
    expect(speedEncounterValue).toContain('Best WCL Percentile: 95 (prev 90, +5)');
    expect(speedEncounterValue).not.toContain('Median WCL Percentile');
    expect(executionValue).toContain('WCL Percentile: 84 (prev best 88, -4)');
    expect(executionValue).not.toContain('Best WCL Percentile: 84');
    expect(readValue).toContain(
      'Window: Current week = latest cached WCL ranking week. Baseline = previous cached ranking week.',
    );
    expect(readValue).toContain(
      'Current week: 1970-01-01T00:00:00.000Z -> 1970-01-01T00:00:00.001Z',
    );
    expect(readValue).toContain(
      'Baseline week: 1970-01-01T00:00:00.002Z -> 1970-01-01T00:00:00.003Z',
    );
    expect(readValue).toContain(
      'Speed/execution percentiles use cached WCL report rankings, not the guild profile page.',
    );
    expect(readValue).toContain(
      'All-Star and Complete Raid ranks are WCL speed ranks; execution has no matching WCL rank fields in this view.',
    );
    expect(readValue).toContain(
      "Weekly values may summarize multiple reports; verify source values in each report's Rankings table for the same encounter/difficulty/size.",
    );
    expect(responseJson).not.toContain('Best Derived Relative Percentile');
    expect(responseJson).not.toContain(
      'Speed and execution are read from cached WCL ranking trends.',
    );
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
