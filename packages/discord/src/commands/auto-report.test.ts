import { describe, expect, it, vi } from 'vitest';
import type { ReportSummary } from '@wcl/domain';
import {
  createFollowupInteractionResponse,
  editOriginalInteractionResponse,
} from '../infrastructure/discord-api.js';
import {
  handleAutoReportComponentInteraction,
  handleAutoReportMessageCreate,
  makeAutoReportDuplicateCustomId,
  makeAutoReportPromptPreviewCustomId,
} from './auto-report.js';

vi.mock('../infrastructure/discord-api.js', () => ({
  createFollowupInteractionResponse: vi.fn().mockResolvedValue({ id: 'followup-1' }),
  editOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
  safeEditOriginalInteractionResponse: vi.fn().mockResolvedValue(undefined),
}));

const ENCOUNTER_HIGHLIGHTS_LABEL = 'Encounter Highlights 🗿';
const TOP_PLAYERS_LABEL = 'Top Players 🏋️‍♂️';
const BIGGEST_TROUBLE_FIELD = 'Biggest Trouble 🙎‍♂️';

const summaryFixture = (): ReportSummary => ({
  reportCode: 'ABC123',
  reportTitle: 'Raid Night',
  raidName: 'Throne of Thunder',
  difficultyName: 'Heroic',
  sizeLabel: '10man',
  reportLink: 'https://www.warcraftlogs.com/reports/ABC123',
  dateISO: new Date(Date.UTC(2026, 4, 1, 1)).toISOString(),
  startTimeISO: new Date(Date.UTC(2026, 4, 1, 1)).toISOString(),
  endTimeISO: new Date(Date.UTC(2026, 4, 1, 3)).toISOString(),
  durationMs: 2 * 60 * 60 * 1000,
  bossPulls: 4,
  totalKills: 1,
  totalWipes: 3,
  totalDeaths: 8,
  encounters: [],
  bestExecutionEncounter: {
    bossName: 'Jinrokh',
    encounterId: 1001,
    difficultyName: 'Heroic',
    pulls: 2,
    kills: 1,
    wipes: 1,
    totalDurationMs: 180_000,
    deaths: 3,
    highestTotalDps: { playerName: 'Alyra', value: 40_000 },
    highestHps: { playerName: 'Alyra', value: 12_000 },
    highestParseDps: { metric: 'DPS', playerName: 'Alyra', value: 95 },
    highestParseHps: { metric: 'HPS', playerName: 'Alyra', value: 82 },
  },
  biggestTroubleEncounter: {
    bossName: 'Council',
    encounterId: 1002,
    difficultyName: 'Heroic',
    pulls: 2,
    kills: 0,
    wipes: 2,
    totalDurationMs: 280_000,
    longestPullMs: 200_000,
    shortestPullMs: 130_000,
    deaths: 5,
    highestTotalDps: { playerName: 'Bulwark', value: 27_000 },
    highestHps: { playerName: 'Alyra', value: 15_500 },
  },
  highestParses: {
    dps: { metric: 'DPS', playerName: 'Alyra', value: 85 },
    hps: { metric: 'HPS', playerName: 'Alyra', value: 80 },
  },
  topPlayers: {
    highestAverageParse: [{ playerName: 'Alyra', value: 88 }],
    highestTotalDamage: [{ playerName: 'Damagey', value: 9_900_000 }],
    highestTotalHealing: [{ playerName: 'Healz', value: 8_800_000 }],
    highestTotalDps: [{ playerName: 'Alyra', value: 40_000 }],
    highestHps: [{ playerName: 'Alyra', value: 12_000 }],
    mostDeaths: [{ playerName: 'Floorroller', value: 5 }],
    mostInterrupts: [{ playerName: 'Kickbot', value: 7 }],
    mostDispels: [{ playerName: 'Cleanse', value: 4 }],
  },
  partialDataNotes: [],
});

