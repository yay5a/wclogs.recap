import { describe, expect, it } from 'vitest';
import { normalizeReport, parseReportUrl, selectAdapter } from './index.js';
import fixture from './fixtures/report-fixture.json' with { type: 'json' };

describe('parseReportUrl', () => {
  it('parses canonical retail report URLs', () => {
    const parsed = parseReportUrl('https://www.warcraftlogs.com/reports/abc123XYZ#fight=5');
    expect(parsed.reportCode).toBe('abc123XYZ');
    expect(parsed.gameFamilyHint).toBe('retail');
  });

  it('parses mop classic report URLs', () => {
    const parsed = parseReportUrl('https://classic.warcraftlogs.com/reports/QwErTy12?fight=7');
    expect(parsed.reportCode).toBe('QwErTy12');
    expect(parsed.gameFamilyHint).toBe('mop_classic');
    expect(parsed.requestedFightId).toBe(7);
  });

  it('keeps legacy query parameter fallback', () => {
    const parsed = parseReportUrl('https://www.warcraftlogs.com/reports/view?code=LEGACY1');
    expect(parsed.reportCode).toBe('LEGACY1');
  });

  it('rejects invalid URLs', () => {
    expect(() => parseReportUrl('not-a-url')).toThrow('Invalid URL format');
    expect(() => parseReportUrl('https://example.com/reports/abc')).toThrow('Unsupported Warcraft Logs host');
    expect(() => parseReportUrl('https://www.warcraftlogs.com/reports/abc?fight=bad')).toThrow('Invalid fight selector');
  });
});

describe('adapter selection', () => {
  it('prefers classic adapter on classic host', () => {
    const parsed = parseReportUrl('https://classic.warcraftlogs.com/reports/abc123');
    expect(selectAdapter(parsed).name).toContain('mopClassicAdapter');
  });

  it('uses retail adapter by default', () => {
    const parsed = parseReportUrl('https://www.warcraftlogs.com/reports/abc123');
    expect(selectAdapter(parsed).name).toContain('retailAdapter');
  });
});

describe('normalizeReport', () => {
  it('maps real ranking fields when present', () => {
    const parsed = parseReportUrl('https://www.warcraftlogs.com/reports/abc123');
    const raw = {
      data: {
        reportData: {
          report: {
            ...fixture.data.reportData.report,
            rankings: JSON.stringify({
              data: [
                { name: 'Alyra', rankPercent: 95, executionRank: 88, class: 'Paladin', spec: 'Holy' },
                { name: 'Alyra', rankPercent: 90, executionRank: 84, class: 'Paladin', spec: 'Holy' },
                { name: 'Bronn', rankPercent: 80, executionRank: 75, class: 'Warrior', spec: 'Fury' },
              ],
            }),
          },
        },
      },
    };

    const normalized = normalizeReport(raw, parsed);
    const alyra = normalized.players.find((p) => p.name === 'Alyra');

    expect(alyra?.performance.bestSingleBossParse).toBe(95);
    expect(alyra?.performance.averageParseAcrossKills).toBe(92.5);
    expect(alyra?.execution.executionScore).toBe(86);
  });

  it('omits unavailable metric fields gracefully', () => {
    const parsed = parseReportUrl('https://www.warcraftlogs.com/reports/abc123');
    const rawWithoutRankings = {
      data: {
        reportData: {
          report: { ...fixture.data.reportData.report, rankings: undefined },
        },
      },
    };
    const normalized = normalizeReport(rawWithoutRankings, parsed);
    const player = normalized.players[0];
    expect(player?.performance.bestSingleBossParse).toBeUndefined();
    expect(player?.execution.executionScore).toBeUndefined();
  });
});
