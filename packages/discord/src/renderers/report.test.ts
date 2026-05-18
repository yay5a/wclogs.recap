import { afterAll, describe, expect, it } from 'vitest';
import type { ReportSummary } from '@wcl/domain';
import {
  buildReportCardHtml,
  buildReportResponseBody,
  closeReportRendererBrowser,
  EPHEMERAL_MESSAGE_FLAG,
  SUPPRESS_EMBEDS_MESSAGE_FLAG,
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

const readPngDimensions = (bytes: Uint8Array): { width: number; height: number } => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
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
    expect(html).toContain('width: 1280px;');
    expect(html).toContain('min-height: 1700px;');
    expect(html).toContain('--inner-width: 1040px;');
    expect(html).toContain('Kills / Wipes');
    expect(html).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(html).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(html).toContain('width: min(100%, 900px);');
    expect(html).toContain('width: min(100%, 960px);');
    expect(html).toContain(
      'Parsing complex raw data structures from an overpowered database is not the same as parsing against an overpowered raid boss.',
    );
    expect(html).toContain(
      'expected to drift by ~0.55% up to ~1.5% due to rounding, and calculation methods of DPS/HPS totals',
    );
    expect(html).toContain('.rank-75 { color: #a335ee; }');
    expect(html).toContain('.rank-95 { color: #ff8000; }');
    expect(html).toContain('class="rank-95">95</strong>');
    expect(html).toContain('class="rank-75">88</strong>');
    expect(html).not.toContain('Total Kills');
    expect(html).not.toContain('Total Wipes');
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
    const flags = response.flags ?? 0;

    expect(response).toMatchObject({
      content: 'https://www.warcraftlogs.com/reports/ABC123',
    });
    expect(flags & EPHEMERAL_MESSAGE_FLAG).toBe(0);
    expect(flags & SUPPRESS_EMBEDS_MESSAGE_FLAG).toBe(SUPPRESS_EMBEDS_MESSAGE_FLAG);
    expect(response.allowed_mentions).toEqual({ parse: [] });
    expect(response).not.toHaveProperty('embeds');
    expect(file?.name).toBe('report-summary.png');
    expect(file?.contentType).toBe('image/png');
    expect(file?.description).toBe('Raid report summary');
    expect(file?.attachment).toBeInstanceOf(Uint8Array);
    expectPngSignature(file?.attachment ?? new Uint8Array());
    const dimensions = readPngDimensions(file?.attachment ?? new Uint8Array());
    expect(dimensions.width).toBe(1280);
    expect(dimensions.height).toBeGreaterThanOrEqual(1700);
  }, 15_000);

  it('preserves ephemeral flags for private report responses', async () => {
    const response = await buildReportResponseBody(baseSummary());
    const flags = response.flags ?? 0;

    expect(flags & EPHEMERAL_MESSAGE_FLAG).toBe(EPHEMERAL_MESSAGE_FLAG);
    expect(flags & SUPPRESS_EMBEDS_MESSAGE_FLAG).toBe(SUPPRESS_EMBEDS_MESSAGE_FLAG);
    expect(response.files?.[0]?.name).toBe('report-summary.png');
  }, 15_000);
});