const assertArchitectureReportBody = (body: Record<string, unknown>) => {
  const embeds = body.embeds as Array<{ fields?: Array<{ name?: string; value?: string }> }>;
  const fields = embeds[0]?.fields ?? [];
  const fieldNames = fields.map((field) => field.name);
  const flattened = fields.map((field) => `${field.name ?? ''}\n${field.value ?? ''}`).join('\n');
  const serialized = JSON.stringify(body);

  expect(flattened).toContain(ENCOUNTER_HIGHLIGHTS_LABEL);
  expect(flattened).toContain(TOP_PLAYERS_LABEL);
  expect(fieldNames).toContain('Best Execution ⚔️');
  expect(fieldNames).toContain(BIGGEST_TROUBLE_FIELD);
  expect(fieldNames).not.toContain('Highest Total Healing');
  expect(fieldNames).not.toContain('Highest DPS');
  expect(serialized).not.toContain('render-fingerprint');
  expect(serialized).not.toContain('report-runtime-canary');
  expect(serialized).not.toContain('report-path:');
};

const baseHandleOptions = () =>
  ({
    wclClient: {
      fetchReportSummary: vi.fn().mockResolvedValue(summaryFixture()),
    },
    guildConfigStore: {
      getGuildConfig: vi.fn().mockResolvedValue({
        autoReportMode: 'prompt',
        autoReportChannelIds: ['channel-1'],
      }),
    },
    autoReportDuplicateTrackingService: {
      claimPassiveDetection: vi.fn(),
      getByConfirmationNonce: vi.fn(),
      updateTracking: vi.fn().mockResolvedValue(null),
    },
    autoReportPromptStateService: {
      savePromptState: vi.fn(),
      getValidPromptState: vi.fn(),
      consumeValidPromptState: vi.fn(),
    },
    scheduleBackgroundTask: (task: () => void) => task(),
  }) as never;

const baseMessage = () => ({
  guildId: 'guild-1',
  channelId: 'channel-1',
  messageId: 'message-1',
  authorId: 'user-1',
  authorBot: false,
  content: 'https://www.warcraftlogs.com/reports/ABC123',
});

