import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuildSettingsModel, MongoGuildConfigStore } from './index.js';

afterEach(() => {
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
