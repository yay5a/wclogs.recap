import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReportSummary } from '@wcl/domain';
import {
  buildReportCardHtml,
  closeReportRendererBrowser,
  renderReportSummaryPng,
} from '../../src/renderers/report.ts';

const previewDir = dirname(fileURLToPath(import.meta.url));

const previewSummary: ReportSummary = {
  reportCode: 'A6tvwZ9X1YCyrzLP',
  reportTitle: 'Raid Night',
  raidName: 'Throne of Thunder',
  difficultyName: 'Heroic',
  sizeLabel: '10man',
  reportLink: 'https://classic.warcraftlogs.com/reports/A6tvwZ9X1YCyrzLP',
  dateISO: new Date(Date.UTC(2025, 4, 18, 0, 0, 0)).toISOString(),
  startTimeISO: new Date(Date.UTC(2025, 4, 18, 19, 0, 0)).toISOString(),
  endTimeISO: new Date(Date.UTC(2025, 4, 18, 21, 41, 0)).toISOString(),
  durationMs: 2 * 60 * 60 * 1000 + 41 * 60 * 1000,
  bossPulls: 37,
  totalKills: 9,
  totalWipes: 14,
  totalDeaths: 149,
  encounters: [],
  bestExecutionEncounter: {
    bossName: "Jin'rokh the Breaker",
    encounterId: 1577,
    difficultyName: 'Heroic',
    pulls: 2,
    kills: 1,
    wipes: 0,
    totalDurationMs: 360_000,
    longestPullMs: 221_000,
    shortestPullMs: 139_000,
    deaths: 3,
    highestTotalDps: { playerName: 'PlayerA', value: 512_736 },
    highestHps: { playerName: 'PlayerB', value: 284_245 },
    highestParseDps: { metric: 'DPS', playerName: 'PlayerA', value: 94.3 },
    highestParseHps: { metric: 'HPS', playerName: 'PlayerB', value: 91.2 },
  },
  biggestTroubleEncounter: {
    bossName: 'Council of Elders',
    encounterId: 1578,
    difficultyName: 'Heroic',
    pulls: 14,
    kills: 0,
    wipes: 14,
    totalDurationMs: 1_900_000,
    longestPullMs: 369_000,
    shortestPullMs: 79_000,
    deaths: 146,
    highestTotalDps: { playerName: 'PlayerA', value: 200_576 },
    highestHps: { playerName: 'PlayerB', value: 122_500 },
  },
  highestParses: {
    dps: { metric: 'DPS', playerName: 'PlayerA', value: 94.3 },
    hps: { metric: 'HPS', playerName: 'PlayerB', value: 91.2 },
  },
  topPlayers: {
    highestAverageParse: [
      { playerName: 'PlayerA', value: 78.8 },
      { playerName: 'PlayerB', value: 75.2 },
      { playerName: 'PlayerC', value: 73.9 },
    ],
    highestTotalDamage: [
      { playerName: 'PlayerA', value: 48_200_000 },
      { playerName: 'PlayerB', value: 45_700_000 },
      { playerName: 'PlayerC', value: 44_100_000 },
    ],
    highestTotalHealing: [
      { playerName: 'HealerA', value: 18_500_000 },
      { playerName: 'HealerB', value: 16_400_000 },
      { playerName: 'HealerC', value: 14_900_000 },
    ],
    highestTotalDps: [
      { playerName: 'PlayerA', value: 48_200_000 },
      { playerName: 'PlayerB', value: 45_700_000 },
      { playerName: 'PlayerC', value: 44_100_000 },
    ],
    highestHps: [
      { playerName: 'HealerA', value: 112_400 },
      { playerName: 'HealerB', value: 108_700 },
      { playerName: 'HealerC', value: 95_100 },
    ],
    mostDeaths: [
      { playerName: 'PlayerX', value: 9 },
      { playerName: 'PlayerY', value: 7 },
      { playerName: 'PlayerZ', value: 6 },
    ],
    mostInterrupts: [
      { playerName: 'PlayerA', value: 18 },
      { playerName: 'PlayerB', value: 12 },
      { playerName: 'PlayerC', value: 9 },
    ],
    mostDispels: [
      { playerName: 'PlayerA', value: 14 },
      { playerName: 'PlayerB', value: 10 },
      { playerName: 'PlayerC', value: 8 },
    ],
  },
  partialDataNotes: [],
};

const main = async (): Promise<void> => {
  try {
    await writeFile(join(previewDir, 'report-renderer.html'), buildReportCardHtml(previewSummary));
    await writeFile(
      join(previewDir, 'report-summary.png'),
      await renderReportSummaryPng(previewSummary),
    );
  } finally {
    await closeReportRendererBrowser();
  }
};

void main();
