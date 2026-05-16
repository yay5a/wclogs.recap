import { describe, expect, it } from 'vitest';
import { buildGuildRankReportWindows } from './guildrank-report-windows.js';

describe('guildrank report windows', () => {
  it('builds current lockout and baseline calendar windows', () => {
    const windows = buildGuildRankReportWindows(new Date('2026-05-16T15:55:08.250Z'));

    expect(new Date(windows.current.startTimeMs).toISOString()).toBe(
      '2026-05-12T00:00:00.000Z',
    );
    expect(new Date(windows.current.endTimeMs).toISOString()).toBe('2026-05-16T15:55:08.250Z');
    expect(new Date(windows.baseline.startTimeMs).toISOString()).toBe(
      '2026-04-28T00:00:00.000Z',
    );
    expect(new Date(windows.baseline.endTimeMs).toISOString()).toBe(
      '2026-05-11T23:59:59.999Z',
    );
    expect(new Date(windows.all.startTimeMs).toISOString()).toBe('2026-04-28T00:00:00.000Z');
    expect(new Date(windows.all.endTimeMs).toISOString()).toBe('2026-05-16T15:55:08.250Z');
  });
});
