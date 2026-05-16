import { afterAll, describe, expect, it } from 'vitest';
import type { ReportSummary } from '@wcl/domain';
import {
  buildReportCardHtml,
  buildReportResponseBody,
  closeReportRendererBrowser,
} from './report.js';

const baseSummary = (): ReportSummary => ({
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
    shortestPullMs: 100_000,
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
    highestTotalDps: [
      { playerName: 'Alyra', value: 40_000, className: 'Priest', specName: 'Discipline' },
    ],
    highestHps: [{ playerName: 'Alyra', value: 12_000, className: 'Druid' }],
    mostDeaths: [{ playerName: 'Floorroller', value: 5, className: 'Paladin' }],
    mostInterrupts: [{ playerName: 'Kickbot', value: 7 }],
    mostDispels: [{ playerName: 'Cleanse', value: 4 }],
  },
  partialDataNotes: [],
});

const expectPngSignature = (bytes: Uint8Array): void => {
  expect(Array.from(bytes.slice(0, 4))).toEqual([137, 80, 78, 71]);
};

describe('/report PNG renderer', () => {
  afterAll(async () => {
    await closeReportRendererBrowser();
  });

  it('builds card HTML with report sections and current report metrics', () => {
    const html = buildReportCardHtml(baseSummary());

    expect(html).toContain('Report Summary - Throne of Thunder (Heroic 10man)');
    expect(html).toContain('Encounter Highlights');
    expect(html).toContain('Best Execution');
    expect(html).toContain('Biggest Trouble');
    expect(html).toContain('Top Players');
    expect(html).toContain('Highest Avg Parse');
    expect(html).toContain('Highest Total DPS');
    expect(html).toContain('Highest HPS');
    expect(html).toContain('Most Deaths');
    expect(html).toContain('Expected drift is roughly 0.55% to 1.5%.');
    expect(html).not.toContain('Highest Total Healing');
    expect(html).not.toContain('render-fingerprint');
  });

  it('renders unavailable values inside the card HTML', () => {
    const summary = baseSummary();
    delete summary.bestExecutionEncounter;
    summary.topPlayers = {
      highestAverageParse: [],
      highestTotalDamage: [],
      highestTotalHealing: [],
      highestTotalDps: [],
      highestHps: [],
      mostDeaths: [],
      mostInterrupts: [],
      mostDispels: [],
    };

    const html = buildReportCardHtml(summary);

    expect(html).toContain('Best Execution');
    expect(html).toContain('unavailable');
    expect(html).toContain('<strong>n/a</strong>');
  });

  it('returns a normal PNG image attachment body', async () => {
    const response = await buildReportResponseBody(baseSummary(), { ephemeral: false });
    const file = response.files?.[0];

    expect(response).toMatchObject({
      content: 'https://www.warcraftlogs.com/reports/ABC123',
    });
    expect(response).not.toHaveProperty('flags');
    expect(response).not.toHaveProperty('embeds');
    expect(file?.name).toBe('report-summary.png');
    expect(file?.contentType).toBe('image/png');
    expect(file?.attachment).toBeInstanceOf(Uint8Array);
    expectPngSignature(file?.attachment ?? new Uint8Array());
  }, 15_000);

  it('preserves ephemeral flags for private report responses', async () => {
    const response = await buildReportResponseBody(baseSummary());

    expect(response.flags).toBe(64);
    expect(response.files?.[0]?.name).toBe('report-summary.png');
  }, 15_000);
});
