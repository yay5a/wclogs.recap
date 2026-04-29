import { describe, expect, it, vi, afterEach } from 'vitest';
import { InteractionType } from 'discord-interactions';
import type { GuildConfigStore, NormalizedPlayer, NormalizedReport } from '@wcl/domain';
import { buildRecapSummary } from '@wcl/domain';
import {
  buildRecapPreviewBody,
  buildPublicRecapEmbed,
  buildDiscordCommandPayload,
  buildDiscordCommandPayloads,
  commandDefinitions,
  DiscordCommandRegistrationError,
  handleInteraction,
  registerGlobalCommands,
  registerGuildCommands,
} from './index.js';

const makeReport = (): NormalizedReport => ({
  reportCode: 'ABC123',
  title: 'Raid Night',
  startTime: Date.now(),
  endTime: Date.now(),
  gameFamily: 'retail',
  zoneName: 'Vault',
  fights: [{ id: 1, name: 'Boss', startTime: 0, endTime: 1, kill: true }],
  players: [
    {
      id: '1',
      actorId: 1,
      name: 'Alyra',
      bestParse: 90,
      avgParse: 85,
      executionScore: 88,
    },
  ],
  leaderboards: [
    {
      scope: 'report',
      playerId: 1,
      playerName: 'Alyra',
      metric: 'bestPerformanceAverage',
      value: 90,
    },
    {
      scope: 'boss',
      bossName: 'Boss',
      fightId: 1,
      playerId: 1,
      playerName: 'Alyra',
      metric: 'bestPercent',
      value: 95,
    },
  ],
  bossPerformances: [
    {
      bossName: 'Boss',
      fightId: 1,
      topDamage: { playerName: 'Alyra', value: 12345 },
      mostDeaths: { playerName: 'Alyra', value: 1 },
    },
  ],
});

type PreviewSummary = Parameters<typeof buildRecapPreviewBody>[0];

