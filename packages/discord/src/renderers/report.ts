import { chromium } from 'playwright-chromium';
import type { Browser } from 'playwright-chromium';
import type {
  ReportEncounterSummary,
  ReportMetricRow,
  ReportParseRow,
  ReportSummary,
} from '@wcl/domain';
import type { DiscordMessageBody } from '../infrastructure/discord-api.js';

const EPHEMERAL_MESSAGE_FLAG = 64;
const REPORT_CARD_FILENAME = 'report-summary.png';
const REPORT_CARD_WIDTH = 1147;
const REPORT_CARD_MIN_HEIGHT = 820;
let browserPromise: Promise<Browser> | null = null;

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const integerFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'UTC',
});

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPE[character] ?? character);

const present = (value: string | undefined): value is string => Boolean(value);

const formatCompact = (value: number): string =>
  compactNumberFormatter.format(value).replace('K', 'k');

const formatDuration = (durationMs: number): string => {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const formatPullDuration = (durationMs?: number): string =>
  typeof durationMs === 'number'
    ? `${Math.floor(Math.max(0, durationMs) / 60_000)}:${String(
        Math.floor(Math.max(0, durationMs) / 1000) % 60,
      ).padStart(2, '0')}`
    : 'unavailable';

const formatDate = (iso: string): string => dateFormatter.format(new Date(iso));

const formatTime = (iso: string): string => timeFormatter.format(new Date(iso));

const formatRate = (value: number): string => `${formatCompact(value)}/s`;

const reportTitle = (summary: ReportSummary): string => {
  const difficultyAndSize = [summary.difficultyName, summary.sizeLabel].filter(present).join(' ');
  return `Report Summary - ${summary.raidName ?? summary.reportTitle}${
    difficultyAndSize ? ` (${difficultyAndSize})` : ''
  }`;
};

const valueOrUnavailable = (value: string | undefined): string => value ?? 'unavailable';

const parseValue = (row?: ReportParseRow): string | undefined =>
  row ? `${escapeHtml(row.playerName)} - ${decimalFormatter.format(row.value)}` : undefined;

const metricValue = (
  row: ReportMetricRow | undefined,
  formatter: (value: number) => string,
): string | undefined => (row ? `${escapeHtml(row.playerName)} - ${formatter(row.value)}` : undefined);

const renderMetricLine = (label: string, value: string | undefined, color: string): string => `
  <div class="metric-line">
    <span class="metric-label">${escapeHtml(label)}:</span>
    <span class="metric-text">${valueOrUnavailable(value)}</span>
    <span class="metric-value ${color}"></span>
  </div>
`;

const renderEncounterStats = (encounter: ReportEncounterSummary): string => `
  <div class="encounter-stats">
    <div class="mini-stat"><span>Pulls</span><strong>${integerFormatter.format(encounter.pulls)}</strong></div>
    <div class="mini-stat"><span>Kill / Wipes</span><strong><b class="good">${integerFormatter.format(
      encounter.kills,
    )}</b> / <b class="${encounter.wipes > 0 ? 'bad' : 'muted'}">${integerFormatter.format(
      encounter.wipes,
    )}</b></strong></div>
    <div class="mini-stat"><span>Deaths</span><strong class="warn">${
      typeof encounter.deaths === 'number' ? integerFormatter.format(encounter.deaths) : 'n/a'
    }</strong></div>
  </div>
`;

const renderEncounterCard = (
  title: string,
  encounter: ReportEncounterSummary | undefined,
  tone: 'good' | 'bad',
): string => {
  const icon = tone === 'good' ? '⚔' : '!';
  if (!encounter) {
    return `
      <section class="encounter-card ${tone}">
        <div class="encounter-title">
          <span class="encounter-icon">${icon}</span>
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>unavailable</p>
          </div>
        </div>
      </section>
    `;
  }

  const difficulty = encounter.difficultyName ? ` (${encounter.difficultyName})` : '';
  return `
    <section class="encounter-card ${tone}">
      <div class="encounter-title">
        <span class="encounter-icon">${icon}</span>
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(encounter.bossName)}${escapeHtml(difficulty)}</p>
        </div>
      </div>
      ${renderEncounterStats(encounter)}
      ${
        tone === 'bad'
          ? `<div class="pull-durations">
              <span>Longest Pull <strong>${formatPullDuration(encounter.longestPullMs)}</strong></span>
              <span>Shortest Pull <strong>${formatPullDuration(encounter.shortestPullMs)}</strong></span>
            </div>`
          : ''
      }
      <div class="metric-grid">
        ${
          tone === 'good'
            ? `<div>
                <h4>Highest Parses</h4>
                ${renderMetricLine('DPS', parseValue(encounter.highestParseDps), 'purple-text')}
                ${renderMetricLine('HPS', parseValue(encounter.highestParseHps), 'gold-text')}
              </div>`
            : ''
        }
        <div>
          <h4>Highest Totals</h4>
          ${renderMetricLine(
            'DPS',
            metricValue(encounter.highestTotalDps, formatRate),
            'purple-text',
          )}
          ${renderMetricLine('HPS', metricValue(encounter.highestHps, formatRate), 'gold-text')}
        </div>
      </div>
    </section>
  `;
};

const rankColor = (index: number): string => {
  if (index === 0) return 'purple-text';
  if (index === 1) return 'gold-text';
  return 'blue-text';
};

const renderRankedRows = (
  rows: readonly ReportMetricRow[],
  formatter: (value: number) => string,
): string => {
  const renderedRows = rows.slice(0, 3).map(
    (row, index) => `
      <div class="player-row">
        <span>${index + 1}.</span>
        <span>${escapeHtml(row.playerName)}</span>
        <strong class="${rankColor(index)}">${escapeHtml(formatter(row.value))}</strong>
      </div>
    `,
  );
  return renderedRows.length > 0
    ? renderedRows.join('')
    : '<div class="player-row unavailable"><span>-</span><span>unavailable</span><strong>n/a</strong></div>';
};

const renderPlayerCard = (
  icon: string,
  title: string,
  rows: readonly ReportMetricRow[],
  formatter: (value: number) => string,
): string => `
  <section class="player-card">
    <h3><span>${icon}</span>${escapeHtml(title)}</h3>
    ${renderRankedRows(rows, formatter)}
  </section>
`;

const renderStatTile = (icon: string, label: string, value: string, color: string): string => `
  <section class="stat-tile">
    <span class="stat-icon ${color}">${icon}</span>
    <div>
      <span>${escapeHtml(label)}</span>
      <strong class="${color}">${escapeHtml(value)}</strong>
    </div>
  </section>
`;

const renderNotes = (summary: ReportSummary): string => {
  if (summary.partialDataNotes.length === 0) return '';
  return `
    <footer class="notes">
      ${summary.partialDataNotes
        .slice(0, 2)
        .map((note) => `<span>Note: ${escapeHtml(note)}</span>`)
        .join('')}
    </footer>
  `;
};

export const buildReportCardHtml = (summary: ReportSummary): string => `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: ${REPORT_CARD_WIDTH}px;
      min-height: ${REPORT_CARD_MIN_HEIGHT}px;
      background: transparent;
      font-family: Arial, Helvetica, sans-serif;
      color: #f5f7fb;
    }
    #report-card {
      position: relative;
      width: ${REPORT_CARD_WIDTH}px;
      min-height: ${REPORT_CARD_MIN_HEIGHT}px;
      overflow: hidden;
      border: 1px solid #2c3440;
      border-radius: 10px;
      background:
        radial-gradient(circle at 12% 8%, rgba(82, 169, 255, 0.18), transparent 28%),
        linear-gradient(135deg, #111820 0%, #080c11 45%, #121821 100%);
      padding: 18px 16px 12px 36px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
    }
    #report-card::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 7px;
      background: linear-gradient(#b46cff, #7d3cff);
    }
    .header {
      display: grid;
      grid-template-columns: 128px 1fr;
      gap: 26px;
      align-items: start;
    }
    .raid-art {
      width: 128px;
      height: 112px;
      border: 1px solid #26374a;
      border-radius: 7px;
      background:
        radial-gradient(circle at 50% 18%, rgba(88, 172, 255, 0.62), transparent 22%),
        linear-gradient(145deg, #192a3b 0%, #05080b 70%);
      display: grid;
      place-items: center;
      color: #ffc44d;
      font-size: 58px;
      text-shadow: 0 0 24px rgba(86, 176, 255, 0.75);
    }
    h1 {
      margin: 2px 0 12px;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 800;
    }
    .time-row {
      display: flex;
      flex-wrap: wrap;
      gap: 22px;
      align-items: center;
      color: #d7dce5;
      font-size: 18px;
    }
    .time-row span {
      display: inline-flex;
      gap: 9px;
      align-items: center;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-top: 12px;
    }
    .stat-tile,
    .encounter-card,
    .player-card,
    .notes {
      background: linear-gradient(180deg, rgba(20, 27, 35, 0.96), rgba(11, 16, 22, 0.96));
      border: 1px solid #323d49;
      border-radius: 8px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }
    .stat-tile {
      min-height: 79px;
      display: flex;
      gap: 14px;
      align-items: center;
      padding: 14px 16px;
    }
    .stat-icon { width: 34px; font-size: 31px; text-align: center; }
    .stat-tile span:last-child,
    .mini-stat span,
    .pull-durations {
      color: #cbd2dc;
      font-size: 16px;
    }
    .stat-tile strong {
      display: block;
      margin-top: 2px;
      font-size: 27px;
      line-height: 1;
    }
    .divider {
      height: 1px;
      margin: 12px 0 10px;
      background: #2b3540;
    }
    .section-heading {
      display: flex;
      gap: 10px;
      align-items: center;
      margin: 9px 0 8px;
      font-size: 25px;
      font-weight: 800;
    }
    .section-heading span { color: #b77cff; }
    .encounters {
      display: grid;
      grid-template-columns: 1fr 1.1fr;
      gap: 16px;
    }
    .encounter-card {
      padding: 13px 17px 11px;
      min-height: 275px;
    }
    .encounter-card.good { border-color: rgba(101, 208, 102, 0.5); }
    .encounter-card.bad { border-color: rgba(255, 74, 69, 0.72); }
    .encounter-title {
      display: flex;
      gap: 14px;
      align-items: center;
      margin-bottom: 12px;
    }
    .encounter-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 34px;
      font-weight: 900;
      color: #0a1118;
      background: #6ee06b;
    }
    .bad .encounter-icon {
      border-radius: 9px;
      background: #ff4b47;
    }
    .encounter-title h3 {
      margin: 0;
      font-size: 20px;
      color: #76df72;
    }
    .bad .encounter-title h3 { color: #ff5751; }
    .encounter-title p {
      margin: 3px 0 0;
      font-size: 18px;
      font-weight: 700;
    }
    .encounter-stats {
      display: grid;
      grid-template-columns: 1fr 1.2fr 1fr;
      gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #2c3540;
    }
    .mini-stat {
      min-height: 58px;
      display: grid;
      place-items: center;
      border: 1px solid #303b47;
      border-radius: 5px;
      background: rgba(18, 23, 30, 0.85);
    }
    .mini-stat strong {
      font-size: 24px;
      line-height: 1;
    }
    .pull-durations {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      padding: 11px 8px;
      border-bottom: 1px solid #2c3540;
      text-align: center;
    }
    .pull-durations strong {
      margin-left: 18px;
      color: #f5f7fb;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
      margin-top: 9px;
    }
    .bad .metric-grid { grid-template-columns: 1fr; }
    h4 {
      margin: 0 0 8px;
      color: #75df70;
      font-size: 18px;
    }
    .bad h4 { color: #ff5751; }
    .metric-line {
      display: grid;
      grid-template-columns: 49px 1fr;
      gap: 7px;
      margin: 7px 0;
      font-size: 17px;
    }
    .metric-label { color: #f4f6fb; }
    .metric-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .players {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
    }
    .player-card {
      min-height: 118px;
      padding: 10px 16px 9px;
    }
    .player-card h3 {
      display: flex;
      gap: 9px;
      align-items: center;
      margin: 0 0 7px;
      color: #d09bff;
      font-size: 17px;
    }
    .player-row {
      display: grid;
      grid-template-columns: 24px 1fr 72px;
      gap: 6px;
      align-items: center;
      min-height: 22px;
      font-size: 17px;
    }
    .player-row strong { text-align: right; }
    .unavailable { color: #8994a3; }
    .notes {
      display: grid;
      gap: 3px;
      margin-top: 11px;
      padding: 9px 14px;
      color: #b9c2cf;
      font-size: 13px;
    }
    .good { color: #72df6f; }
    .bad { color: #ff5751; }
    .warn, .gold-text { color: #ffc84d; }
    .blue-text { color: #52aaff; }
    .purple-text { color: #b676ff; }
    .muted { color: #9ca7b5; }
  </style>
</head>
<body>
  <main id="report-card">
    <header class="header">
      <div class="raid-art">⚜</div>
      <div>
        <h1>${escapeHtml(reportTitle(summary))}</h1>
        <div class="time-row">
          <span>▣ Date: ${escapeHtml(formatDate(summary.dateISO))}</span>
          <span>◷ Start: ${escapeHtml(formatTime(summary.startTimeISO))}</span>
          <span>◴ End: ${escapeHtml(formatTime(summary.endTimeISO))}</span>
        </div>
        <div class="stats">
          ${renderStatTile('⏱', 'Duration', formatDuration(summary.durationMs), 'purple-text')}
          ${renderStatTile('⚔', 'Boss Pulls', integerFormatter.format(summary.bossPulls), 'blue-text')}
          ${renderStatTile('☠', 'Total Kills', integerFormatter.format(summary.totalKills), 'good')}
          ${renderStatTile('☠', 'Total Wipes', integerFormatter.format(summary.totalWipes), 'bad')}
          ${renderStatTile(
            '☠',
            'Total Deaths',
            typeof summary.totalDeaths === 'number'
              ? integerFormatter.format(summary.totalDeaths)
              : 'n/a',
            'warn',
          )}
        </div>
      </div>
    </header>
    <div class="divider"></div>
    <div class="section-heading"><span>⚔</span>Encounter Highlights</div>
    <div class="encounters">
      ${renderEncounterCard('Best Execution', summary.bestExecutionEncounter, 'good')}
      ${renderEncounterCard('Biggest Trouble', summary.biggestTroubleEncounter, 'bad')}
    </div>
    <div class="section-heading"><span>●●</span>Top Players</div>
    <div class="players">
      ${renderPlayerCard(
        '▥',
        'Highest Avg Parse',
        summary.topPlayers.highestAverageParse,
        (value) => decimalFormatter.format(value),
      )}
      ${renderPlayerCard('⚔', 'Highest Total DPS', summary.topPlayers.highestTotalDps, formatRate)}
      ${renderPlayerCard('✚', 'Highest HPS', summary.topPlayers.highestHps, formatRate)}
      ${renderPlayerCard('☠', 'Most Deaths', summary.topPlayers.mostDeaths, (value) =>
        integerFormatter.format(value),
      )}
      ${renderPlayerCard('✊', 'Most Interrupts', summary.topPlayers.mostInterrupts, (value) =>
        integerFormatter.format(value),
      )}
      ${renderPlayerCard('♦', 'Most Dispels', summary.topPlayers.mostDispels, (value) =>
        integerFormatter.format(value),
      )}
    </div>
    ${renderNotes(summary)}
  </main>
</body>
</html>
`;

const getBrowser = async (): Promise<Browser> => {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const browser = await browserPromise;
    browser.on('disconnected', () => {
      browserPromise = null;
    });
  }
  return browserPromise;
};

export const closeReportRendererBrowser = async (): Promise<void> => {
  const browser = await browserPromise;
  browserPromise = null;
  await browser?.close();
};

export const renderReportSummaryPng = async (summary: ReportSummary): Promise<Uint8Array> => {
  const browser = await getBrowser();
  const page = await browser.newPage({
    viewport: { width: REPORT_CARD_WIDTH, height: REPORT_CARD_MIN_HEIGHT },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(buildReportCardHtml(summary), { waitUntil: 'load' });
    return await page.locator('#report-card').screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
};

export const buildReportResponseBody = async (
  summary: ReportSummary,
  options: { ephemeral?: boolean } = {},
): Promise<DiscordMessageBody> => {
  const ephemeral = options.ephemeral ?? true;
  const image = await renderReportSummaryPng(summary);
  return {
    content: summary.reportLink,
    ...(ephemeral ? { flags: EPHEMERAL_MESSAGE_FLAG } : {}),
    files: [
      {
        name: REPORT_CARD_FILENAME,
        attachment: image,
        contentType: 'image/png',
      },
    ],
  };
};
