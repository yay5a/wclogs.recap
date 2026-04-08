import { describe, expect, it } from 'vitest';
import { parseReportUrl } from './index.js';

describe('parseReportUrl', () => {
  it('detects retail by default', () => {
    const parsed = parseReportUrl('https://www.warcraftlogs.com/reports/abc123?report=abc123');
    expect(parsed.gameFamily).toBe('retail');
  });

  it('detects mop classic from path', () => {
    const parsed = parseReportUrl('https://classic.warcraftlogs.com/reports/abc123?code=abc123');
    expect(parsed.gameFamily).toBe('mop_classic');
  });
});