const makePreviewSummary = (): PreviewSummary => ({
  reportTitle: 'Boss - Mythic - Zone',
  titleLine: 'Boss - Mythic - Zone',
  secondaryLine: 'Guild on Realm-US',
  reportDateISO: new Date(0).toISOString(),
  reportDateLabel: '01/01/1970',
  killTimeLabel: '45 Min',
  pullCount: 9,
  reportLink: 'https://www.warcraftlogs.com/reports/ABC123',
  gameFamily: 'retail' as const,
  bossesKilled: 1,
  compareModeUsed: 'mixed' as const,
  accountabilityVisibility: 'officers-only' as const,
  coachingShareability: 'shareable' as const,
  recapPostMode: 'preview-and-post' as const,
  fastestPhaseTimes: [],
  topDamageDone: [],
  topHealingDone: [],
  topDamageTaken: [],
  topInterrupts: [],
  topDispels: [],
  topSurvivability: [],
  topHealers: [],
  totals: {
    totalDeaths: 0,
    raidDamageTaken: 0,
    dispels: 0,
    battleRezzes: 0,
    kicks: 0,
  },
  highestParses: [],
  topDamageAverageParses: [],
  topHealingAverageParses: [],
  bossHighlights: [],
  raidSuperlatives: [],
  teamNote: 'Team note',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('command payload builder', () => {
  it('keeps command surface focused on health/config/recap only', () => {
    expect(commandDefinitions.map((command) => command.name)).toEqual([
      'health',
      'config',
      'recap',
    ]);
    const configCommand = commandDefinitions.find((command) => command.name === 'config');
    if (!configCommand || !('options' in configCommand)) {
      throw new Error('Expected config command options');
    }
    const optionNames = configCommand.options?.map((option) => option.name) ?? [];
    expect(optionNames).toEqual(['game_family', 'compare_mode']);
  });

  it('builds valid chat-input command payload', () => {
    const payload = buildDiscordCommandPayload({
      type: 1,
      name: 'health',
      description: 'Health command',
      options: [
        {
          type: 3,
          name: 'scope',
          description: 'scope',
          required: true,
          choices: [{ name: 'guild', value: 'guild' }],
        },
      ],
    });

    expect(payload).toEqual({
      type: 1,
      name: 'health',
      description: 'Health command',
      integration_types: undefined,
      contexts: undefined,
      default_member_permissions: undefined,
      nsfw: undefined,
      options: [
        {
          type: 3,
          name: 'scope',
          description: 'scope',
          required: true,
          choices: [{ name: 'guild', value: 'guild' }],
        },
      ],
    });
  });

  it('builds valid user command payload', () => {
    const payload = buildDiscordCommandPayload({
      type: 2,
      name: 'Inspect User',
    });

    expect(payload).toEqual({
      type: 2,
      name: 'Inspect User',
      integration_types: undefined,
      contexts: undefined,
      default_member_permissions: undefined,
      nsfw: undefined,
    });
  });

  it('builds valid message command payload', () => {
    const payload = buildDiscordCommandPayload({
      type: 3,
      name: 'Analyze Log',
    });

    expect(payload).toEqual({
      type: 3,
      name: 'Analyze Log',
      integration_types: undefined,
      contexts: undefined,
      default_member_permissions: undefined,
      nsfw: undefined,
    });
  });

  it('rejects options on message commands', () => {
    expect(() =>
      buildDiscordCommandPayload({
        type: 3,
        name: 'Analyze Log',
        options: [] as never,
      } as never),
    ).toThrow(/options are not allowed/i);
  });

  it('rejects missing description on chat-input commands', () => {
    expect(() =>
      buildDiscordCommandPayload({
        type: 1,
        name: 'health',
        description: '',
      }),
    ).toThrow(/description is required/i);
  });

  it('rejects uppercase slash-command names', () => {
    expect(() =>
      buildDiscordCommandPayload({
        type: 1,
        name: 'Health',
        description: 'Health',
      }),
    ).toThrow(/slash command names must be lowercase/i);
  });

  it('rejects required option after optional option', () => {
    expect(() =>
      buildDiscordCommandPayload({
        type: 1,
        name: 'config',
        description: 'Configure',
        options: [
          {
            type: 3,
            name: 'optional',
            description: 'optional',
            required: false,
          },
          {
            type: 3,
            name: 'required',
            description: 'required',
            required: true,
          },
        ],
      }),
    ).toThrow(/required options must appear before optional/i);
  });

  it('rejects incompatible choices', () => {
    expect(() =>
      buildDiscordCommandPayload({
        type: 1,
        name: 'config',
        description: 'Configure',
        options: [
          {
            type: 5,
            name: 'flag',
            description: 'flag',
            required: true,
            choices: [{ name: 'yes', value: 'yes' }],
          },
        ],
      }),
    ).toThrow(/choices are only valid/i);
  });

  it('rejects duplicate command names for same type', () => {
    expect(() =>
      buildDiscordCommandPayloads([
        { type: 1, name: 'health', description: 'Health' },
        { type: 1, name: 'health', description: 'Health 2' },
      ]),
    ).toThrow(/duplicate command name/i);
  });
});

describe('command registration endpoints', () => {
  it('registers global commands to the global endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await registerGlobalCommands('app123', 'token123');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/applications/app123/commands',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('registers guild commands when guildId is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await registerGuildCommands('app123', 'token123', 'guild456');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/applications/app123/guilds/guild456/commands',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('rejects blank guild id for guild registration', async () => {
    await expect(registerGuildCommands('app123', 'token123', '   ')).rejects.toThrow(
      /guildId is required/i,
    );
  });

  it('surfaces Discord error details', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi.fn().mockResolvedValue('{"message":"Invalid Form Body"}'),
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(registerGlobalCommands('app123', 'token123')).rejects.toMatchObject({
      name: 'DiscordCommandRegistrationError',
      details: expect.objectContaining({
        status: 400,
        statusText: 'Bad Request',
        responseBody: '{"message":"Invalid Form Body"}',
      }),
    } satisfies Partial<DiscordCommandRegistrationError>);
  });

  it('adds credential remediation for unauthorized registration responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockResolvedValue('{"message":"401: Unauthorized"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(registerGuildCommands('app123', 'token123', 'guild456')).rejects.toMatchObject({
      name: 'DiscordCommandRegistrationError',
      details: expect.objectContaining({
        status: 401,
        remediation: expect.stringContaining('DISCORD_BOT_TOKEN'),
      }),
    } satisfies Partial<DiscordCommandRegistrationError>);
  });
});

describe('Discord HTTP contract behavior', () => {
  it('sends Authorization, Content-Type, and User-Agent for command registration', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await registerGlobalCommands('app123', 'token123');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.com/api/v10/applications/app123/commands',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({
          Authorization: 'Bot token123',
          'Content-Type': 'application/json',
          'User-Agent': expect.stringContaining('DiscordBot'),
        }),
      }),
    );
  });

  it('retries once on 429 using retry_after from response body', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers(),
        clone: vi.fn().mockReturnValue({
          json: vi.fn().mockResolvedValue({
            retry_after: 0.01,
            global: false,
          }),
        }),
        text: vi.fn().mockResolvedValue('{"message":"rate limited"}'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue('ok'),
      });
    vi.stubGlobal('fetch', fetchMock);

    const pending = registerGlobalCommands('app123', 'token123');
    await vi.runAllTimersAsync();
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry 429 when retry timing is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers(),
      clone: vi.fn().mockReturnValue({
        json: vi.fn().mockRejectedValue(new Error('bad json')),
      }),
      text: vi.fn().mockResolvedValue('{"message":"rate limited"}'),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(registerGlobalCommands('app123', 'token123')).rejects.toBeInstanceOf(
      DiscordCommandRegistrationError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('handleInteraction', () => {
  const makeConfigOptions = (
    saveGuildConfig: GuildConfigStore['saveGuildConfig'],
  ) => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn(),
      saveGuildConfig,
    };
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;
    const recapPreviewStateService = {
      savePreviewState: vi.fn(),
      getValidPreviewState: vi.fn(),
      consumeValidPreviewState: vi.fn(),
      deletePreviewState: vi.fn(),
    };
    return { wclClient, guildConfigStore, recapPreviewStateService };
  };

  it('saves mixed as the guild default comparison policy', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      accountabilityVisibility: 'shareable',
      coachingShareabilityDefault: 'shareable',
      recapPostModeDefault: 'preview-only',
    });
    const options = makeConfigOptions(saveGuildConfig);

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
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
    });
    expect((response as { data?: { content?: string } }).data?.content).toBe(
      'Default comparison mode set to mixed. Future comparisons will use mapped player history when available. Alts are not guessed automatically.',
    );
    expect((response as { data?: { content?: string } }).data?.content).not.toMatch(/trend/i);
  });

  it('saves character as the guild default comparison policy', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      accountabilityVisibility: 'off',
      coachingShareabilityDefault: 'private',
      recapPostModeDefault: 'preview-and-post',
    });
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        data: {
          name: 'config',
          options: [{ name: 'compare_mode', value: 'character' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      compareModeDefault: 'character',
    });
    expect((response as { data?: { content?: string } }).data?.content).toBe(
      'Default comparison mode set to character. Future comparisons will match exact character history unless a command overrides it.',
    );
    expect((response as { data?: { content?: string } }).data?.content).not.toMatch(/trend/i);
  });

  it('rejects invalid compare_mode values without saving config', async () => {
    const saveGuildConfig = vi.fn();
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        data: {
          name: 'config',
          options: [{ name: 'compare_mode', value: 'alts' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: {
        content: 'Invalid compare_mode. Choose character or mixed.',
        flags: 64,
      },
    });
  });

  it('uses the saved default response when compare_mode is omitted', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      accountabilityVisibility: 'off',
      coachingShareabilityDefault: 'private',
      recapPostModeDefault: 'preview-and-post',
    });
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        data: {
          name: 'config',
          options: [],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {});
    expect((response as { data?: { content?: string } }).data?.content).toBe(
      'Default comparison mode set to character. Future comparisons will match exact character history unless a command overrides it.',
    );
  });

  it('creates recap preview and post flow', async () => {
    const report = makeReport();
    const previous: NormalizedPlayer[] = [];
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(report),
      findPreviousRaidSummaries: vi.fn().mockResolvedValue(previous),
    } as never;
    const recapPreviewStateService = {
      savePreviewState: vi.fn().mockResolvedValue(undefined),
      getValidPreviewState: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
        summaryPayload: {
          ...makePreviewSummary(),
        },
        createdByUserId: 'user-1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
      consumeValidPreviewState: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
        summaryPayload: {
          ...makePreviewSummary(),
        },
        createdByUserId: 'user-1',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      }),
      deletePreviewState: vi.fn().mockResolvedValue(undefined),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', fetchMock);
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'mixed',
        accountabilityVisibility: 'officers-only',
        coachingShareabilityDefault: 'shareable',
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const editFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', editFetch);

    await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        member: { user: { id: 'user-1' } },
        data: {
          name: 'recap',
          options: [
            {
              name: 'url',
              value: 'https://www.warcraftlogs.com/reports/ABC123',
            },
          ],
        },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
      },
    );

    await vi.waitFor(() => {
      expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledOnce();
      expect(editFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const patchCall = editFetch.mock.calls.find(
      ([url]) =>
        typeof url === 'string' &&
        url.includes('/webhooks/') &&
        url.includes('/messages/@original'),
    );
    const body =
      patchCall?.[1] &&
      typeof patchCall[1] === 'object' &&
      'body' in (patchCall[1] as Record<string, unknown>)
        ? (patchCall[1] as { body: string }).body
        : '{}';
    const previewBody = JSON.parse(body) as {
      components?: Array<{ components?: Array<{ custom_id?: string; label?: string }> }>;
    };
    const buttons = previewBody.components?.[0]?.components ?? [];
    const postButton = buttons.find((button) => button.custom_id?.includes(':post:'));
    const cancelButton = buttons.find((button) => button.custom_id?.includes(':cancel:'));

    const posted = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: 'recap:v1:post:ABC123:guild-1' },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
      },
    );
    expect(postButton?.label).toBe('Post to Current Channel');
    expect(postButton?.custom_id).toBe('recap:v1:post:ABC123:guild-1');
    expect(cancelButton?.label).toBe('Cancel');
    expect(cancelButton?.custom_id).toBe('recap:v1:cancel:ABC123:guild-1');

    expect((posted as { data?: { embeds?: unknown[] } }).data?.embeds?.length).toBe(1);
    expect(recapPreviewStateService.consumeValidPreviewState).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      guildId: 'guild-1',
    });
  });

  it('can schedule recap processing outside the initial response path', async () => {
    const fetchAndNormalizeReport = vi.fn().mockResolvedValue(makeReport());
    const wclClient = {
      fetchAndNormalizeReport,
      findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
    } as never;
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'mixed',
        accountabilityVisibility: 'officers-only',
        coachingShareabilityDefault: 'shareable',
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const recapPreviewStateService = {
      savePreviewState: vi.fn().mockResolvedValue(undefined),
      getValidPreviewState: vi.fn(),
      consumeValidPreviewState: vi.fn(),
      deletePreviewState: vi.fn(),
    };
    const scheduledTasks: Array<() => void> = [];

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        member: { user: { id: 'user-1' } },
        data: {
          name: 'recap',
          options: [
            {
              name: 'url',
              value: 'https://www.warcraftlogs.com/reports/ABC123',
            },
          ],
        },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
        scheduleBackgroundTask: (task) => scheduledTasks.push(task),
      },
    );

    expect(response).toMatchObject({ type: expect.any(Number) });
    expect(scheduledTasks).toHaveLength(1);
    expect(fetchAndNormalizeReport).not.toHaveBeenCalled();
  });

  it.each([
    [
      new Error('WCL OAuth failed: 401'),
      'Warcraft Logs authentication failed; check server configuration.',
    ],
    [
      new Error('Unexpected WCL payload shape'),
      'Warcraft Logs returned an unexpected payload for that report.',
    ],
    [
      new Error('Could not find a Warcraft Logs report code in the URL'),
      "I couldn't find a Warcraft Logs report code in that URL. Paste the full report link.",
    ],
  ])('edits the deferred response with a useful recap failure message', async (error, content) => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockRejectedValue(error),
      findPreviousRaidSummaries: vi.fn(),
    } as never;
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'mixed',
        accountabilityVisibility: 'officers-only',
        coachingShareabilityDefault: 'shareable',
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const recapPreviewStateService = {
      savePreviewState: vi.fn(),
      getValidPreviewState: vi.fn(),
      consumeValidPreviewState: vi.fn(),
      deletePreviewState: vi.fn(),
    };
    const editFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', editFetch);

    await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        member: { user: { id: 'user-1' } },
        data: {
          name: 'recap',
          options: [
            {
              name: 'url',
              value: 'https://www.warcraftlogs.com/reports/ABC123',
            },
          ],
        },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
      },
    );

    await vi.waitFor(() => {
      expect(editFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    const patchCall = editFetch.mock.calls.find(
      ([url]) =>
        typeof url === 'string' &&
        url.includes('/webhooks/') &&
        url.includes('/messages/@original'),
    );
    const body =
      patchCall?.[1] && typeof patchCall[1] === 'object' && 'body' in patchCall[1]
        ? (patchCall[1] as { body: string }).body
        : '{}';
    expect(JSON.parse(body)).toMatchObject({ content, flags: 64 });
    expect(recapPreviewStateService.savePreviewState).not.toHaveBeenCalled();
  });

  it('returns an ephemeral error when preview state is missing or expired', async () => {
    const recapPreviewStateService = {
      savePreviewState: vi.fn(),
      getValidPreviewState: vi.fn().mockResolvedValue(null),
      consumeValidPreviewState: vi.fn().mockResolvedValue(null),
      deletePreviewState: vi.fn(),
    };
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn(),
      saveGuildConfig: vi.fn(),
    };
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;

    const response = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: 'recap:v1:post:ABC123:guild-1' },
      },
      { wclClient, guildConfigStore, recapPreviewStateService },
    );

    expect(response).toMatchObject({
      type: expect.any(Number),
      data: {
        content:
          'This recap preview has already been posted or expired. Please run /recap with the URL again.',
        flags: 64,
      },
    });
  });

  it('treats duplicate post attempts as idempotent and skips side effects on replay', async () => {
    const recapPreviewStateService = {
      savePreviewState: vi.fn(),
      getValidPreviewState: vi.fn(),
      consumeValidPreviewState: vi
        .fn()
        .mockResolvedValueOnce({
          guildId: 'guild-1',
          channelId: 'channel-1',
          reportCode: 'ABC123',
          sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
          summaryPayload: {
            ...makePreviewSummary(),
            coachingShareability: 'private',
          },
          createdByUserId: 'user-1',
          createdAt: new Date(0),
          expiresAt: new Date(Date.now() + 60_000),
          interactionId: 'preview-interaction-1',
          messageId: 'preview-message-1',
        })
        .mockResolvedValueOnce(null),
      deletePreviewState: vi.fn(),
    };
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn(),
      saveGuildConfig: vi.fn(),
    };
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;

    const firstResponse = await handleInteraction(
      {
        id: 'post-interaction-1',
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: 'recap:v1:post:ABC123:guild-1' },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
      },
    );

    const secondResponse = await handleInteraction(
      {
        id: 'post-interaction-2',
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: 'recap:v1:post:ABC123:guild-1' },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
      },
    );

    expect((firstResponse as { data?: { embeds?: unknown[] } }).data?.embeds).toHaveLength(1);
    expect(secondResponse).toMatchObject({
      type: expect.any(Number),
      data: {
        content:
          'This recap preview has already been posted or expired. Please run /recap with the URL again.',
        flags: 64,
      },
    });
    expect(recapPreviewStateService.consumeValidPreviewState).toHaveBeenNthCalledWith(1, {
      reportCode: 'ABC123',
      guildId: 'guild-1',
    });
    expect(recapPreviewStateService.consumeValidPreviewState).toHaveBeenNthCalledWith(2, {
      reportCode: 'ABC123',
      guildId: 'guild-1',
    });
  });

  it('does not support retired officer recap action', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;

    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn(),
      saveGuildConfig: vi.fn(),
    };

    const recapPreviewStateService = {
      savePreviewState: vi.fn(),
      getValidPreviewState: vi.fn().mockResolvedValue(null),
      consumeValidPreviewState: vi.fn(),
      deletePreviewState: vi.fn(),
    };

    const restricted = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: 'recap:v1:officers:ABC123:guild-1' },
      },
      { wclClient, guildConfigStore, recapPreviewStateService },
    );

    expect((restricted as { data?: { content?: string } }).data?.content).toMatch(
      /unsupported recap action/i,
    );
  });
});

