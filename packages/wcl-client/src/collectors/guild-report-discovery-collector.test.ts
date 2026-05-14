import { describe, expect, it, vi } from 'vitest';
import { collectGuildReportDiscovery } from './guild-report-discovery-collector.js';

describe('guild report discovery collector', () => {
  const input = {
    guildName: 'Guild',
    guildServerSlug: 'stormrage',
    guildServerRegion: 'us',
    zoneId: 100,
    startTimeMs: 1,
    endTimeMs: 2,
  };

  it('uses v2 report discovery first', async () => {
    const request = vi.fn().mockResolvedValue({
      data: {
        reportData: {
          reports: {
            data: [{ code: 'AAA', startTime: 1000, endTime: 2000, zone: { id: 100 } }],
          },
        },
      },
    });

    const result = await collectGuildReportDiscovery({ request } as never, input);
    expect(result.source).toBe('v2');
    expect(result.rows).toEqual([{ code: 'AAA', startTime: 1000, endTime: 2000, zoneId: 100 }]);
  });

  it('falls back to v1 reports when v2 is unavailable', async () => {
    const request = vi.fn().mockRejectedValue(new Error('v2 failed'));
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([{ id: 'BBB', start: 3000, end: 4000, zone: 100 }]),
    });

    const result = await collectGuildReportDiscovery(
      { request } as never,
      { ...input, fetchImpl },
    );

    expect(result.source).toBe('v1');
    expect(result.rows).toEqual([{ code: 'BBB', startTime: 3000, endTime: 4000, zoneId: 100 }]);
  });
});
