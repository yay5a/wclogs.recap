import { describe, expect, it, vi } from 'vitest';
import { collectGuildReportIndex } from './guild-report-index-collector.js';

describe('guild report index collector', () => {
  it('fetches bounded v1 guild report windows from the classic host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          id: 'ABC123',
          title: 'Raid Night',
          owner: 'Logger',
          zone: 1046,
          start: 100,
          end: 200,
        },
      ]),
    });

    const result = await collectGuildReportIndex({
      guildName: 'Shenanigans',
      guildServerSlug: 'Galakras',
      guildServerRegion: 'US',
      gameFamily: 'mop_classic',
      startTimeMs: 0,
      endTimeMs: 999,
      windowSizeMs: 1000,
      v1ClientKey: 'secret-key',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    expect(url.origin).toBe('https://classic.warcraftlogs.com');
    expect(url.pathname).toBe('/v1/reports/guild/Shenanigans/galakras/us');
    expect(url.searchParams.get('start')).toBe('0');
    expect(url.searchParams.get('end')).toBe('999');
    expect(url.searchParams.get('api_key')).toBe('secret-key');
    expect(JSON.stringify(result)).not.toContain('secret-key');
    expect(result).toEqual({
      rows: [
        {
          code: 'ABC123',
          title: 'Raid Night',
          owner: 'Logger',
          zoneId: 1046,
          startTime: 100,
          endTime: 200,
        },
      ],
      windowsQueried: 1,
      complexity: {
        apiCalls: 'O(W)',
        parseAndDedupe: 'O(N)',
        memory: 'O(U)',
      },
    });
  });

  it('queries multiple windows and deduplicates reports by code', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { id: 'FIRST', start: 100, end: 200 },
          { id: 'DUPLICATE', start: 900, end: 950 },
        ]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue([
          { id: 'DUPLICATE', start: 900, end: 950 },
          { id: 'SECOND', start: 1500, end: 1600 },
          { id: 'OUTSIDE', start: 3000, end: 3100 },
        ]),
      });

    const result = await collectGuildReportIndex({
      guildName: 'Guild Name',
      guildServerSlug: 'storm rage',
      guildServerRegion: 'us',
      startTimeMs: 0,
      endTimeMs: 1999,
      windowSizeMs: 1000,
      v1ClientKey: 'secret-key',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.windowsQueried).toBe(2);
    expect(result.rows.map((row) => row.code)).toEqual(['FIRST', 'DUPLICATE', 'SECOND']);

    const firstUrl = new URL(fetchImpl.mock.calls[0]?.[0] as string);
    const secondUrl = new URL(fetchImpl.mock.calls[1]?.[0] as string);
    expect(firstUrl.pathname).toBe('/v1/reports/guild/Guild%20Name/storm-rage/us');
    expect(firstUrl.searchParams.get('start')).toBe('0');
    expect(firstUrl.searchParams.get('end')).toBe('999');
    expect(secondUrl.searchParams.get('start')).toBe('1000');
    expect(secondUrl.searchParams.get('end')).toBe('1999');
  });

  it('redacts the v1 API key from request error messages', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    await expect(
      collectGuildReportIndex({
        guildName: 'Guild',
        guildServerSlug: 'realm',
        guildServerRegion: 'us',
        startTimeMs: 0,
        endTimeMs: 1,
        v1ClientKey: 'secret-key',
        fetchImpl,
      }),
    ).rejects.toThrow(/api_key=%5Bredacted%5D/);

    await expect(
      collectGuildReportIndex({
        guildName: 'Guild',
        guildServerSlug: 'realm',
        guildServerRegion: 'us',
        startTimeMs: 0,
        endTimeMs: 1,
        v1ClientKey: 'secret-key',
        fetchImpl,
      }),
    ).rejects.not.toThrow(/secret-key/);
  });
});