describe('embed rendering', () => {
  it('uses cleaned domain recap title for public recap embed', () => {
    const summary = buildRecapSummary({
      reportCode: 'ABC123',
      title: 'Throne of Thunder',
      startTime: Date.UTC(2025, 0, 2),
      endTime: Date.UTC(2025, 0, 2, 1),
      gameFamily: 'retail',
      zoneName: 'Throne of Thunder',
      fights: [{ id: 1, name: 'Lei Shen', startTime: 0, endTime: 1, kill: true }],
      players: [],
      bossPerformances: [
        {
          bossName: 'Lei Shen',
          fightId: 1,
          kill: true,
          zoneName: 'Throne of Thunder',
          difficultyName: 'Heroic',
          fightDate: Date.UTC(2025, 0, 3),
        },
      ],
    });
    const embed = buildPublicRecapEmbed(summary);

    expect(summary.titleLine).toBe('Throne of Thunder - Heroic');
    expect(embed.title).toBe(summary.titleLine);
    expect(embed.title).not.toContain('Throne of Thunder - Throne of Thunder');
  });

  it('renders report-wide recap field set', () => {
    const embed = buildPublicRecapEmbed({
      ...makePreviewSummary(),
      topDamageDone: [{ playerName: 'Alyra', value: 250000, classSpecLabel: 'Shadow Priest' }],
      topHealingDone: [{ playerName: 'Healz', value: 67890, classSpecLabel: 'Mistweaver Monk' }],
      topDamageTaken: [
        { playerName: 'Bulwark', value: 120000, classSpecLabel: 'Protection Warrior' },
      ],
      topInterrupts: [{ playerName: 'Bulwark', value: 11 }],
      topDispels: [{ playerName: 'Pearl', value: 8 }],
      topSurvivability: [{ playerName: 'Alyra', value: 98.2 }],
      topHealers: [{ playerName: 'Healz', value: 67890, classSpecLabel: 'Mistweaver Monk' }],
      totals: {
        totalDeaths: 5,
        raidDamageTaken: 1234567,
        dispels: 8,
        battleRezzes: 2,
        kicks: 11,
      },
      highestParses: [
        { playerName: 'Kaltsit', metric: 'DPS', value: 90, bossName: 'Horridon' },
        { playerName: 'Bustinsihder', metric: 'HPS', value: 89, bossName: 'Horridon' },
        { playerName: 'Jokerofpain', metric: 'DPS', value: 81, bossName: 'Horridon' },
      ],
      topDamageAverageParses: [
        { playerName: 'Kaltsit', value: 61 },
        { playerName: 'Jokerofpain', value: 61 },
        { playerName: 'Venomblàdez', value: 57 },
      ],
      topHealingAverageParses: [
        { playerName: 'Bustinsihder', value: 70 },
        { playerName: 'Emerald', value: 54 },
      ],
      bossHighlights: [{ bossName: 'One-Armed Bandit', fightId: 11, text: 'Kill secured.' }],
      bestExecution: { playerName: 'Alyra', value: 94.2 },
      mostImprovedPlayer: { playerName: 'Pearl', delta: 5.2 },
      raidSuperlatives: [{ label: 'Raid deaths', text: '5 total raid deaths' }],
    });

    expect(embed.title).toBe('Boss - Mythic - Zone');
    expect(
      embed.fields.filter((field) => field.name !== '\u200B').map((field) => field.name),
    ).toEqual([
      '🏁 Raid Snapshot',
      '⚡ Performance',
      '🎛️ Output & Intake',
      '🎯 Utility & Execution',
      '🔗 Warcraft Logs',
    ]);
    const outcome = embed.fields.find((field) => field.name === '🏁 Raid Snapshot')?.value ?? '';
    const performance =
      embed.fields.find((field) => field.name === '⚡ Performance')?.value ?? '';
    const output = embed.fields.find((field) => field.name === '🎛️ Output & Intake')?.value ?? '';
    const execution =
      embed.fields.find((field) => field.name === '🎯 Utility & Execution')?.value ?? '';
    const logs = embed.fields.find((field) => field.name === '🔗 Warcraft Logs')?.value ?? '';
    const domainDivider = '━━━━━━━━━━━━━━━━━━━━';

    expect(output).not.toContain('Most wipes:');
    expect(performance).toContain('▸ __**Highest Parse**__');
    expect(performance).toContain('▸ __**Damage Parse Averages**__');
    expect(performance).toContain('▸ __**Healing Parse Averages**__');
    expect(performance).toContain('  #1 **Kaltsit** · DPS parse: 90.0 on Horridon');
    expect(performance).toContain('  #2 **Bustinsihder** · HPS parse: 89.0 on Horridon');
    expect(performance).toContain('  #3 **Jokerofpain** · DPS parse: 81.0 on Horridon');
    expect(performance).toContain('  #1 **Kaltsit** · average parse: 61');
    expect(performance).toContain('  #2 **Jokerofpain** · average parse: 61');
    expect(performance).toContain('  #3 **Venomblàdez** · average parse: 57');
    expect(performance).toContain('  #1 **Bustinsihder** · average parse: 70');
    expect(performance).toContain('  #2 **Emerald** · average parse: 54');
    expect(performance).not.toContain('Signature Parses');
    expect(performance).not.toContain('Player Standouts');
    expect(performance).not.toContain('Overall Parses');
    expect(performance).not.toContain('Damage Parses');
    expect(performance).not.toContain('Healing Parses');
    expect(performance).not.toContain('DTPS parse');
    expect(performance).not.toContain('damage done');
    expect(performance).not.toContain('healing');
    expect(performance).not.toContain('parsed 61');
    expect(outcome).toContain('  ☠️ Deaths: 5');
    expect(outcome).toContain('  🩸 Raid-wide damage taken: 1.2M');
    expect(outcome).toContain('  🦵 Kicks: 11');
    expect(outcome).toContain('  🪄 Dispels: 8');
    expect(outcome).toContain('  ♻️ Battle rezzes: 2');
    expect(outcome).toContain(
      '▸ __**Boss Highlights**__\n  • **One-Armed Bandit** · Kill secured.\n\n▸ __**Raid Totals**__',
    );
    expect(outcome.endsWith(`\n\n${domainDivider}`)).toBe(true);
    expect(output).not.toContain('Damage taken: 1.2M');
    expect(performance.endsWith(`\n\n${domainDivider}`)).toBe(true);
    expect(performance).not.toContain('Note: Parses are WCL percentiles');
    expect(logs).toBe(
      'https://www.warcraftlogs.com/reports/ABC123\n\n*Note: Parses are WCL percentiles; damage/healing values are totals across included boss kills and not including damage/healing for wipes.*',
    );
    expect(execution).not.toContain('Best boss parse');
    expect(execution).toContain('Best execution');
    expect(execution).toContain('Most improved');
    expect(performance).not.toMatch(/^\s+\d+\./m);
    expect(performance).not.toMatch(/\d(?:\.\d+)?[KMB] (?:DPS|HPS|DTPS)\b/);
    for (const removedTierBadge of ['🩷', '🟧', '🟪', '🟦', '🟩', '⬛']) {
      expect(performance).not.toContain(removedTierBadge);
    }
    for (const rowMetricIcon of ['⚔️ **Alyra**', '💚 **Pearl**', '🛡️ **Bulwark**']) {
      expect(performance).not.toContain(rowMetricIcon);
    }
    expect(outcome).toContain('  • **One-Armed Bandit** · Kill secured.');
    expect(output).toContain('▸ __**Damage Done**__\n  #1 **Alyra** · 250K · Shadow Priest');
    expect(output).toContain('▸ __**Healing Done**__\n  #1 **Healz** · 67.9K · Mistweaver Monk');
    expect(output).toContain('▸ __**Damage Taken**__\n  #1 **Bulwark** · 120K · Protection Warrior');
    expect(output.endsWith(`\n\n${domainDivider}`)).toBe(true);
    expect(output).not.toMatch(/^\s+\d+\./m);
    expect(output).not.toContain('Shadow Priest,');
    expect(execution).toContain('▸ __**Top Interrupts**__\n  #1 **Bulwark** · 11');
    expect(execution).not.toMatch(/^\s+\d+\./m);
    expect(execution).toContain('▸ __**Raid Notes**__');
    expect(execution).not.toContain('Raid Superlatives');
    expect(execution).not.toContain('**Bulwark** 11,');
    expect(execution).not.toContain('parse');
    expect(execution).not.toContain(domainDivider);
    expect(logs).not.toContain(domainDivider);
  });

  it('omits top overall healing parse when parse rows do not exist', () => {
    const embed = buildPublicRecapEmbed({
      ...makePreviewSummary(),
      topHealers: [
        { playerName: 'Pearl', value: 4800, classSpecLabel: 'Restoration Shaman' },
        { playerName: 'Floorroller', value: 48423, classSpecLabel: 'Mistweaver Monk' },
      ],
    });

    expect(embed.fields.find((field) => field.name === '⚡ Performance')).toBeUndefined();
  });

  it('degrades cleanly when optional fields are missing', () => {
    const embed = buildPublicRecapEmbed({
      ...makePreviewSummary(),
    });

    expect(
      embed.fields.filter((field) => field.name !== '\u200B').map((field) => field.name),
    ).toEqual(['🏁 Raid Snapshot', '🔗 Warcraft Logs']);
  });

  it('formats non-kill boss highlight rows as progress pulls', () => {
    const embed = buildPublicRecapEmbed({
      ...makePreviewSummary(),
      bossHighlights: [{ bossName: 'Horridon', fightId: 2, text: 'Wipe at 52%.' }],
    });

    expect(embed.fields.find((field) => field.name === '🏁 Raid Snapshot')?.value).toContain(
      '• **Horridon** · Wipe at 52%.',
    );
  });

  it('does not render duplicate player rows in report-wide parse sections', () => {
    const summary = buildRecapSummary({
      reportCode: 'ABC123',
      title: 'Raid Night',
      startTime: Date.UTC(2025, 0, 2),
      endTime: Date.UTC(2025, 0, 2, 1),
      gameFamily: 'retail',
      fights: [],
      players: [],
      reportWideRankings: {
        dps: [
          {
            scope: 'report',
            playerName: 'Tankhem',
            metric: 'rankPercent',
            selectedMetric: 'DPS',
            role: 'dps',
            value: 80,
            rankPercent: 80,
            bossName: 'Horridon',
            fightId: 4,
          },
          {
            scope: 'report',
            playerName: 'Tankhem',
            metric: 'rankPercent',
            selectedMetric: 'DPS',
            role: 'dps',
            value: 80,
            rankPercent: 80,
            bossName: 'Horridon',
            fightId: 4,
            className: 'DeathKnight',
            specName: 'Blood',
          },
        ],
        hps: [
          {
            scope: 'report',
            playerName: 'Pearl',
            metric: 'rankPercent',
            selectedMetric: 'HPS',
            role: 'healer',
            value: 96.3,
            rankPercent: 96.3,
            bossName: 'Horridon',
            fightId: 4,
          },
        ],
      },
    });
    const embed = buildPublicRecapEmbed(summary);

    const performanceField =
      embed.fields.find((field) => field.name === '⚡ Performance')?.value ?? '';
    const sectionValue = (label: string): string =>
      performanceField.split(`▸ __**${label}**__\n`)[1]?.split('\n\n▸ __**')[0] ?? '';

    expect(sectionValue('Highest Parse').match(/Tankhem/g)).toHaveLength(1);
    expect(sectionValue('Damage Parse Averages').match(/Tankhem/g)).toHaveLength(1);
  });
});

