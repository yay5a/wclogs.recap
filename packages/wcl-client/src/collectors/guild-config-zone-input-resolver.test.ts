import { describe, expect, it, vi } from 'vitest';
import { resolveGuildConfigZoneInput } from './guild-config-zone-input-resolver.js';

describe('guild config/zone input resolver', () => {
  it('resolves configured zone and required difficulty/size', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        worldData: {
          zone: {
            id: 100,
            name: 'Throne',
            difficulties: [
              { id: 3, name: 'Normal', sizes: [10, 25] },
              { id: 4, name: 'Heroic', sizes: [10, 25] },
            ],
            encounters: [
              { id: 1, name: 'A' },
              { id: 2, name: 'B' },
            ],
          },
        },
      },
    });

    const result = await resolveGuildConfigZoneInput({ request } as never, {
      guildName: 'Guild',
      guildServerSlug: 'stormrage',
      guildServerRegion: 'us',
      zoneId: 100,
      difficulty: 'heroic',
      size: '10man',
    });

    expect(result.difficultyId).toBe(4);
    expect(result.sizeValue).toBe(10);
    expect(result.totalEncounters).toBe(2);
    expect(result.zoneName).toBe('Throne');
  });

  it('throws for unsupported size', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        worldData: {
          zone: {
            id: 100,
            name: 'Throne',
            difficulties: [{ id: 4, name: 'Heroic', sizes: [10] }],
            encounters: [],
          },
        },
      },
    });

    await expect(
      resolveGuildConfigZoneInput({ request } as never, {
        guildName: 'Guild',
        guildServerSlug: 'stormrage',
        guildServerRegion: 'us',
        zoneId: 100,
        difficulty: 'heroic',
        size: '25man',
      }),
    ).rejects.toThrow(/not supported/i);
  });

  it('falls back to worldData.zones list when worldData.zone(id) is unavailable', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          worldData: {
            zone: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          worldData: {
            zones: [{ id: 1046, name: 'Throne of Thunder' }],
          },
        },
      });

    const result = await resolveGuildConfigZoneInput({ request } as never, {
      guildName: 'Guild',
      guildServerSlug: 'stormrage',
      guildServerRegion: 'us',
      zoneId: 1046,
      difficulty: 'heroic',
      size: '10man',
    });

    expect(result.zoneName).toBe('Throne of Thunder');
    expect(result.difficultyId).toBe(4);
    expect(result.sizeValue).toBe(10);
    expect(result.totalEncounters).toBe(0);
  });

  it('throws when worldData.zone(id) is null and worldData.zones does not include the configured zone', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          worldData: {
            zone: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          worldData: {
            zones: [{ id: 1046, name: 'Throne of Thunder' }],
          },
        },
      });

    await expect(
      resolveGuildConfigZoneInput({ request } as never, {
        guildName: 'Guild',
        guildServerSlug: 'stormrage',
        guildServerRegion: 'us',
        zoneId: 1523,
        difficulty: 'heroic',
        size: '10man',
      }),
    ).rejects.toThrow(/configured zone 1523 is unavailable/i);
  });
});
