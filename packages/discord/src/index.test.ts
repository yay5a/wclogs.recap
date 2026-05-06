import { describe, expect, it, vi, afterEach } from 'vitest';
import { InteractionResponseType, InteractionType } from 'discord-interactions';
import type {
  ComparisonSnapshotInput,
  GuildConfig,
  GuildConfigStore,
  NormalizedPlayer,
  NormalizedReport,
} from '@wcl/domain';
import { buildRecapSummary } from '@wcl/domain';
import {
  buildRecapPreviewBody,
  buildPublicRecapEmbed,
  buildDiscordCommandPayload,
  buildDiscordCommandPayloads,
  commandDefinitions,
  DiscordCommandRegistrationError,
  handleInteraction,
  handleAutoRecapMessageCreate,
  makeAutoRecapDuplicateCustomId,
  makeAutoRecapPromptIgnoreCustomId,
  makeAutoRecapPromptPreviewCustomId,
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

const makeReportWithComparisonIdentity = (): NormalizedReport => ({
  ...makeReport(),
  startTime: Date.UTC(2026, 3, 9),
  players: [
    {
      id: '1',
      actorId: 1,
      warcraftLogsActorId: 7,
      warcraftLogsGuid: 99060818,
      name: 'Alyra',
      realm: 'Stormrage',
      server: 'Stormrage',
      region: 'US',
      bestParse: 90,
      avgParse: 85,
      executionScore: 88,
    },
  ],
  reportWideRankings: {
    dps: [
      {
        scope: 'report',
        playerId: 7,
        playerName: 'Alyra',
        metric: 'rankPercent',
        value: 82,
        rankPercent: 82,
      },
    ],
    hps: [],
  },
  reportWideRecap: {
    topDamageDone: [{ playerName: 'Alyra', value: 1234 }],
    topHealingDone: [{ playerName: 'Alyra', value: 567 }],
    topInterrupts: [{ playerName: 'Alyra', value: 5 }],
    topDispels: [{ playerName: 'Alyra', value: 1 }],
    totals: {},
  },
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
  it('registers compare privacy and character claim command surface', () => {
    expect(commandDefinitions.map((command) => command.name)).toEqual([
      'health',
      'config',
      'add_officer',
      'remove_officer',
      'list_officers',
      'recap',
      'compare',
      'claim_character',
      'approve_character',
      'reject_character',
      'my_characters',
      'compare_privacy',
    ]);
    const configCommand = commandDefinitions.find((command) => command.name === 'config');
    if (!configCommand || !('options' in configCommand)) {
      throw new Error('Expected config command options');
    }
    expect(configCommand.default_member_permissions).toBe('32');
    const optionNames = configCommand.options?.map((option) => option.name) ?? [];
    expect(optionNames).toEqual([
      'game_family',
      'compare_mode',
      'compare_access_mode',
      'compare_public_posting',
      'auto_recap_mode',
      'auto_recap_channel',
    ]);
    expect(configCommand.options).toContainEqual(
      expect.objectContaining({
        name: 'auto_recap_mode',
        choices: [
          { name: 'off', value: 'off' },
          { name: 'prompt', value: 'prompt' },
          { name: 'auto_preview', value: 'auto_preview' },
          { name: 'auto_post', value: 'auto_post' },
        ],
      }),
    );
    expect(configCommand.options).toContainEqual(
      expect.objectContaining({
        name: 'compare_access_mode',
        choices: [
          { name: 'officer_only', value: 'officer_only' },
          { name: 'owner_or_officer', value: 'owner_or_officer' },
          { name: 'owner_opt_in_or_officer', value: 'owner_opt_in_or_officer' },
          { name: 'owner_only', value: 'owner_only' },
        ],
      }),
    );
    expect(configCommand.options).toContainEqual(
      expect.objectContaining({
        name: 'auto_recap_channel',
        type: 7,
        channel_types: [0, 5],
      }),
    );

    expect(commandDefinitions.find((command) => command.name === 'add_officer')).toMatchObject({
      type: 1,
      default_member_permissions: '32',
      options: [{ name: 'user', type: 6, required: true }],
    });
    expect(commandDefinitions.find((command) => command.name === 'remove_officer')).toMatchObject({
      type: 1,
      default_member_permissions: '32',
      options: [{ name: 'user', type: 6, required: true }],
    });
    const listOfficersCommand = commandDefinitions.find(
      (command) => command.name === 'list_officers',
    );
    expect(listOfficersCommand).toMatchObject({
      type: 1,
    });
    expect(listOfficersCommand?.default_member_permissions).toBeUndefined();

    const compareCommand = commandDefinitions.find((command) => command.name === 'compare');
    if (!compareCommand || !('options' in compareCommand)) {
      throw new Error('Expected compare command options');
    }
    expect(compareCommand.options).toMatchObject([
      { name: 'report', type: 3, required: true },
      { name: 'character', type: 3, required: true },
      {
        name: 'mode',
        type: 3,
        required: true,
        choices: [
          { name: 'character', value: 'character' },
          { name: 'mixed', value: 'mixed' },
        ],
      },
      {
        name: 'visibility',
        type: 3,
        required: false,
        choices: [
          { name: 'private', value: 'private' },
          { name: 'public', value: 'public' },
        ],
      },
    ]);

    for (const command of commandDefinitions) {
      if (['config', 'add_officer', 'remove_officer'].includes(command.name)) continue;
      expect(command.default_member_permissions).toBeUndefined();
    }

    expect(commandDefinitions.find((command) => command.name === 'claim_character')).toMatchObject({
      type: 1,
      options: [
        { name: 'character', type: 3, required: true },
        { name: 'realm', type: 3, required: true },
        { name: 'region', type: 3, required: true },
      ],
    });
  });

  it('builds the registered config command payload with Manage Server permission', () => {
    const configCommand = commandDefinitions.find((command) => command.name === 'config');
    if (!configCommand) {
      throw new Error('Expected config command');
    }

    const payload = buildDiscordCommandPayload(configCommand);

    expect(payload).toMatchObject({
      name: 'config',
      type: 1,
      default_member_permissions: '32',
    });
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
  const makeGuildConfig = (overrides: Partial<GuildConfig> = {}): GuildConfig => ({
    guildId: 'guild-1',
    defaultGameFamily: 'retail',
    compareModeDefault: 'character',
    compareAccessMode: 'officer_only',
    compareOfficerUserIds: [],
    dashboardOfficerAccessEnabled: false,
    comparePublicPostingEnabled: false,
    recapPostModeDefault: 'preview-and-post',
    autoRecapMode: 'prompt',
    autoRecapChannelIds: [],
    ...overrides,
  });

  const makeConfigOptions = (
    saveGuildConfig: GuildConfigStore['saveGuildConfig'],
    existingConfig: Partial<Awaited<ReturnType<GuildConfigStore['getGuildConfig']>>> = {},
  ) => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue(makeGuildConfig(existingConfig)),
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

  const makeGuildConfigStore = (overrides: Partial<GuildConfig> = {}): GuildConfigStore => ({
    getGuildConfig: vi.fn().mockResolvedValue(makeGuildConfig(overrides)),
    saveGuildConfig: vi.fn(),
  });

  const makeRecapPreviewStateService = () => ({
    savePreviewState: vi.fn(),
    getValidPreviewState: vi.fn(),
    consumeValidPreviewState: vi.fn(),
    deletePreviewState: vi.fn(),
  });

  const makeHistorySnapshot = (
    overrides: Partial<ComparisonSnapshotInput> = {},
  ): ComparisonSnapshotInput => ({
    guildId: 'guild-1',
    reportCode: 'OLD1',
    reportStartedAt: new Date(Date.UTC(2026, 2, 1)),
    participantKey: 'character:us:stormrage:alyra',
    characterName: 'Alyra',
    region: 'US',
    realm: 'Stormrage',
    rankPercent: 66.5,
    damageTotal: 1000,
    healingTotal: 100,
    deaths: 1,
    interrupts: 5,
    dispels: 8,
    ...overrides,
  });

  const makeCharacterClaimStore = (
    overrides: Partial<{
      findApprovedClaimForUserCharacter: ReturnType<typeof vi.fn>;
      findApprovedClaimsForParticipant: ReturnType<typeof vi.fn>;
      requestCharacterClaim: ReturnType<typeof vi.fn>;
      approveCharacterClaim: ReturnType<typeof vi.fn>;
      rejectCharacterClaim: ReturnType<typeof vi.fn>;
      updateClaimPrivacy: ReturnType<typeof vi.fn>;
      listClaimsForUser: ReturnType<typeof vi.fn>;
    }> = {},
  ) => ({
    requestCharacterClaim: vi.fn().mockResolvedValue(undefined),
    approveCharacterClaim: vi.fn().mockResolvedValue(null),
    rejectCharacterClaim: vi.fn().mockResolvedValue(undefined),
    findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(null),
    findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([]),
    updateClaimPrivacy: vi.fn().mockResolvedValue(undefined),
    listClaimsForUser: vi.fn().mockResolvedValue([]),
    ...overrides,
  });

  const makeApprovedClaim = (overrides: Record<string, unknown> = {}) => ({
    guildId: 'guild-1',
    discordUserId: 'user-1',
    participantKey: 'character:us:stormrage:alyra',
    characterName: 'Alyra',
    region: 'US',
    realm: 'Stormrage',
    status: 'approved',
    peerCompareOptIn: false,
    publicPostOptIn: false,
    requestedAt: new Date(Date.UTC(2026, 2, 1)),
    ...overrides,
  });

  const makeUnrelatedApprovedClaim = (overrides: Record<string, unknown> = {}) =>
    makeApprovedClaim({
      discordUserId: 'peer-1',
      participantKey: 'character:us:stormrage:bravo',
      characterName: 'Bravo',
      ...overrides,
    });

  const makeClaimedCompareStore = (overrides: Parameters<typeof makeCharacterClaimStore>[0] = {}) =>
    makeCharacterClaimStore({
      listClaimsForUser: vi.fn().mockResolvedValue([makeApprovedClaim()]),
      ...overrides,
    });

  const makeCompareInteraction = (
    mode: string,
    character = 'Alyra',
    overrides: {
      visibility?: string;
      member?: {
        user?: { id?: string };
        roles?: string[];
        permissions?: string | number;
      };
    } = {},
  ) => ({
    type: InteractionType.APPLICATION_COMMAND,
    id: 'compare-interaction-1',
    application_id: 'app-1',
    token: 'token-1',
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    member: overrides.member ?? { user: { id: 'user-1' }, permissions: '32' },
    data: {
      name: 'compare',
      options: [
        { name: 'report', value: 'https://www.warcraftlogs.com/reports/ABC123' },
        { name: 'character', value: character },
        { name: 'mode', value: mode },
        ...(overrides.visibility ? [{ name: 'visibility', value: overrides.visibility }] : []),
      ],
    },
  });

  const makeDiscordFetchResponse = ({
    ok = true,
    status = ok ? 200 : 500,
    statusText = ok ? 'OK' : 'Internal Server Error',
    body = JSON.stringify({ id: 'message-1', flags: 0 }),
  }: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    body?: string;
  } = {}) => ({
    ok,
    status,
    statusText,
    headers: new Headers(),
    text: vi.fn().mockResolvedValue(body),
  });

  const parseEditedOriginalResponseBodies = (
    editFetch: ReturnType<typeof vi.fn>,
  ): Array<{ content?: string; flags?: number }> => {
    const patchCalls = editFetch.mock.calls.filter(
      ([url]) =>
        typeof url === 'string' &&
        url.includes('/webhooks/') &&
        url.includes('/messages/@original'),
    );
    return patchCalls.map((patchCall) => {
      const body =
        patchCall?.[1] &&
        typeof patchCall[1] === 'object' &&
        'body' in (patchCall[1] as Record<string, unknown>)
          ? (patchCall[1] as { body: string }).body
          : '{}';
      return JSON.parse(body) as { content?: string; flags?: number };
    });
  };

  const parseEditedOriginalResponseBody = (
    editFetch: ReturnType<typeof vi.fn>,
  ): { content?: string; flags?: number } => {
    const bodies = parseEditedOriginalResponseBodies(editFetch);
    return bodies.at(-1) ?? {};
  };

  const runDeferredCompare = async ({
    report = makeReportWithComparisonIdentity(),
    history,
    character = 'Alyra',
    interaction = makeCompareInteraction('character', character),
    guildConfigStore = makeGuildConfigStore(),
    characterClaimStore = makeClaimedCompareStore(),
    editFetch,
    botActivityStore,
  }: {
    report?: NormalizedReport;
    history: ComparisonSnapshotInput[];
    character?: string;
    interaction?: ReturnType<typeof makeCompareInteraction>;
    guildConfigStore?: GuildConfigStore;
    characterClaimStore?: ReturnType<typeof makeCharacterClaimStore>;
    editFetch?: ReturnType<typeof vi.fn>;
    botActivityStore?: { recordActivity: ReturnType<typeof vi.fn> };
  }) => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(report),
      findPreviousRaidSummaries: vi.fn(),
    } as never;
    const comparisonHistoryStore = {
      saveComparisonSnapshot: vi.fn(),
      findCharacterHistory: vi.fn().mockResolvedValue(history),
    };
    const fetchMock =
      editFetch ??
      vi.fn((_url: string, init?: { method?: string }) => {
        const body =
          init?.method === 'POST'
            ? JSON.stringify({ id: 'followup-message-1', flags: 0 })
            : JSON.stringify({ id: 'original-message-1', flags: 64 });
        return Promise.resolve(makeDiscordFetchResponse({ body }));
      });
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleInteraction(interaction, {
      wclClient,
      guildConfigStore,
      recapPreviewStateService: makeRecapPreviewStateService(),
      comparisonHistoryStore,
      characterClaimStore,
      botActivityStore,
    });

    expect(response).toMatchObject({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });

    await vi.waitFor(() => {
      const editedBodies = parseEditedOriginalResponseBodies(fetchMock);
      expect(editedBodies.length).toBeGreaterThan(0);
      expect(editedBodies.at(-1)?.content).not.toBe('Posting comparison...');
    });

    return {
      initialResponse: response,
      body: parseEditedOriginalResponseBody(fetchMock),
      comparisonHistoryStore,
      characterClaimStore,
      wclClient,
      editFetch: fetchMock,
    };
  };

  it('blocks config saves for members without Manage Server permission', async () => {
    const saveGuildConfig = vi.fn();
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '0' },
        data: {
          name: 'config',
          options: [{ name: 'compare_mode', value: 'mixed' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: {
        content: 'This action requires Manage Server permission.',
        flags: 64,
      },
    });
  });

  it('allows a member with Manage Server permission to save mixed as the guild default comparison policy', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      recapPostModeDefault: 'preview-only',
    });
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '32' },
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
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Default comparison mode set to mixed. Future comparisons will use mapped player history when available. Alts are not guessed automatically.',
    );
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      '**wclogs.recap setup status**',
    );
    expect((response as { data?: { content?: string } }).data?.content).not.toMatch(/trend/i);
  });

  it('allows an administrator to save character as the guild default comparison policy', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      recapPostModeDefault: 'preview-and-post',
    });
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '8' },
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
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Default comparison mode set to character. Future comparisons will match exact character history unless a command overrides it.',
    );
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Auto recap: `prompt`',
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
        member: { permissions: '32' },
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

  it('returns setup status without saving when config has no options', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      recapPostModeDefault: 'preview-and-post',
    });
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '32' },
        data: {
          name: 'config',
          options: [],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      '**wclogs.recap setup status**',
    );
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Auto recap channels: none configured',
    );
  });

  it('saves compare access mode and public posting config', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      compareAccessMode: 'owner_only',
      compareOfficerUserIds: [],
      comparePublicPostingEnabled: true,
      recapPostModeDefault: 'preview-and-post',
    });
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '32' },
        data: {
          name: 'config',
          options: [
            { name: 'compare_access_mode', value: 'owner_only' },
            { name: 'compare_public_posting', value: true },
          ],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      compareAccessMode: 'owner_only',
      comparePublicPostingEnabled: true,
    });
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Compare access mode set to owner_only.',
    );
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Public compare posting enabled.',
    );
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      '**wclogs.recap setup status**',
    );
    expect((response as { data?: { content?: string } }).data?.content).not.toMatch(/trend/i);
  });

  it('toggles auto recap channels and de-dupes channel ids', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      compareAccessMode: 'officer_only',
      comparePublicPostingEnabled: false,
      recapPostModeDefault: 'preview-and-post',
      autoRecapMode: 'prompt',
      autoRecapChannelIds: ['channel-2'],
    });
    const options = makeConfigOptions(saveGuildConfig, {
      autoRecapChannelIds: ['channel-1', 'channel-1', 'channel-2'],
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '32' },
        data: {
          name: 'config',
          options: [{ name: 'auto_recap_channel', value: 'channel-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      autoRecapChannelIds: ['channel-2'],
    });
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Auto recap disabled in <#channel-1>.',
    );
  });

  it('sets auto recap mode off while preserving configured channels', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      compareAccessMode: 'officer_only',
      comparePublicPostingEnabled: false,
      recapPostModeDefault: 'preview-and-post',
      autoRecapMode: 'off',
      autoRecapChannelIds: ['channel-1'],
    });
    const options = makeConfigOptions(saveGuildConfig, {
      autoRecapMode: 'prompt',
      autoRecapChannelIds: ['channel-1'],
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '32' },
        data: {
          name: 'config',
          options: [{ name: 'auto_recap_mode', value: 'off' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      autoRecapMode: 'off',
    });
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Passive detection is currently disabled. Configured channels are preserved.',
    );
  });

  it('allows Manage Server users to enable auto_post through config', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      compareAccessMode: 'officer_only',
      comparePublicPostingEnabled: false,
      recapPostModeDefault: 'preview-and-post',
      autoRecapMode: 'auto_post',
      autoRecapChannelIds: [],
    });
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '32' },
        data: {
          name: 'config',
          options: [{ name: 'auto_recap_mode', value: 'auto_post' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      autoRecapMode: 'auto_post',
    });
    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Auto recap mode set to auto_post.',
    );
  });

  it('rejects invalid compare access modes without saving config', async () => {
    const saveGuildConfig = vi.fn();
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { permissions: '32' },
        data: {
          name: 'config',
          options: [{ name: 'compare_access_mode', value: 'guild_open' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: {
        content:
          'Invalid compare_access_mode. Choose officer_only, owner_or_officer, owner_opt_in_or_officer, owner_only.',
        flags: 64,
      },
    });
  });

  it('blocks non-admins from adding officers', async () => {
    const saveGuildConfig = vi.fn();
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' }, permissions: '0' },
        data: {
          name: 'add_officer',
          options: [{ name: 'user', value: 'officer-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: { content: 'This action requires Manage Server permission.', flags: 64 },
    });
  });

  it('allows Manage Server users to add officers', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue(
      makeGuildConfig({
        compareOfficerUserIds: ['officer-1'],
      }),
    );
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'manager-1' }, permissions: '32' },
        data: {
          name: 'add_officer',
          options: [{ name: 'user', value: 'officer-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      compareOfficerUserIds: ['officer-1'],
    });
    expect(response).toMatchObject({
      data: { content: 'Officer added: <@officer-1>.', flags: 64 },
    });
  });

  it('allows administrators to add officers', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue(
      makeGuildConfig({
        compareOfficerUserIds: ['officer-1'],
      }),
    );
    const options = makeConfigOptions(saveGuildConfig);

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'admin-1' }, permissions: '8' },
        data: {
          name: 'add_officer',
          options: [{ name: 'user', value: 'officer-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      compareOfficerUserIds: ['officer-1'],
    });
    expect(response).toMatchObject({
      data: { content: 'Officer added: <@officer-1>.', flags: 64 },
    });
  });

  it('keeps adding officers idempotent', async () => {
    const saveGuildConfig = vi.fn();
    const options = makeConfigOptions(saveGuildConfig, {
      compareOfficerUserIds: ['officer-1'],
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'manager-1' }, permissions: '32' },
        data: {
          name: 'add_officer',
          options: [{ name: 'user', value: 'officer-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: { content: 'Officer added: <@officer-1>.', flags: 64 },
    });
  });

  it('blocks non-admins from removing officers', async () => {
    const saveGuildConfig = vi.fn();
    const options = makeConfigOptions(saveGuildConfig, {
      compareOfficerUserIds: ['officer-1'],
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' }, permissions: '0' },
        data: {
          name: 'remove_officer',
          options: [{ name: 'user', value: 'officer-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: { content: 'This action requires Manage Server permission.', flags: 64 },
    });
  });

  it('allows Manage Server users to remove officers', async () => {
    const saveGuildConfig = vi.fn().mockResolvedValue(
      makeGuildConfig({
        compareOfficerUserIds: ['officer-2'],
      }),
    );
    const options = makeConfigOptions(saveGuildConfig, {
      compareOfficerUserIds: ['officer-1', 'officer-2'],
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'manager-1' }, permissions: '32' },
        data: {
          name: 'remove_officer',
          options: [{ name: 'user', value: 'officer-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).toHaveBeenCalledWith('guild-1', {
      compareOfficerUserIds: ['officer-2'],
    });
    expect(response).toMatchObject({
      data: { content: 'Officer removed: <@officer-1>.', flags: 64 },
    });
  });

  it('returns a safe response when removing a user who is not an officer', async () => {
    const saveGuildConfig = vi.fn();
    const options = makeConfigOptions(saveGuildConfig, {
      compareOfficerUserIds: ['officer-2'],
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'manager-1' }, permissions: '32' },
        data: {
          name: 'remove_officer',
          options: [{ name: 'user', value: 'officer-1' }],
        },
      },
      options,
    );

    expect(saveGuildConfig).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: {
        content: '<@officer-1> was not configured as an officer.',
        flags: 64,
      },
    });
  });

  it('lets configured officers list officers', async () => {
    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'officer-1' }, permissions: '0' },
        data: { name: 'list_officers' },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore({
          compareOfficerUserIds: ['officer-1', 'officer-2'],
        }),
        recapPreviewStateService: makeRecapPreviewStateService(),
      },
    );

    expect(response).toMatchObject({
      data: {
        content: 'Configured officers:\n<@officer-1>\n<@officer-2>',
        flags: 64,
      },
    });
  });

  it('blocks ordinary users from listing officers', async () => {
    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' }, permissions: '0' },
        data: { name: 'list_officers' },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore({
          compareOfficerUserIds: ['officer-1'],
        }),
        recapPreviewStateService: makeRecapPreviewStateService(),
      },
    );

    expect(response).toMatchObject({
      data: { content: 'This action is limited to authorized officers.', flags: 64 },
    });
  });

  it('returns an empty officer list message', async () => {
    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'manager-1' }, permissions: '32' },
        data: { name: 'list_officers' },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
      },
    );

    expect(response).toMatchObject({
      data: { content: 'No explicit officers are configured.', flags: 64 },
    });
  });

  it('lets a member request an exact character claim', async () => {
    const characterClaimStore = makeCharacterClaimStore();
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' } },
        data: {
          name: 'claim_character',
          options: [
            { name: 'character', value: ' Alyra ' },
            { name: 'realm', value: ' Stormrage ' },
            { name: 'region', value: ' us ' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore,
        botActivityStore,
      },
    );

    expect(characterClaimStore.requestCharacterClaim).toHaveBeenCalledWith({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      participantKey: 'character:us:stormrage:alyra',
      characterName: 'Alyra',
      realm: 'Stormrage',
      region: 'US',
    });
    expect(botActivityStore.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        actor: { kind: 'discord', discordUserId: 'user-1' },
        kind: 'claim_requested',
        characterLabel: 'Alyra - Stormrage-US',
        targetDiscordUserId: 'user-1',
      }),
    );
    expect(response).toMatchObject({
      data: {
        content:
          'Character claim requested. An authorized officer must approve it before comparisons are available.',
        flags: 64,
      },
    });
  });

  it('keeps claim request success separate from dashboard activity failures', async () => {
    const characterClaimStore = makeCharacterClaimStore();
    const botActivityStore = { recordActivity: vi.fn().mockRejectedValue(new Error('activity down')) };

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        id: 'claim-interaction-1',
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' } },
        data: {
          name: 'claim_character',
          options: [
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore,
        botActivityStore,
      },
    );

    expect(characterClaimStore.requestCharacterClaim).toHaveBeenCalledOnce();
    expect(botActivityStore.recordActivity).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      data: {
        content:
          'Character claim requested. An authorized officer must approve it before comparisons are available.',
        flags: 64,
      },
    });
  });

  it('lets officers approve claims and blocks non-officers', async () => {
    const blockedStore = makeCharacterClaimStore();
    const blocked = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-2' } },
        data: {
          name: 'approve_character',
          options: [
            { name: 'user', value: 'user-1' },
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore: blockedStore,
      },
    );

    expect(blockedStore.approveCharacterClaim).not.toHaveBeenCalled();
    expect(blocked).toMatchObject({
      data: {
        content: 'This action is limited to authorized officers.',
        flags: 64,
      },
    });

    const approvedStore = makeCharacterClaimStore({
      approveCharacterClaim: vi.fn().mockResolvedValue(makeApprovedClaim()),
    });
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };
    const approved = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'officer-1' }, permissions: '32' },
        data: {
          name: 'approve_character',
          options: [
            { name: 'user', value: 'user-1' },
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore: approvedStore,
        botActivityStore,
      },
    );

    expect(approvedStore.approveCharacterClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        discordUserId: 'user-1',
        participantKey: 'character:us:stormrage:alyra',
        reviewedByDiscordUserId: 'officer-1',
      }),
    );
    expect(botActivityStore.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        actor: { kind: 'discord', discordUserId: 'officer-1' },
        kind: 'claim_approved',
        characterLabel: 'Alyra - Stormrage-US',
        targetDiscordUserId: 'user-1',
      }),
    );
    expect(approved).toMatchObject({
      data: {
        content: 'Character claim approved for the exact character identity.',
        flags: 64,
      },
    });
  });

  it('does not approve or log activity when no pending claim exists', async () => {
    const characterClaimStore = makeCharacterClaimStore({
      approveCharacterClaim: vi.fn().mockResolvedValue(null),
    });
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };
    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'officer-1' }, permissions: '32' },
        data: {
          name: 'approve_character',
          options: [
            { name: 'user', value: 'user-1' },
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore,
        botActivityStore,
      },
    );

    expect(characterClaimStore.approveCharacterClaim).toHaveBeenCalledOnce();
    expect(botActivityStore.recordActivity).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      data: {
        content: 'No pending character claim was found for that exact character identity.',
        flags: 64,
      },
    });
  });

  it('authorizes claim approvals by explicit officer user IDs instead of broad roles', async () => {
    const broadRoleStore = makeCharacterClaimStore();
    const broadRole = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-2' }, roles: ['role-1'], permissions: '0' },
        data: {
          name: 'approve_character',
          options: [
            { name: 'user', value: 'user-1' },
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore({
          compareOfficerUserIds: [],
        }),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore: broadRoleStore,
      },
    );

    expect(broadRoleStore.approveCharacterClaim).not.toHaveBeenCalled();
    expect(broadRole).toMatchObject({
      data: {
        content: 'This action is limited to authorized officers.',
        flags: 64,
      },
    });

    const explicitOfficerStore = makeCharacterClaimStore({
      approveCharacterClaim: vi.fn().mockResolvedValue(makeApprovedClaim()),
    });
    const explicitOfficer = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'officer-1' }, permissions: '0' },
        data: {
          name: 'approve_character',
          options: [
            { name: 'user', value: 'user-1' },
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore({
          compareOfficerUserIds: ['officer-1'],
        }),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore: explicitOfficerStore,
      },
    );

    expect(explicitOfficerStore.approveCharacterClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        discordUserId: 'user-1',
        participantKey: 'character:us:stormrage:alyra',
        reviewedByDiscordUserId: 'officer-1',
      }),
    );
    expect(explicitOfficer).toMatchObject({
      data: {
        content: 'Character claim approved for the exact character identity.',
        flags: 64,
      },
    });
  });

  it('authorizes claim rejection by explicit officer user IDs', async () => {
    const characterClaimStore = makeCharacterClaimStore({
      rejectCharacterClaim: vi.fn().mockResolvedValue(
        makeApprovedClaim({
          status: 'rejected',
        }),
      ),
    });
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'officer-1' }, permissions: '0' },
        data: {
          name: 'reject_character',
          options: [
            { name: 'user', value: 'user-1' },
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore({
          compareOfficerUserIds: ['officer-1'],
        }),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore,
        botActivityStore,
      },
    );

    expect(characterClaimStore.rejectCharacterClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        discordUserId: 'user-1',
        participantKey: 'character:us:stormrage:alyra',
        reviewedByDiscordUserId: 'officer-1',
      }),
    );
    expect(botActivityStore.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        actor: { kind: 'discord', discordUserId: 'officer-1' },
        kind: 'claim_rejected',
        characterLabel: 'Alyra - Stormrage-US',
        targetDiscordUserId: 'user-1',
      }),
    );
    expect(response).toMatchObject({
      data: { content: 'Character claim rejected.', flags: 64 },
    });
  });

  it('lists requester claims without exposing participantKey', async () => {
    const characterClaimStore = makeCharacterClaimStore({
      listClaimsForUser: vi.fn().mockResolvedValue([
        makeApprovedClaim({
          peerCompareOptIn: true,
          publicPostOptIn: false,
        }),
      ]),
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' } },
        data: { name: 'my_characters' },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore,
      },
    );

    expect((response as { data?: { content?: string } }).data?.content).toContain(
      'Alyra - Stormrage-US: approved',
    );
    expect((response as { data?: { content?: string } }).data?.content).not.toMatch(
      /participantKey|character:us/i,
    );
  });

  it('lets approved owners update compare privacy', async () => {
    const characterClaimStore = makeCharacterClaimStore({
      updateClaimPrivacy: vi.fn().mockResolvedValue(
        makeApprovedClaim({
          peerCompareOptIn: true,
          publicPostOptIn: true,
        }),
      ),
    });

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        guild_id: 'guild-1',
        member: { user: { id: 'user-1' } },
        data: {
          name: 'compare_privacy',
          options: [
            { name: 'character', value: 'Alyra' },
            { name: 'realm', value: 'Stormrage' },
            { name: 'region', value: 'US' },
            { name: 'peer_compare', value: 'allow_guild' },
            { name: 'public_post', value: 'allow' },
          ],
        },
      },
      {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        characterClaimStore,
      },
    );

    expect(characterClaimStore.updateClaimPrivacy).toHaveBeenCalledWith({
      guildId: 'guild-1',
      discordUserId: 'user-1',
      participantKey: 'character:us:stormrage:alyra',
      peerCompareOptIn: true,
      publicPostOptIn: true,
    });
    expect(response).toMatchObject({
      data: {
        content: 'Peer comparison access updated. Public posting preference updated.',
        flags: 64,
      },
    });
  });

  it('runs character compare with sufficient stored history', async () => {
    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [
        makeHistorySnapshot({
          reportCode: 'OLD1',
          rankPercent: 60,
          damageTotal: 1000,
          healingTotal: 100,
          dispels: 7,
        }),
        makeHistorySnapshot({
          reportCode: 'OLD2',
          reportStartedAt: new Date(Date.UTC(2026, 2, 2)),
          rankPercent: 70,
          damageTotal: 1000,
          healingTotal: 100,
          dispels: 8,
        }),
        makeHistorySnapshot({
          reportCode: 'OLD3',
          reportStartedAt: new Date(Date.UTC(2026, 2, 3)),
          rankPercent: 69.5,
          damageTotal: 1000,
          healingTotal: 100,
          dispels: 8,
        }),
      ],
    });

    expect(comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledWith({
      guildId: 'guild-1',
      participantKey: 'character:us:stormrage:alyra',
      before: new Date(Date.UTC(2026, 3, 9)),
      limit: 5,
    });
    expect(body.flags).toBe(64);
    expect(body.content).toContain('Comparison: Alyra');
    expect(body.content).toContain('Report: ABC123');
    expect(body.content).toContain('Raid: Vault');
    expect(body.content).toContain('Date: Apr 9, 2026');
    expect(body.content).toContain('Mode: character');
    expect(body.content).toContain('History: 3 prior reports');
    expect(body.content).toContain('Summary:');
    expect(body.content).toContain(
      'Alyra is above recent parse and damage baselines, while dispels are below recent baseline.',
    );
    expect(body.content).not.toContain('Alyra parse is above recent baseline.');
    expect(body.content).toContain('Performance:');
    expect(body.content).toContain('Execution:');
    expect(body.content).toContain('Context:');
    expect(body.content).toContain('Parse: 82, above baseline of 66.5 (samples: 3)');
    expect(body.content).toContain('Damage total: 1,234, above baseline of 1,000 (samples: 3)');
    expect(body.content).toContain('Healing total: 567, above baseline of 100 (samples: 3)');
    expect(body.content).toContain('Dispels: 1, below baseline of 7.7 (samples: 3)');
    expect(body.content).toContain('Metric sample size: 3');
    expect(body.content).not.toMatch(/participantKey|playerProfileId/i);
    expect(body.content).not.toMatch(/\bDPS\b|\bHPS\b/);
  });

  it('renders no-history compare responses without baseline claims', async () => {
    const { body, comparisonHistoryStore } = await runDeferredCompare({ history: [] });

    expect(comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledOnce();
    expect(body.flags).toBe(64);
    expect(body.content).toContain('History: 0 prior reports');
    expect(body.content).toContain('No prior character history was found for Alyra.');
    expect(body.content).toContain('No trusted performance baseline is available.');
    expect(body.content).toContain('No trusted execution baseline is available.');
    expect(body.content).toContain('Metric sample size: 0 reports (trusted threshold: 3)');
    expect(body.content).not.toMatch(/participantKey|playerProfileId/i);
  });

  it('renders insufficient-history compare responses without baseline claims', async () => {
    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [
        makeHistorySnapshot({ reportCode: 'OLD1' }),
        makeHistorySnapshot({
          reportCode: 'OLD2',
          reportStartedAt: new Date(Date.UTC(2026, 2, 2)),
        }),
      ],
    });

    expect(comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledOnce();
    expect(body.flags).toBe(64);
    expect(body.content).toContain('History: 2 prior reports');
    expect(body.content).toContain(
      'Insufficient history for a trusted baseline: 2 prior reports found; 3 required.',
    );
    expect(body.content).toContain('No trusted performance baseline is available.');
    expect(body.content).toContain('No trusted execution baseline is available.');
    expect(body.content).toContain('Metric sample size: 2 reports (trusted threshold: 3)');
    expect(body.content).not.toMatch(/participantKey|playerProfileId/i);
  });

  it('blocks officers without any approved claims before history lookup', async () => {
    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'officer-1' }, permissions: '32' },
      }),
      characterClaimStore: makeCharacterClaimStore(),
    });

    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      content: 'You need an approved character claim before using /compare.',
      flags: 64,
    });
  });

  it('allows configured officer users with an approved claim to compare in officer-only mode', async () => {
    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [
        makeHistorySnapshot({ reportCode: 'OLD1' }),
        makeHistorySnapshot({ reportCode: 'OLD2' }),
        makeHistorySnapshot({ reportCode: 'OLD3' }),
      ],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'officer-1' }, permissions: '0' },
      }),
      guildConfigStore: makeGuildConfigStore({
        compareAccessMode: 'officer_only',
        compareOfficerUserIds: ['officer-1'],
      }),
      characterClaimStore: makeClaimedCompareStore({
        listClaimsForUser: vi
          .fn()
          .mockResolvedValue([makeUnrelatedApprovedClaim({ discordUserId: 'officer-1' })]),
        findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
      }),
    });

    expect(comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledOnce();
    expect(body.content).toContain('Comparison: Alyra');
  });

  it('denies unauthorized claimed peers before history lookup with privacy-safe wording', async () => {
    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'peer-1' } },
      }),
      characterClaimStore: makeClaimedCompareStore({
        listClaimsForUser: vi
          .fn()
          .mockResolvedValue([makeUnrelatedApprovedClaim({ discordUserId: 'peer-1' })]),
      }),
    });

    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      content: 'This comparison is limited to the character owner or authorized officers.',
      flags: 64,
    });
    expect(body.content).not.toMatch(/opted out|privacy setting|target denied/i);
  });

  it('allows approved owners to privately compare when guild mode permits owners', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_or_officer',
        comparePublicPostingEnabled: false,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const characterClaimStore = makeCharacterClaimStore({
      findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(makeApprovedClaim()),
      findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
    });

    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [
        makeHistorySnapshot({ reportCode: 'OLD1' }),
        makeHistorySnapshot({ reportCode: 'OLD2' }),
        makeHistorySnapshot({ reportCode: 'OLD3' }),
      ],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'user-1' } },
      }),
      guildConfigStore,
      characterClaimStore,
    });

    expect(comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledOnce();
    expect(body.content).toContain('Comparison: Alyra');
    expect(body.content).toContain('Metric sample size:');
  });

  it('allows only the approved target owner in owner-only compare mode', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_only',
        comparePublicPostingEnabled: false,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };

    const owner = await runDeferredCompare({
      history: [
        makeHistorySnapshot({ reportCode: 'OLD1' }),
        makeHistorySnapshot({ reportCode: 'OLD2' }),
        makeHistorySnapshot({ reportCode: 'OLD3' }),
      ],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'user-1' } },
      }),
      guildConfigStore,
      characterClaimStore: makeCharacterClaimStore({
        findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(makeApprovedClaim()),
        findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
      }),
    });

    const officer = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'officer-1' }, permissions: '32' },
      }),
      guildConfigStore,
      characterClaimStore: makeClaimedCompareStore({
        listClaimsForUser: vi
          .fn()
          .mockResolvedValue([makeUnrelatedApprovedClaim({ discordUserId: 'officer-1' })]),
        findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
      }),
    });

    expect(owner.comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledOnce();
    expect(owner.body.content).toContain('Comparison: Alyra');
    expect(officer.comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
    expect(officer.body).toMatchObject({
      content: 'This comparison is limited to the approved character owner.',
      flags: 64,
    });
  });

  it('allows peer private compare only when guild mode and target opt-in permit it', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_opt_in_or_officer',
        comparePublicPostingEnabled: false,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const characterClaimStore = makeCharacterClaimStore({
      listClaimsForUser: vi
        .fn()
        .mockResolvedValue([makeUnrelatedApprovedClaim({ discordUserId: 'peer-1' })]),
      findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([
        makeApprovedClaim({
          discordUserId: 'owner-1',
          peerCompareOptIn: true,
        }),
      ]),
    });

    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [
        makeHistorySnapshot({ reportCode: 'OLD1' }),
        makeHistorySnapshot({ reportCode: 'OLD2' }),
        makeHistorySnapshot({ reportCode: 'OLD3' }),
      ],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'peer-1' } },
      }),
      guildConfigStore,
      characterClaimStore,
    });

    expect(comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledOnce();
    expect(body.content).toContain('Comparison: Alyra');
  });

  it('denies public compare posting when guild public posting is disabled', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_or_officer',
        comparePublicPostingEnabled: false,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const characterClaimStore = makeCharacterClaimStore({
      findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(makeApprovedClaim()),
      findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
    });

    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        visibility: 'public',
        member: { user: { id: 'user-1' } },
      }),
      guildConfigStore,
      characterClaimStore,
    });

    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      content: 'Public compare posting is not enabled for this server.',
      flags: 64,
    });
  });

  it('publicly posts for an approved owner only when public posting is enabled', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_only',
        comparePublicPostingEnabled: true,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const characterClaimStore = makeCharacterClaimStore({
      findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(makeApprovedClaim()),
      findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
    });
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };

    const { body, editFetch } = await runDeferredCompare({
      history: [
        makeHistorySnapshot({ reportCode: 'OLD1' }),
        makeHistorySnapshot({ reportCode: 'OLD2' }),
        makeHistorySnapshot({ reportCode: 'OLD3' }),
      ],
      interaction: makeCompareInteraction('character', 'Alyra', {
        visibility: 'public',
        member: { user: { id: 'user-1' } },
      }),
      guildConfigStore,
      characterClaimStore,
      botActivityStore,
    });

    const postCall = editFetch.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.endsWith('/webhooks/app-1/token-1') &&
        typeof init === 'object' &&
        init !== null &&
        (init as { method?: string }).method === 'POST',
    );
    expect(postCall).toBeDefined();
    if (!postCall) throw new Error('Expected public compare follow-up call');
    const publicBody = JSON.parse((postCall?.[1] as { body: string }).body) as {
      content?: string;
      flags?: number;
    };
    const editedBodies = parseEditedOriginalResponseBodies(editFetch);

    expect(publicBody.content).toContain('Comparison: Alyra');
    expect(publicBody.content).toContain('Report: ABC123');
    expect(publicBody.content).toContain('Raid: Vault');
    expect(publicBody.content).toContain('Date: Apr 9, 2026');
    expect(publicBody.content).toContain('Metric sample size:');
    expect(publicBody).not.toHaveProperty('flags');
    expect(publicBody.content).not.toMatch(/participantKey|playerProfileId/i);
    expect(editedBodies.map((editedBody) => editedBody.content)).toEqual([
      'Posting comparison...',
      'Comparison posted to this channel.',
    ]);
    expect(botActivityStore.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        actor: { kind: 'discord', discordUserId: 'user-1' },
        kind: 'public_comparison_posted',
        reportCode: 'ABC123',
      }),
    );
    expect(body).toMatchObject({
      content: 'Comparison posted to this channel.',
      flags: 64,
    });
  });

  it('keeps public compare success when activity recording fails', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_only',
        comparePublicPostingEnabled: true,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const characterClaimStore = makeCharacterClaimStore({
      findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(makeApprovedClaim()),
      findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
    });
    const botActivityStore = { recordActivity: vi.fn().mockRejectedValue(new Error('activity down')) };

    const { body } = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        visibility: 'public',
        member: { user: { id: 'user-1' } },
      }),
      guildConfigStore,
      characterClaimStore,
      botActivityStore,
    });

    expect(botActivityStore.recordActivity).toHaveBeenCalledOnce();
    expect(body).toMatchObject({
      content: 'Comparison posted to this channel.',
      flags: 64,
    });
  });

  it.each([
    {
      label: 'fails',
      makeResponse: () =>
        makeDiscordFetchResponse({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          body: '{"message":"upstream failed"}',
        }),
    },
    {
      label: 'returns no created message',
      makeResponse: () =>
        makeDiscordFetchResponse({
          body: '{"flags":0}',
        }),
    },
    {
      label: 'returns an ephemeral message',
      makeResponse: () =>
        makeDiscordFetchResponse({
          body: JSON.stringify({ id: 'original-message-1', flags: 64 }),
        }),
    },
  ])('shows a private failure when public follow-up $label', async ({ makeResponse }) => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_or_officer',
        comparePublicPostingEnabled: true,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const characterClaimStore = makeCharacterClaimStore({
      findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(makeApprovedClaim()),
      findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
    });
    const editFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeDiscordFetchResponse({
          body: JSON.stringify({ id: 'original-message-1', flags: 64 }),
        }),
      )
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(
        makeDiscordFetchResponse({
          body: JSON.stringify({ id: 'original-message-1', flags: 64 }),
        }),
      );

    const { body } = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        visibility: 'public',
        member: { user: { id: 'user-1' } },
      }),
      guildConfigStore,
      characterClaimStore,
      editFetch,
    });

    expect(body).toMatchObject({
      content: 'Comparison was authorized, but public posting failed. Please try again.',
      flags: 64,
    });
  });

  it('does not record private compare activity when the Discord edit fails', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'owner_or_officer',
        comparePublicPostingEnabled: false,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };
    const characterClaimStore = makeCharacterClaimStore({
      findApprovedClaimForUserCharacter: vi.fn().mockResolvedValue(makeApprovedClaim()),
      findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([makeApprovedClaim()]),
    });
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };
    const editFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeDiscordFetchResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          body: 'unknown interaction',
        }),
      )
      .mockResolvedValueOnce(makeDiscordFetchResponse());

    const { body } = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        member: { user: { id: 'user-1' } },
      }),
      guildConfigStore,
      characterClaimStore,
      editFetch,
      botActivityStore,
    });

    expect(botActivityStore.recordActivity).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      content: 'Could not build comparison for that report. Please verify the URL and try again.',
      flags: 64,
    });
  });

  it('requires target public-post opt-in before officers can publicly post someone else', async () => {
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
        compareAccessMode: 'officer_only',
        comparePublicPostingEnabled: true,
        recapPostModeDefault: 'preview-and-post',
      }),
      saveGuildConfig: vi.fn(),
    };

    const denied = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        visibility: 'public',
        member: { user: { id: 'officer-1' }, permissions: '32' },
      }),
      guildConfigStore,
      characterClaimStore: makeCharacterClaimStore({
        listClaimsForUser: vi
          .fn()
          .mockResolvedValue([makeUnrelatedApprovedClaim({ discordUserId: 'officer-1' })]),
        findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([
          makeApprovedClaim({
            discordUserId: 'owner-1',
            publicPostOptIn: false,
          }),
        ]),
      }),
    });

    expect(denied.comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
    expect(denied.initialResponse).toMatchObject({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });
    expect(denied.body).toMatchObject({
      content: 'This comparison can be viewed privately, but it cannot be posted publicly.',
      flags: 64,
    });
    expect(denied.body.content).not.toMatch(
      /Unsupported interaction|opted out|target-public-post-not-enabled|participantKey|character:us|privacy setting|target denied/i,
    );

    const editFailureFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('unknown interaction'),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: vi.fn().mockResolvedValue('ok'),
      });

    const followup = await runDeferredCompare({
      history: [makeHistorySnapshot()],
      interaction: makeCompareInteraction('character', 'Alyra', {
        visibility: 'public',
        member: { user: { id: 'officer-1' }, permissions: '32' },
      }),
      guildConfigStore,
      editFetch: editFailureFetch,
      characterClaimStore: makeCharacterClaimStore({
        listClaimsForUser: vi
          .fn()
          .mockResolvedValue([makeUnrelatedApprovedClaim({ discordUserId: 'officer-1' })]),
        findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([
          makeApprovedClaim({
            discordUserId: 'owner-1',
            publicPostOptIn: false,
          }),
        ]),
      }),
    });

    const followupCall = followup.editFetch.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.endsWith('/webhooks/app-1/token-1') &&
        typeof init === 'object' &&
        init !== null &&
        (init as { method?: string }).method === 'POST',
    );
    const followupBody = JSON.parse((followupCall?.[1] as { body: string }).body) as {
      content?: string;
      flags?: number;
    };

    expect(followupBody).toMatchObject({
      content: 'This comparison can be viewed privately, but it cannot be posted publicly.',
      flags: 64,
    });
    expect(followupBody.content).not.toMatch(
      /Unsupported interaction|opted out|target-public-post-not-enabled|participantKey|character:us|privacy setting|target denied/i,
    );

    const allowed = await runDeferredCompare({
      history: [
        makeHistorySnapshot({ reportCode: 'OLD1' }),
        makeHistorySnapshot({ reportCode: 'OLD2' }),
        makeHistorySnapshot({ reportCode: 'OLD3' }),
      ],
      interaction: makeCompareInteraction('character', 'Alyra', {
        visibility: 'public',
        member: { user: { id: 'officer-1' }, permissions: '32' },
      }),
      guildConfigStore,
      characterClaimStore: makeCharacterClaimStore({
        listClaimsForUser: vi
          .fn()
          .mockResolvedValue([makeUnrelatedApprovedClaim({ discordUserId: 'officer-1' })]),
        findApprovedClaimsForParticipant: vi.fn().mockResolvedValue([
          makeApprovedClaim({
            discordUserId: 'owner-1',
            publicPostOptIn: true,
          }),
        ]),
      }),
    });

    expect(allowed.comparisonHistoryStore.findCharacterHistory).toHaveBeenCalledOnce();
    expect(allowed.body.content).toBe('Comparison posted to this channel.');
  });

  it('returns a private missing character response for /compare', async () => {
    const { body, comparisonHistoryStore } = await runDeferredCompare({
      history: [],
      character: 'Missingtoon',
    });

    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      content: 'Character not found in the current report: Missingtoon.',
      flags: 64,
    });
  });

  it('rejects invalid compare modes without fetching a report', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;
    const comparisonHistoryStore = {
      saveComparisonSnapshot: vi.fn(),
      findCharacterHistory: vi.fn(),
    };

    const response = await handleInteraction(makeCompareInteraction('alts'), {
      wclClient,
      guildConfigStore: makeGuildConfigStore(),
      recapPreviewStateService: makeRecapPreviewStateService(),
      comparisonHistoryStore,
    });

    expect(response).toMatchObject({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Invalid compare mode. Choose character or mixed.',
        flags: 64,
      },
    });
    expect(
      (wclClient as { fetchAndNormalizeReport: ReturnType<typeof vi.fn> }).fetchAndNormalizeReport,
    ).not.toHaveBeenCalled();
    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
  });

  it('rejects invalid compare visibility without fetching a report', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;
    const comparisonHistoryStore = {
      saveComparisonSnapshot: vi.fn(),
      findCharacterHistory: vi.fn(),
    };

    const response = await handleInteraction(
      makeCompareInteraction('character', 'Alyra', { visibility: 'guild' }),
      {
        wclClient,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        comparisonHistoryStore,
        characterClaimStore: makeCharacterClaimStore(),
      },
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'Invalid visibility. Choose private or public.',
        flags: 64,
      },
    });
    expect(
      (wclClient as { fetchAndNormalizeReport: ReturnType<typeof vi.fn> }).fetchAndNormalizeReport,
    ).not.toHaveBeenCalled();
    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
  });

  it('returns mixed-mode missing mapping without character fallback', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn(),
      findPreviousRaidSummaries: vi.fn(),
    } as never;
    const comparisonHistoryStore = {
      saveComparisonSnapshot: vi.fn(),
      findCharacterHistory: vi.fn(),
    };

    const response = await handleInteraction(makeCompareInteraction('mixed'), {
      wclClient,
      guildConfigStore: makeGuildConfigStore(),
      recapPreviewStateService: makeRecapPreviewStateService(),
      comparisonHistoryStore,
    });

    expect(response).toMatchObject({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content:
          'Mixed comparisons require explicit player-character mapping and are not available yet. Alts are not guessed automatically.',
        flags: 64,
      },
    });
    expect(
      (wclClient as { fetchAndNormalizeReport: ReturnType<typeof vi.fn> }).fetchAndNormalizeReport,
    ).not.toHaveBeenCalled();
    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
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
        data: { custom_id: 'recap:v2:post:ABC123:guild-1:channel-1' },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
      },
    );
    expect(postButton?.label).toBe('Post to Current Channel');
    expect(postButton?.custom_id).toBe('recap:v2:post:ABC123:guild-1:channel-1');
    expect(cancelButton?.label).toBe('Cancel');
    expect(cancelButton?.custom_id).toBe('recap:v2:cancel:ABC123:guild-1:channel-1');

    expect((posted as { data?: { embeds?: unknown[] } }).data?.embeds?.length).toBe(1);
    expect(recapPreviewStateService.consumeValidPreviewState).toHaveBeenCalledWith({
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
    });
  });

  it('persists extracted character comparison snapshots after a successful recap fetch', async () => {
    const report = makeReportWithComparisonIdentity();
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(report),
      findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
    } as never;
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'mixed',
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
    const comparisonHistoryStore = {
      saveComparisonSnapshot: vi.fn().mockResolvedValue(undefined),
      findCharacterHistory: vi.fn(),
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
          options: [{ name: 'url', value: 'https://www.warcraftlogs.com/reports/ABC123' }],
        },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
        comparisonHistoryStore,
      },
    );

    await vi.waitFor(() => {
      expect(comparisonHistoryStore.saveComparisonSnapshot).toHaveBeenCalledOnce();
      expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledOnce();
      expect(editFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    expect(comparisonHistoryStore.saveComparisonSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        reportCode: 'ABC123',
        participantKey: 'character:us:stormrage:alyra',
        warcraftLogsActorId: 7,
        warcraftLogsGuid: 99060818,
        characterName: 'Alyra',
        server: 'Stormrage',
        region: 'US',
        realm: 'Stormrage',
        rankPercent: 82,
        damageTotal: 1234,
        healingTotal: 567,
        interrupts: 5,
        dispels: 1,
      }),
    );
    const savedSnapshot = comparisonHistoryStore.saveComparisonSnapshot.mock.calls[0]?.[0];
    expect(savedSnapshot).not.toHaveProperty('playerProfileId');
    expect(savedSnapshot).not.toHaveProperty('rawPayload');
    expect(savedSnapshot).not.toHaveProperty('normalizedPayload');
    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();

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
    expect(body).not.toMatch(/participantKey|baseline|history|playerProfileId|snapshot/i);
  });

  it('keeps recap preview successful when comparison extraction returns no snapshots', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(makeReport()),
      findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
    } as never;
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
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
    const comparisonHistoryStore = {
      saveComparisonSnapshot: vi.fn(),
      findCharacterHistory: vi.fn(),
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
          options: [{ name: 'url', value: 'https://www.warcraftlogs.com/reports/ABC123' }],
        },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
        comparisonHistoryStore,
      },
    );

    await vi.waitFor(() => {
      expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledOnce();
      expect(editFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(comparisonHistoryStore.saveComparisonSnapshot).not.toHaveBeenCalled();
    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
  });

  it('keeps recap preview successful when comparison snapshot persistence fails', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(makeReportWithComparisonIdentity()),
      findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
    } as never;
    const guildConfigStore: GuildConfigStore = {
      getGuildConfig: vi.fn().mockResolvedValue({
        guildId: 'guild-1',
        defaultGameFamily: 'retail',
        compareModeDefault: 'character',
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
    const comparisonHistoryStore = {
      saveComparisonSnapshot: vi.fn().mockRejectedValue(new Error('snapshot write failed')),
      findCharacterHistory: vi.fn(),
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
          options: [{ name: 'url', value: 'https://www.warcraftlogs.com/reports/ABC123' }],
        },
      },
      {
        wclClient,
        guildConfigStore,
        recapPreviewStateService,
        comparisonHistoryStore,
      },
    );

    await vi.waitFor(() => {
      expect(comparisonHistoryStore.saveComparisonSnapshot).toHaveBeenCalledOnce();
      expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledOnce();
      expect(editFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(comparisonHistoryStore.findCharacterHistory).not.toHaveBeenCalled();
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

  it('handles expired auto recap prompt buttons without falling through as unsupported', async () => {
    const autoRecapPromptStateService = {
      savePromptState: vi.fn(),
      getValidPromptState: vi.fn().mockResolvedValue(null),
      consumeValidPromptState: vi.fn(),
    };

    const response = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: makeAutoRecapPromptPreviewCustomId('source-message-1') },
      },
      {
        wclClient: {
          fetchAndNormalizeReport: vi.fn(),
          findPreviousRaidSummaries: vi.fn(),
        } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapPromptStateService,
      },
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: expect.stringContaining('auto recap prompt has expired'),
        flags: 64,
      },
    });
    expect((response as { data?: { content?: string } }).data?.content).not.toContain(
      'temporarily unavailable',
    );
  });

  it('reports missing auto recap prompt store as temporarily unavailable, not expired', async () => {
    const response = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        id: 'interaction-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        data: { custom_id: makeAutoRecapPromptPreviewCustomId('source-message-1') },
      },
      {
        wclClient: {
          fetchAndNormalizeReport: vi.fn(),
          findPreviousRaidSummaries: vi.fn(),
        } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
      },
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: expect.stringContaining('Auto recap is temporarily unavailable'),
        flags: 64,
      },
    });
    expect((response as { data?: { content?: string } }).data?.content).not.toContain('expired');
  });

  it('reports missing duplicate tracking store as temporarily unavailable, not expired', async () => {
    const response = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        id: 'interaction-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        data: { custom_id: makeAutoRecapDuplicateCustomId('p', 'nonce-1') },
      },
      {
        wclClient: {
          fetchAndNormalizeReport: vi.fn(),
          findPreviousRaidSummaries: vi.fn(),
        } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
      },
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: expect.stringContaining('Auto recap is temporarily unavailable'),
        flags: 64,
      },
    });
    expect((response as { data?: { content?: string } }).data?.content).not.toContain('expired');
  });

  it('uses duplicate tracking state from HandleOptions for ar:d confirmation actions', async () => {
    const getByConfirmationNonce = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      gameFamily: 'retail',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      sourceMessageId: 'source-message-1',
      sourceAuthorId: 'user-1',
      mode: 'prompt',
      status: 'prompted',
      confirmationNonce: 'nonce-1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const updateTracking = vi.fn().mockResolvedValue(null);

    const response = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        id: 'interaction-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        data: { custom_id: makeAutoRecapDuplicateCustomId('i', 'nonce-1') },
      },
      {
        wclClient: {
          fetchAndNormalizeReport: vi.fn(),
          findPreviousRaidSummaries: vi.fn(),
        } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapDuplicateTrackingService: {
          claimPassiveDetection: vi.fn(),
          getByConfirmationNonce,
          updateTracking,
        },
      },
    );

    expect(getByConfirmationNonce).toHaveBeenCalledWith('nonce-1');
    expect(updateTracking).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      status: 'ignored',
    });
    expect(response).toMatchObject({
      data: { content: 'Duplicate recap action ignored.', flags: 64 },
    });
  });

  it('does not record duplicate auto recap preview activity when the Discord edit fails', async () => {
    const getByConfirmationNonce = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      gameFamily: 'retail',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      sourceMessageId: 'source-message-1',
      sourceAuthorId: 'user-1',
      mode: 'prompt',
      status: 'prompted',
      confirmationNonce: 'nonce-1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const editFetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeDiscordFetchResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          body: 'unknown interaction',
        }),
      )
      .mockResolvedValueOnce(makeDiscordFetchResponse());
    vi.stubGlobal('fetch', editFetch);
    const scheduleBackgroundTask = vi.fn((task: () => void) => task());
    const recapPreviewStateService = makeRecapPreviewStateService();
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };

    const response = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        member: { user: { id: 'clicker-1' } },
        data: { custom_id: makeAutoRecapDuplicateCustomId('p', 'nonce-1') },
      },
      {
        wclClient: {
          fetchAndNormalizeReport: vi.fn().mockResolvedValue(makeReport()),
          findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
        } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService,
        autoRecapDuplicateTrackingService: {
          claimPassiveDetection: vi.fn(),
          getByConfirmationNonce,
          updateTracking: vi.fn().mockResolvedValue(null),
        },
        scheduleBackgroundTask,
        botActivityStore,
      },
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });
    await vi.waitFor(() => {
      expect(editFetch).toHaveBeenCalledTimes(2);
    });
    expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledOnce();
    expect(botActivityStore.recordActivity).not.toHaveBeenCalled();
  });

  it('defers auto recap prompt preview ephemerally and edits with the preview', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(makeReport()),
      findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
    } as never;
    const recapPreviewStateService = makeRecapPreviewStateService();
    const promptState = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      gameFamily: 'retail' as const,
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      sourceMessageId: 'source-message-1',
      sourceAuthorId: 'source-user-1',
      promptMessageId: 'prompt-message-1',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const autoRecapPromptStateService = {
      savePromptState: vi.fn(),
      getValidPromptState: vi.fn().mockResolvedValue(promptState),
      consumeValidPromptState: vi.fn(),
    };
    const editFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', editFetch);
    const scheduleBackgroundTask = vi.fn((task: () => void) => task());
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };

    const response = await handleInteraction(
      {
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        member: { user: { id: 'clicker-1' } },
        data: { custom_id: makeAutoRecapPromptPreviewCustomId('source-message-1') },
      },
      {
        wclClient,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService,
        autoRecapPromptStateService,
        scheduleBackgroundTask,
        botActivityStore,
      },
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });
    expect(scheduleBackgroundTask).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: 'guild-1',
          channelId: 'channel-1',
          reportCode: 'ABC123',
          createdByUserId: 'clicker-1',
        }),
      );
      expect(editFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/app-1/token-1/messages/@original'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(parseEditedOriginalResponseBody(editFetch).flags).toBe(64);
    expect(botActivityStore.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        actor: { kind: 'discord', discordUserId: 'clicker-1' },
        kind: 'recap_preview_created',
        reportCode: 'ABC123',
        sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      }),
    );
  });

  it('records ignored auto recap prompts', async () => {
    const promptState = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      gameFamily: 'retail' as const,
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      sourceMessageId: 'source-message-1',
      sourceAuthorId: 'source-user-1',
      promptMessageId: 'prompt-message-1',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const autoRecapPromptStateService = {
      savePromptState: vi.fn(),
      getValidPromptState: vi.fn(),
      consumeValidPromptState: vi.fn().mockResolvedValue(promptState),
    };
    const autoRecapDuplicateTrackingService = {
      claimPassiveDetection: vi.fn(),
      updateTracking: vi.fn().mockResolvedValue(null),
    };

    const response = await handleInteraction(
      {
        type: InteractionType.MESSAGE_COMPONENT,
        guild_id: 'guild-1',
        data: { custom_id: makeAutoRecapPromptIgnoreCustomId('source-message-1') },
      },
      {
        wclClient: {
          fetchAndNormalizeReport: vi.fn(),
          findPreviousRaidSummaries: vi.fn(),
        } as never,
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapPromptStateService,
        autoRecapDuplicateTrackingService,
      },
    );

    expect(response).toMatchObject({
      data: { content: 'Auto recap prompt ignored.', flags: 64 },
    });
    expect(autoRecapDuplicateTrackingService.updateTracking).toHaveBeenCalledWith({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      status: 'ignored',
    });
  });

  it('passively prompts for the first valid Warcraft Logs URL in an allowlisted channel', async () => {
    const channel = {
      send: vi.fn().mockResolvedValue({ id: 'prompt-message-1' }),
    };
    const autoRecapPromptStateService = {
      savePromptState: vi.fn().mockResolvedValue(undefined),
      getValidPromptState: vi.fn(),
      consumeValidPromptState: vi.fn(),
    };
    const autoRecapDuplicateTrackingService = {
      claimPassiveDetection: vi.fn().mockResolvedValue({
        claimed: true,
        record: {
          guildId: 'guild-1',
          channelId: 'channel-1',
          reportCode: 'ABC123',
          gameFamily: 'retail',
          sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
          sourceMessageId: 'source-message-1',
          sourceAuthorId: 'user-1',
          mode: 'prompt',
          status: 'processing',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      updateTracking: vi.fn().mockResolvedValue(null),
    };

    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-1',
        authorId: 'user-1',
        content:
          'ignore this https://example.com/reports/NOPE and use <https://www.warcraftlogs.com/reports/ABC123).>',
      },
      channel,
      handleOptions: {
        wclClient: {
          fetchAndNormalizeReport: vi.fn(),
          findPreviousRaidSummaries: vi.fn(),
        } as never,
        guildConfigStore: {
          getGuildConfig: vi.fn().mockResolvedValue({
            guildId: 'guild-1',
            defaultGameFamily: 'retail',
            compareModeDefault: 'character',
            compareAccessMode: 'officer_only',
            comparePublicPostingEnabled: false,
            recapPostModeDefault: 'preview-and-post',
            autoRecapMode: 'prompt',
            autoRecapChannelIds: ['channel-1'],
          }),
          saveGuildConfig: vi.fn(),
        },
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapPromptStateService,
        autoRecapDuplicateTrackingService,
      },
    });

    expect(autoRecapDuplicateTrackingService.claimPassiveDetection).toHaveBeenCalledWith(
      expect.objectContaining({
        reportCode: 'ABC123',
        sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      }),
    );
    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Detected a Warcraft Logs report.\nGenerate a recap?',
        allowed_mentions: { parse: [] },
      }),
    );
    expect(autoRecapPromptStateService.savePromptState).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMessageId: 'source-message-1',
        promptMessageId: 'prompt-message-1',
      }),
    );
  });

  it('ignores passive messages when content is empty or the channel is not allowlisted', async () => {
    const getGuildConfig = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'retail',
      compareModeDefault: 'character',
      compareAccessMode: 'officer_only',
      comparePublicPostingEnabled: false,
      recapPostModeDefault: 'preview-and-post',
      autoRecapMode: 'prompt',
      autoRecapChannelIds: ['channel-2'],
    });
    const claimPassiveDetection = vi.fn();

    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-1',
        authorId: 'user-1',
        content: '',
      },
      channel: { send: vi.fn() },
      handleOptions: {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: { getGuildConfig, saveGuildConfig: vi.fn() },
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapDuplicateTrackingService: {
          claimPassiveDetection,
          updateTracking: vi.fn(),
        },
      },
    });
    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-2',
        authorId: 'user-1',
        content: 'https://www.warcraftlogs.com/reports/ABC123',
      },
      channel: { send: vi.fn() },
      handleOptions: {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: { getGuildConfig, saveGuildConfig: vi.fn() },
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapDuplicateTrackingService: {
          claimPassiveDetection,
          updateTracking: vi.fn(),
        },
      },
    });

    expect(claimPassiveDetection).not.toHaveBeenCalled();
  });

  it('auto_preview posts a public preview with no flags and safe mentions', async () => {
    const channel = { send: vi.fn().mockResolvedValue({ id: 'preview-message-1' }) };
    const recapPreviewStateService = makeRecapPreviewStateService();
    const autoRecapDuplicateTrackingService = {
      claimPassiveDetection: vi.fn().mockResolvedValue({
        claimed: true,
        record: null,
      }),
      updateTracking: vi.fn().mockResolvedValue(null),
    };

    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-1',
        authorId: 'user-1',
        content: 'https://www.warcraftlogs.com/reports/ABC123',
      },
      channel,
      handleOptions: {
        wclClient: {
          fetchAndNormalizeReport: vi.fn().mockResolvedValue(makeReport()),
          findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
        } as never,
        guildConfigStore: {
          getGuildConfig: vi.fn().mockResolvedValue({
            guildId: 'guild-1',
            defaultGameFamily: 'retail',
            compareModeDefault: 'character',
            compareAccessMode: 'officer_only',
            comparePublicPostingEnabled: false,
            recapPostModeDefault: 'preview-and-post',
            autoRecapMode: 'auto_preview',
            autoRecapChannelIds: ['channel-1'],
          }),
          saveGuildConfig: vi.fn(),
        },
        recapPreviewStateService,
        autoRecapDuplicateTrackingService,
      },
    });

    const body = channel.send.mock.calls[0]?.[0] as { flags?: number; allowed_mentions?: unknown };
    expect(body.flags).toBeUndefined();
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledOnce();
    expect(autoRecapDuplicateTrackingService.updateTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'preview_posted',
        latestOutputMessageId: 'preview-message-1',
        latestOutputKind: 'public_preview',
      }),
    );
  });

  it('keys passive auto recap activity by source message so distinct messages stay distinct', async () => {
    const channel = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ id: 'preview-message-1' })
        .mockResolvedValueOnce({ id: 'preview-message-2' }),
    };
    const autoRecapDuplicateTrackingService = {
      claimPassiveDetection: vi.fn().mockResolvedValue({ claimed: true, record: null }),
      updateTracking: vi.fn().mockResolvedValue(null),
    };
    const botActivityStore = { recordActivity: vi.fn().mockResolvedValue(undefined) };
    const handleOptions = {
      wclClient: {
        fetchAndNormalizeReport: vi.fn().mockResolvedValue(makeReport()),
        findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
      } as never,
      guildConfigStore: {
        getGuildConfig: vi.fn().mockResolvedValue({
          guildId: 'guild-1',
          defaultGameFamily: 'retail',
          compareModeDefault: 'character',
          compareAccessMode: 'officer_only',
          comparePublicPostingEnabled: false,
          recapPostModeDefault: 'preview-and-post',
          autoRecapMode: 'auto_preview',
          autoRecapChannelIds: ['channel-1'],
        }),
        saveGuildConfig: vi.fn(),
      },
      recapPreviewStateService: makeRecapPreviewStateService(),
      autoRecapDuplicateTrackingService,
      botActivityStore,
    };

    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-1',
        authorId: 'user-1',
        content: 'https://www.warcraftlogs.com/reports/ABC123',
      },
      channel,
      handleOptions,
    });
    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-2',
        authorId: 'user-1',
        content: 'https://www.warcraftlogs.com/reports/ABC123',
      },
      channel,
      handleOptions,
    });

    expect(botActivityStore.recordActivity).toHaveBeenCalledTimes(2);
    expect(botActivityStore.recordActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: 'auto_recap_preview:guild-1:channel-1:ABC123:source-message-1',
      }),
    );
    expect(botActivityStore.recordActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: 'auto_recap_preview:guild-1:channel-1:ABC123:source-message-2',
      }),
    );
  });

  it('does not repeat passive work when duplicate tracking reports an active record', async () => {
    const channel = { send: vi.fn().mockResolvedValue({ id: 'duplicate-message-1' }) };
    const autoRecapDuplicateTrackingService = {
      claimPassiveDetection: vi.fn().mockResolvedValue({
        claimed: false,
        record: {
          guildId: 'guild-1',
          channelId: 'channel-1',
          reportCode: 'ABC123',
          gameFamily: 'retail',
          sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
          sourceMessageId: 'source-message-1',
          sourceAuthorId: 'user-1',
          mode: 'prompt',
          status: 'final_posted',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      updateTracking: vi.fn().mockResolvedValue(null),
    };
    const fetchAndNormalizeReport = vi.fn();

    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-2',
        authorId: 'user-2',
        content: 'https://www.warcraftlogs.com/reports/ABC123',
      },
      channel,
      handleOptions: {
        wclClient: { fetchAndNormalizeReport } as never,
        guildConfigStore: {
          getGuildConfig: vi.fn().mockResolvedValue({
            guildId: 'guild-1',
            defaultGameFamily: 'retail',
            compareModeDefault: 'character',
            compareAccessMode: 'officer_only',
            comparePublicPostingEnabled: false,
            recapPostModeDefault: 'preview-and-post',
            autoRecapMode: 'prompt',
            autoRecapChannelIds: ['channel-1'],
          }),
          saveGuildConfig: vi.fn(),
        },
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapDuplicateTrackingService,
      },
    });

    expect(fetchAndNormalizeReport).not.toHaveBeenCalled();
    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'A recap for this Warcraft Logs report was already posted here recently.',
        allowed_mentions: { parse: [] },
      }),
    );
  });

  it('does not attempt a second public failure message when channel sending fails', async () => {
    const channel = { send: vi.fn().mockRejectedValue(new Error('missing permissions')) };
    const autoRecapDuplicateTrackingService = {
      claimPassiveDetection: vi.fn().mockResolvedValue({ claimed: true, record: null }),
      updateTracking: vi.fn().mockResolvedValue(null),
    };

    await handleAutoRecapMessageCreate({
      message: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        messageId: 'source-message-1',
        authorId: 'user-1',
        content: 'https://www.warcraftlogs.com/reports/ABC123',
      },
      channel,
      handleOptions: {
        wclClient: { fetchAndNormalizeReport: vi.fn() } as never,
        guildConfigStore: {
          getGuildConfig: vi.fn().mockResolvedValue({
            guildId: 'guild-1',
            defaultGameFamily: 'retail',
            compareModeDefault: 'character',
            compareAccessMode: 'officer_only',
            comparePublicPostingEnabled: false,
            recapPostModeDefault: 'preview-and-post',
            autoRecapMode: 'prompt',
            autoRecapChannelIds: ['channel-1'],
          }),
          saveGuildConfig: vi.fn(),
        },
        recapPreviewStateService: makeRecapPreviewStateService(),
        autoRecapPromptStateService: {
          savePromptState: vi.fn(),
          getValidPromptState: vi.fn(),
          consumeValidPromptState: vi.fn(),
        },
        autoRecapDuplicateTrackingService,
      },
    });

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(autoRecapDuplicateTrackingService.updateTracking).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('keeps recap preview success when activity recording fails', async () => {
    const wclClient = {
      fetchAndNormalizeReport: vi.fn().mockResolvedValue(makeReport()),
      findPreviousRaidSummaries: vi.fn().mockResolvedValue([]),
    } as never;
    const recapPreviewStateService = makeRecapPreviewStateService();
    const editFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('ok'),
    });
    vi.stubGlobal('fetch', editFetch);
    const scheduleBackgroundTask = vi.fn((task: () => void) => task());
    const botActivityStore = { recordActivity: vi.fn().mockRejectedValue(new Error('activity down')) };

    const response = await handleInteraction(
      {
        type: InteractionType.APPLICATION_COMMAND,
        id: 'recap-interaction-1',
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
        guildConfigStore: makeGuildConfigStore(),
        recapPreviewStateService,
        scheduleBackgroundTask,
        botActivityStore,
      },
    );

    expect(response).toMatchObject({
      type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      data: { flags: 64 },
    });
    await vi.waitFor(() => {
      expect(recapPreviewStateService.savePreviewState).toHaveBeenCalledOnce();
      expect(editFetch).toHaveBeenCalledWith(
        expect.stringContaining('/webhooks/app-1/token-1/messages/@original'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    expect(botActivityStore.recordActivity).toHaveBeenCalledOnce();
    expect(editFetch).toHaveBeenCalledTimes(1);
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
        data: { custom_id: 'recap:v2:post:ABC123:guild-1:channel-1' },
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
        data: { custom_id: 'recap:v2:post:ABC123:guild-1:channel-1' },
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
      channelId: 'channel-1',
    });
    expect(recapPreviewStateService.consumeValidPreviewState).toHaveBeenNthCalledWith(2, {
      reportCode: 'ABC123',
      guildId: 'guild-1',
      channelId: 'channel-1',
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
    const performance = embed.fields.find((field) => field.name === '⚡ Performance')?.value ?? '';
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
    expect(output).toContain(
      '▸ __**Damage Taken**__\n  #1 **Bulwark** · 120K · Protection Warrior',
    );
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
      'channel-1',
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
      'channel-1',
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
      'channel-1',
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
      'channel-1',
    );

    type PreviewButton = {
      custom_id?: string;
      label?: string;
    };

    const buttons = (body.components?.[0]?.components as PreviewButton[] | undefined) ?? [];
    const postButton = buttons.find((button) => button.custom_id?.includes(':post:'));
    const cancelButton = buttons.find((button) => button.custom_id?.includes(':cancel:'));

    expect(postButton?.custom_id).toBe('recap:v2:post:ABC123:guild-1:channel-1');
    expect((postButton?.custom_id?.length ?? 0) <= 100).toBe(true);
    expect(postButton?.label).toBe('Post to Current Channel');
    expect(cancelButton?.custom_id).toBe('recap:v2:cancel:ABC123:guild-1:channel-1');
    expect((cancelButton?.custom_id?.length ?? 0) <= 100).toBe(true);
    expect(cancelButton?.label).toBe('Cancel');
  });
});
