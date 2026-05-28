import type {
  ReportEncounterSummary,
  ReportMetricRow,
  ReportParseRow,
  ReportSummary,
} from '@wcl/domain';
import type { DiscordMessageBody } from '../infrastructure/discord-api.js';
import { buildBattleRezComponentsV2 } from './report-v2.js';
import { makeAutoReportPromptPreviewCustomId } from '../commands/auto-report.js';
import { makeReportEncounterCustomId } from '../commands/report-encounter-custom-id.js';

export const SUPPRESS_EMBEDS_MESSAGE_FLAG = 1 << 2;
export const EPHEMERAL_MESSAGE_FLAG = 1 << 6;
export const IS_COMPONENTS_V2_MESSAGE_FLAG = 1 << 15;
const SAFE_ALLOWED_MENTIONS = { parse: [] as string[] };
const REPORT_DATA_NOTE =
  'Parsing complex raw data structures from an overpowered database is not the same as parsing against an overpowered raid boss. The numbers reported here are expected to drift by ~0.55% up to ~1.5% due to rounding, and calculation methods of DPS/HPS totals, and parses/ranks only known to WCL';

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

const chunk = <T>(rows: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
};

const present = (value: string | undefined): value is string => Boolean(value);

export const buildReportMessageFlags = (options: { ephemeral?: boolean }): number =>
  SUPPRESS_EMBEDS_MESSAGE_FLAG | (options.ephemeral ? EPHEMERAL_MESSAGE_FLAG : 0);

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
  return `Report Summary - ${summary.reportTitle}${
    difficultyAndSize ? ` (${difficultyAndSize})` : ''
  }`;
};

const renderNotes = (summary: ReportSummary): string => {
  const notes = summary.partialDataNotes.join(REPORT_DATA_NOTE);
  return `### *NOTE: ${notes}*`;
};

const textDisplay = (content: string) => ({
  type: 10 as const,
  content,
});

const separator = (spacing: 1 | 2 = 1) => ({
  type: 14 as const,
  divider: true,
  spacing,
});

const formatDeaths = (value: number | undefined): string =>
  typeof value === 'number' ? integerFormatter.format(value) : 'n/a';

const formatParseMarkdown = (row: ReportParseRow | undefined): string =>
  row ? `${row.playerName}: ${decimalFormatter.format(row.value)}` : 'unavailable';

const formatMetricMarkdown = (
  row: ReportMetricRow | undefined,
  formatter: (value: number) => string,
): string => (row ? `${row.playerName}: ${formatter(row.value)}` : 'unavailable');

const renderTopRowsMarkdown = (
  rows: readonly ReportMetricRow[],
  formatter: (value: number) => string,
): string => {
  const rendered = rows
    .slice(0, 3)
    .map((row, index) => `${index + 1}. ${row.playerName}: ${formatter(row.value)}`);

  return rendered.length > 0 ? rendered.join('\n') : 'unavailable';
};

const renderReportHeaderText = (summary: ReportSummary): string =>
  [
    `# ${reportTitle(summary)}`,
    summary.reportOwnerName ? `**Uploaded by:** ${summary.reportOwnerName}` : '',
    summary.reportLink,
  ]
    .filter(Boolean)
    .join('\n');

const renderRaidStatsText = (summary: ReportSummary): string =>
  [
    '## 📜 Raid Summary',
    `📆 **Date:** ${formatDate(summary.dateISO)}`,
    `🕛 **Start:** ${formatTime(summary.startTimeISO)}`,
    `🕒 **End:** ${formatTime(summary.endTimeISO)}`,
    '',
    `⌛ **Duration:** ${formatDuration(summary.durationMs)}`,
    `👹 **Boss Kills:** ${integerFormatter.format(summary.totalKills)}`,
    `🧻 **Wipes:** ${integerFormatter.format(summary.totalWipes)}`,
    `☠️ **Deaths:** ${formatDeaths(summary.totalDeaths)}`,
  ].join('\n');

