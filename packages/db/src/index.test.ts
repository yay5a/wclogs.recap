import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GuildSettingsModel,
  MongoGuildConfigStore,
<<<<<<< ours
  MongoRecapPreviewStateStore,
  RecapPreviewStateModel,
=======
  MongoTrendTrackingService,
  PlayerRaidSummaryModel,
  TrendSnapshotModel,
>>>>>>> theirs
} from './index.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MongoGuildConfigStore', () => {
  it('returns defaults when config does not exist', async () => {
    vi.spyOn(GuildSettingsModel, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(null),
    } as never);

    const store = new MongoGuildConfigStore();
    const config = await store.getGuildConfig('guild-1');

    expect(config.guildId).toBe('guild-1');
    expect(config.compareModeDefault).toBe('character');
    expect(config.accountabilityVisibility).toBe('off');
  });

  it('persists configured values via upsert', async () => {
    const lean = vi.fn().mockResolvedValue({
      guildId: 'guild-1',
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      accountabilityVisibility: 'shareable',
      coachingShareabilityDefault: 'shareable',
      recapPostModeDefault: 'preview-only',
    });
    vi.spyOn(GuildSettingsModel, 'findOneAndUpdate').mockReturnValue({ lean } as never);

    const store = new MongoGuildConfigStore();
    const saved = await store.saveGuildConfig('guild-1', {
      defaultGameFamily: 'mop_classic',
      compareModeDefault: 'mixed',
      accountabilityVisibility: 'shareable',
      coachingShareabilityDefault: 'shareable',
      recapPostModeDefault: 'preview-only',
    });

    expect(saved.defaultGameFamily).toBe('mop_classic');
    expect(saved.compareModeDefault).toBe('mixed');
    expect(GuildSettingsModel.findOneAndUpdate).toHaveBeenCalledOnce();
  });
});

<<<<<<< ours
describe('MongoRecapPreviewStateStore', () => {
  it('persists and retrieves valid preview state', async () => {
    const now = new Date('2026-04-09T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const savedState = {
      guildId: 'guild-1',
      channelId: 'channel-1',
      reportCode: 'ABC123',
      sourceUrl: 'https://www.warcraftlogs.com/reports/ABC123',
      summaryPayload: { reportTitle: 'Raid Night', bossesKilled: 3 },
      createdByUserId: 'user-1',
      customIdToken: 'token-1',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    };

    const updateLean = vi.fn().mockResolvedValue(savedState);
    vi.spyOn(RecapPreviewStateModel, 'findOneAndUpdate').mockReturnValue({
      lean: updateLean,
    } as never);
    const findLean = vi.fn().mockResolvedValue(savedState);
    vi.spyOn(RecapPreviewStateModel, 'findOne').mockReturnValue({
      lean: findLean,
    } as never);

    const store = new MongoRecapPreviewStateStore();
    const persisted = await store.savePreviewState(savedState);
    const found = await store.getValidPreviewState({
      customIdToken: 'token-1',
      guildId: 'guild-1',
    });

    expect(persisted.customIdToken).toBe('token-1');
    expect(found?.reportCode).toBe('ABC123');
    expect(RecapPreviewStateModel.findOne).toHaveBeenCalledWith({
      customIdToken: 'token-1',
      guildId: 'guild-1',
      expiresAt: { $gt: now },
    });
  });

  it('returns null when preview state is missing or expired', async () => {
    const findLean = vi.fn().mockResolvedValue(null);
    vi.spyOn(RecapPreviewStateModel, 'findOne').mockReturnValue({
      lean: findLean,
    } as never);

    const store = new MongoRecapPreviewStateStore();
    const result = await store.getValidPreviewState({
      customIdToken: 'token-missing',
      guildId: 'guild-1',
    });

    expect(result).toBeNull();
  });

  it('deletes preview state by lookup key', async () => {
    const deleteSpy = vi
      .spyOn(RecapPreviewStateModel, 'deleteOne')
      .mockResolvedValue({ acknowledged: true, deletedCount: 1 } as never);

    const store = new MongoRecapPreviewStateStore();
    await store.deletePreviewState({
      customIdToken: 'token-1',
      guildId: 'guild-1',
    });

    expect(deleteSpy).toHaveBeenCalledWith({
      customIdToken: 'token-1',
      guildId: 'guild-1',
    });
=======
describe('MongoTrendTrackingService', () => {
  it('upserts deterministically across reruns', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T00:00:00.000Z'));

    const summaries = [
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 40, executionScore: 50, capturedAt: new Date('2026-04-01T00:00:00.000Z'), reportCode: 'r1' },
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 60, executionScore: 70, capturedAt: new Date('2026-04-02T00:00:00.000Z'), reportCode: 'r2' },
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 80, executionScore: 90, capturedAt: new Date('2026-04-03T00:00:00.000Z'), reportCode: 'r3' },
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 75, executionScore: 95, capturedAt: new Date('2026-04-04T00:00:00.000Z'), reportCode: 'r4' },
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 55, executionScore: 65, capturedAt: new Date('2026-04-05T00:00:00.000Z'), reportCode: 'r5' },
    ];

    vi.spyOn(PlayerRaidSummaryModel, 'find').mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(summaries),
      }),
    } as never);
    const bulkWrite = vi
      .spyOn(TrendSnapshotModel, 'bulkWrite')
      .mockResolvedValue({} as never);

    const service = new MongoTrendTrackingService();
    await service.recomputeTrendsForGuild('guild-1');
    await service.recomputeTrendsForGuild('guild-1');

    expect(bulkWrite).toHaveBeenCalledTimes(2);
    expect(bulkWrite.mock.calls[0][0]).toEqual(bulkWrite.mock.calls[1][0]);
  });

  it('skips windows that do not have enough history', async () => {
    const summaries = [
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 40, executionScore: 50, capturedAt: new Date('2026-04-01T00:00:00.000Z'), reportCode: 'r1' },
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 60, executionScore: 70, capturedAt: new Date('2026-04-02T00:00:00.000Z'), reportCode: 'r2' },
      { guildId: 'guild-1', characterName: 'Alyra', averageParse: 80, executionScore: 90, capturedAt: new Date('2026-04-03T00:00:00.000Z'), reportCode: 'r3' },
    ];

    vi.spyOn(PlayerRaidSummaryModel, 'find').mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(summaries),
      }),
    } as never);
    const bulkWrite = vi
      .spyOn(TrendSnapshotModel, 'bulkWrite')
      .mockResolvedValue({} as never);

    const service = new MongoTrendTrackingService();
    await service.recomputeTrendsForGuild('guild-1');

    expect(bulkWrite).toHaveBeenCalledOnce();
    const operations = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { metric: string; window: string } };
    }>;
    expect(operations).toHaveLength(3);
    expect(operations.every((op) => op.updateOne.filter.window === 'last_3_raids')).toBe(true);
    expect(operations.map((op) => op.updateOne.filter.metric).sort()).toEqual([
      'attendance_count',
      'execution_average',
      'parse_average',
    ]);
>>>>>>> theirs
  });
});