describe('preview rendering', () => {
  it('includes required compact preview lines', () => {
    const body = buildRecapPreviewBody(
      {
        ...makePreviewSummary(),
        highestParses: [{ playerName: 'Alyra', value: 99, metric: 'DPS', bossName: 'Megaera' }],
        topDamageAverageParses: [{ playerName: 'Alyra', value: 61 }],
        topHealingAverageParses: [{ playerName: 'Emerald', value: 54 }],
      },
      'ABC123',
      'guild-1',
    );

    const description =
      (body.embeds?.[0] as { description?: string } | undefined)?.description ?? '';
    const title = (body.embeds?.[0] as { title?: string } | undefined)?.title ?? '';
    expect(body.content).toBe(
      'Review this preview before posting for everyone to see; cancel if you pasted the wrong link.',
    );
    expect(title).toBe('Preview: Boss - Mythic - Zone');
    expect(description).toContain('Guild on Realm-US');
    expect(description).toContain('45 Min · 9 pulls · 01/01/1970');
    expect(description).toContain('**Top Line:**');
    expect(description).toContain('Highest parse: Alyra · DPS parse: 99.0 on Megaera');
    expect(description).toContain('Damage average: Alyra · average parse: 61');
    expect(description).toContain('Healing average: Emerald · average parse: 54');
    expect(description).toContain('☠️ Deaths: 0 · 🦵 Kicks: 0 · 🪄 Dispels: 0');
    expect(description).not.toContain('[object Object]');
  });

  it('renders compact preview metadata line', () => {
    const body = buildRecapPreviewBody(
      {
        ...makePreviewSummary(),
        killTimeLabel: '01 Hour 09 Min',
      },
      'ABC123',
      'guild-1',
    );

    const description =
      (body.embeds?.[0] as { description?: string } | undefined)?.description ?? '';
    expect(description).toContain('01 Hour 09 Min · 9 pulls · 01/01/1970');
  });

  it('does not stringify boss highlight objects in preview metadata', () => {
    const body = buildRecapPreviewBody(
      {
        ...makePreviewSummary(),
        bossHighlights: [
          { bossName: 'Megaera', fightId: 1, text: 'Kill in 05 Min.' },
          { bossName: 'Ji-Kun', fightId: 2, text: 'Wipe at 4%.' },
        ],
      },
      'ABC123',
      'guild-1',
    );

    const description =
      (body.embeds?.[0] as { description?: string } | undefined)?.description ?? '';
    expect(description).toContain('45 Min · 9 pulls · 01/01/1970');
    expect(description).not.toContain('[object Object]');
  });

  it('uses durable recap component ids for preview buttons', () => {
    const body = buildRecapPreviewBody(
      {
        ...makePreviewSummary(),
      },
      'ABC123',
      'guild-1',
    );

    type PreviewButton = {
      custom_id?: string;
      label?: string;
    };

    const buttons = (body.components?.[0]?.components as PreviewButton[] | undefined) ?? [];
    const postButton = buttons.find((button) => button.custom_id?.includes(':post:'));
    const cancelButton = buttons.find((button) => button.custom_id?.includes(':cancel:'));

    expect(postButton?.custom_id).toBe('recap:v1:post:ABC123:guild-1');
    expect(postButton?.label).toBe('Post to Current Channel');
    expect(cancelButton?.custom_id).toBe('recap:v1:cancel:ABC123:guild-1');
    expect(cancelButton?.label).toBe('Cancel');
  });
});