describe('auto report duplicate claim behavior', () => {
  it('does not send duplicate confirmation when duplicate claim is from the same source message', async () => {
    const handleOptions = baseHandleOptions() as Record<string, unknown>;
    const duplicateService = handleOptions.autoReportDuplicateTrackingService as {
      claimPassiveDetection: ReturnType<typeof vi.fn>;
    };
    duplicateService.claimPassiveDetection.mockResolvedValue({
      claimed: false,
      record: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        gameFamily: 'retail',
        sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
        sourceMessageId: 'message-1',
        sourceAuthorId: 'user-1',
        mode: 'prompt',
        status: 'processing',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    const channel = { send: vi.fn() };

    await handleAutoReportMessageCreate({
      message: baseMessage(),
      channel,
      handleOptions: handleOptions as never,
    });

    expect(channel.send).not.toHaveBeenCalled();
  });

  it('still sends duplicate confirmation when duplicate claim is for a different source message', async () => {
    const handleOptions = baseHandleOptions() as Record<string, unknown>;
    const duplicateService = handleOptions.autoReportDuplicateTrackingService as {
      claimPassiveDetection: ReturnType<typeof vi.fn>;
      updateTracking: ReturnType<typeof vi.fn>;
    };
    duplicateService.claimPassiveDetection.mockResolvedValue({
      claimed: false,
      record: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        gameFamily: 'retail',
        sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
        sourceMessageId: 'older-message',
        sourceAuthorId: 'user-2',
        mode: 'prompt',
        status: 'processing',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    const channel = { send: vi.fn().mockResolvedValue({ id: 'duplicate-msg-1' }) };

    await handleAutoReportMessageCreate({
      message: baseMessage(),
      channel,
      handleOptions: handleOptions as never,
    });

    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(duplicateService.updateTracking).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'channel-1',
        reportCode: 'ABC123',
        duplicateConfirmationMessageId: 'duplicate-msg-1',
      }),
    );
  });
});

describe('auto report report embed paths', () => {
  it('uses the shared report renderer for passive auto-preview output', async () => {
    const handleOptions = baseHandleOptions() as Record<string, unknown>;
    (
      handleOptions.guildConfigStore as { getGuildConfig: ReturnType<typeof vi.fn> }
    ).getGuildConfig.mockResolvedValue({
      autoReportMode: 'auto_preview',
      autoReportChannelIds: ['channel-1'],
    });
    (
      handleOptions.autoReportDuplicateTrackingService as {
        claimPassiveDetection: ReturnType<typeof vi.fn>;
      }
    ).claimPassiveDetection.mockResolvedValue({ claimed: true, record: null });
    const channel = { send: vi.fn().mockResolvedValue({ id: 'preview-message-1' }) };

    await handleAutoReportMessageCreate({
      message: baseMessage(),
      channel,
      handleOptions: handleOptions as never,
    });

    assertArchitectureReportBody(channel.send.mock.calls[0]?.[0] as Record<string, unknown>);
  });

  it('uses the shared report renderer for passive auto-post output', async () => {
    const handleOptions = baseHandleOptions() as Record<string, unknown>;
    (
      handleOptions.guildConfigStore as { getGuildConfig: ReturnType<typeof vi.fn> }
    ).getGuildConfig.mockResolvedValue({
      autoReportMode: 'auto_post',
      autoReportChannelIds: ['channel-1'],
    });
    (
      handleOptions.autoReportDuplicateTrackingService as {
        claimPassiveDetection: ReturnType<typeof vi.fn>;
      }
    ).claimPassiveDetection.mockResolvedValue({ claimed: true, record: null });
    const channel = { send: vi.fn().mockResolvedValue({ id: 'final-message-1' }) };

    await handleAutoReportMessageCreate({
      message: baseMessage(),
      channel,
      handleOptions: handleOptions as never,
    });

    const sentBody = channel.send.mock.calls[0]?.[0] as Record<string, unknown>;
    assertArchitectureReportBody(sentBody);
    expect(sentBody).not.toHaveProperty('flags');
  });

  it('uses the shared report renderer for prompt preview output', async () => {
    vi.mocked(editOriginalInteractionResponse).mockClear();
    const handleOptions = baseHandleOptions() as Record<string, unknown>;
    (
      handleOptions.autoReportPromptStateService as {
        getValidPromptState: ReturnType<typeof vi.fn>;
      }
    ).getValidPromptState.mockResolvedValue({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      gameFamily: 'retail',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      sourceMessageId: 'message-1',
      sourceAuthorId: 'user-1',
      promptMessageId: 'prompt-1',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await handleAutoReportComponentInteraction(
      {
        id: 'interaction-1',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        member: { user: { id: 'user-1' } },
        data: { custom_id: makeAutoReportPromptPreviewCustomId('message-1') },
      },
      handleOptions as never,
    );

    await vi.waitFor(() => expect(editOriginalInteractionResponse).toHaveBeenCalled());
    assertArchitectureReportBody(
      vi.mocked(editOriginalInteractionResponse).mock.calls[0]?.[2] as Record<string, unknown>,
    );
  });

  it('rebuilds duplicate post output through the shared report renderer', async () => {
    vi.mocked(createFollowupInteractionResponse).mockClear();
    const handleOptions = baseHandleOptions() as Record<string, unknown>;
    (
      handleOptions.autoReportDuplicateTrackingService as {
        getByConfirmationNonce: ReturnType<typeof vi.fn>;
        updateTracking: ReturnType<typeof vi.fn>;
      }
    ).getByConfirmationNonce.mockResolvedValue({
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      gameFamily: 'retail',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      sourceMessageId: 'message-1',
      sourceAuthorId: 'user-1',
      mode: 'auto_post',
      status: 'final_posted',
      confirmationNonce: 'nonce-1',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await handleAutoReportComponentInteraction(
      {
        id: 'interaction-2',
        application_id: 'app-1',
        token: 'token-1',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        member: { user: { id: 'user-1' } },
        data: { custom_id: makeAutoReportDuplicateCustomId('o', 'nonce-1') },
      },
      handleOptions as never,
    );

    await vi.waitFor(() => expect(createFollowupInteractionResponse).toHaveBeenCalled());
    assertArchitectureReportBody(
      vi.mocked(createFollowupInteractionResponse).mock.calls[0]?.[2] as Record<string, unknown>,
    );
  });
});
