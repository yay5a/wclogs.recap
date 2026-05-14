import { describe, expect, it, vi } from 'vitest';
import { handleAutoReportMessageCreate } from './auto-report.js';

const baseHandleOptions = () =>
  ({
    guildConfigStore: {
      getGuildConfig: vi.fn().mockResolvedValue({
        autoReportMode: 'prompt',
        autoReportChannelIds: ['channel-1'],
      }),
    },
    autoReportDuplicateTrackingService: {
      claimPassiveDetection: vi.fn(),
      updateTracking: vi.fn().mockResolvedValue(null),
    },
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