const renderEncounterHighlightText = (
  title: string,
  encounter: ReportEncounterSummary | undefined,
): string => {
  if (!encounter) {
    return `### ${title}\n unavailable`;
  }

  const difficulty = encounter.difficultyName ? `(${encounter.difficultyName})` : '';

  return [
    `### ${title}`,
    `**${encounter.bossName}${difficulty}**`,
    `Pulls: ${integerFormatter.format(encounter.pulls)}`,
    `Kill/Wipes: ${integerFormatter.format(encounter.kills)}/${integerFormatter.format(
      encounter.wipes,
    )}`,
    `Deaths: ${formatDeaths(encounter.deaths)}`,
    encounter.longestPullMs ? `Longest Pull: ${formatPullDuration(encounter.longestPullMs)}` : '',
    encounter.shortestPullMs
      ? `Shortest Pull: ${formatPullDuration(encounter.shortestPullMs)}`
      : '',
    '',
    `DPS Parse: ${formatParseMarkdown(encounter.highestParseDps)}`,
    `HPS Parse: ${formatParseMarkdown(encounter.highestParseHps)}`,
    `Top DPS: ${formatMetricMarkdown(encounter.highestTotalDps, formatRate)}`,
    `Top HPS: ${formatMetricMarkdown(encounter.highestHps, formatRate)}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const renderTopPlayersText = (summary: ReportSummary): string =>
  [
    '## 🤺 Top Players',
    '',
    '** 🏅 Highest Avg Parse**',
    renderTopRowsMarkdown(summary.topPlayers.highestAverageParse, (value) =>
      decimalFormatter.format(value),
    ),
    '',
    '**⚔️ Highest Total DPS**',
    renderTopRowsMarkdown(summary.topPlayers.highestTotalDps, formatRate),
    '',
    '**🍃 Highest HPS**',
    renderTopRowsMarkdown(summary.topPlayers.highestHps, formatRate),
    '',
    '**☠️ Most Deaths**',
    renderTopRowsMarkdown(summary.topPlayers.mostDeaths, (value) => integerFormatter.format(value)),
    '',
    '**💤 Most Interrupts**',
    renderTopRowsMarkdown(summary.topPlayers.mostInterrupts, (value) =>
      integerFormatter.format(value),
    ),
    '',
    '** 🪄 Most Dispells**',
    renderTopRowsMarkdown(summary.topPlayers.mostDispels, (value) =>
      integerFormatter.format(value),
    ),
  ].join('\n');

type ReportEncounterWithId = ReportEncounterSummary & {
  encounterId: number;
};

type DiscordButtonComponent = {
  type: 2;
  style: 2;
  label: string;
  custom_id: string;
};

type DiscordActionRowComponent = {
  type: 1;
  components: DiscordButtonComponent[];
};

const hasEncounterId = (encounter: ReportEncounterSummary): encounter is ReportEncounterWithId => {
  const encounterId = encounter.encounterId;

  return (
    typeof encounterId === 'number' &&
    Number.isInteger(encounterId) &&
    (encounterId > 0 || encounterId === -1)
  );
};

const formatEncounterButtonLabel = (bossName: string): string =>
  bossName.length > 80 ? bossName.slice(0, 77).trimEnd() + '...' : bossName;

const buildEncounterButtonRows = (summary: ReportSummary): DiscordActionRowComponent[] =>
  chunk(summary.encounters.filter(hasEncounterId), 5).map((encounters) => ({
    type: 1,
    components: encounters.map((encounter) => ({
      type: 2,
      style: 2,
      label: formatEncounterButtonLabel(encounter.bossName),
      custom_id: makeReportEncounterCustomId({
        reportCode: summary.reportCode,
        encounterId: encounter.encounterId,
      }),
    })),
  }));

export const buildReportV2ResponseBody = async (
  summary: ReportSummary,
  options: { ephemeral?: boolean } = {},
): Promise<DiscordMessageBody> => {
  const ephemeral = options.ephemeral ?? false;

  const containerComponents = [
    textDisplay(renderReportHeaderText(summary)),
    separator(),
    textDisplay(renderRaidStatsText(summary)),
    separator(),
    textDisplay(
      [
        '## 🗿 Raid Highlights',
        '',
        renderEncounterHighlightText('Best Encounter', summary.bestExecutionEncounter),
        '',
        renderEncounterHighlightText('Worst Encounter', summary.biggestTroubleEncounter),
      ].join('\n'),
    ),
    separator(),
    textDisplay(renderTopPlayersText(summary)),
    separator(),
    textDisplay('## Encounter Breakdowns'),
    separator(),
    textDisplay(renderNotes(summary)),
    ...buildEncounterButtonRows(summary),
  ];

  return {
    flags: IS_COMPONENTS_V2_MESSAGE_FLAG | (ephemeral ? EPHEMERAL_MESSAGE_FLAG : 0),
    allowed_mentions: SAFE_ALLOWED_MENTIONS,
    components: [
      {
        type: 17,
        accent_color: 0x7d3cff,
        components: containerComponents,
      },
    ],
  };
};
