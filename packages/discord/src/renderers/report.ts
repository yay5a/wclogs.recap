import type {
  ReportEncounterSummary,
  ReportMetricRow,
  ReportParseRow,
  ReportSummary,
} from '@wcl/domain';
import type { DiscordMessageBody } from '../infrastructure/discord-api.js';
import { buildBattleRezComponentsV2 } from './report-v2.js';
import { makeReportEncounterCustomId } from '../commands/report-encounter-custom-id.js';

export const SUPPRESS_EMBEDS_MESSAGE_FLAG = 1 << 2;
export const EPHEMERAL_MESSAGE_FLAG = 1 << 6;
export const IS_COMPONENTS_V2_MESSAGE_FLAG = 1 << 15;
const SAFE_ALLOWED_MENTIONS = { parse: [] as string[] };
const REPORT_DATA_NOTE = `Parsing complex raw data structures from an overpowered database is not the same as parsing against an overpowered raid boss. The numbers reported here are expected to drift from the full log on warcraftlogs.com between ~0.55% and  ~1.5% due to calculation methods done by warcraftlogs for, DPS/HPS totals, parse/rank percentiles, and rounding.${'\n'} Trash pulls are not counted in these report summaries.`;
const REPORT_SUMMARY_TIME_ZONE = 'America/New_York';
const REPORT_SUMMARY_TIME_LABEL = 'Server';

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
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: REPORT_SUMMARY_TIME_ZONE,
});

const formatTime = (iso: string): string =>
  `${timeFormatter.format(new Date(iso))} ${REPORT_SUMMARY_TIME_LABEL}`;

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

const formatRate = (value: number): string => `${formatCompact(value)}/s`;

const normalizeTitle = (value: string): string => value.toLowerCase().replace(/[\s_-]+/g, '');

const titleHasDifficulty = (title: string, difficultyName: string | undefined): boolean => {
  if (!difficultyName) return false;
  const normalizedTitle = normalizeTitle(title);
  const normalizedDifficulty = normalizeTitle(difficultyName);

  return normalizedTitle.includes(normalizedDifficulty);
};

const titleHasSize = (title: string, sizeLabel: string | undefined): boolean => {
  if (!sizeLabel) return false;

  const normalizedTitle = normalizeTitle(title);
  const normalizedSize = normalizeTitle(sizeLabel);

  const sizeNumber = sizeLabel.match(/\d+/)?.[0];
  const sizeVariants = [
    normalizedSize,
    sizeNumber ? `${sizeNumber}m` : '',
    sizeNumber ? `${sizeNumber}man` : '',
    sizeNumber ? `${sizeNumber}player` : '',
  ].filter(Boolean);

  return sizeVariants.some((variant) => normalizedTitle.includes(variant));
};

const reportTitle = (summary: ReportSummary): string => {
  const details = [
    titleHasDifficulty(summary.reportTitle, summary.difficultyName)
      ? undefined
      : summary.difficultyName,
    titleHasSize(summary.reportTitle, summary.sizeLabel) ? undefined : summary.sizeLabel,
  ].filter(present);
  return `${summary.reportTitle}${details ? ` (${details.join(' ')})` : ''}`;
};

const renderReportNoteText = (summary: ReportSummary): string => {
  const notes = [
    REPORT_DATA_NOTE,
    ...summary.partialDataNotes.slice(0, 2).map((note) => `Note: ${note}`),
  ].filter((note) => note.trim().length > 0);

  return ['**_NOTE:_**', ...notes].join('\n');
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

const renderRankedRows = <Row>(
  rows: readonly Row[] | undefined,
  renderValue: (row: Row) => string,
  empty: string | undefined,
): string | undefined => {
  if (!rows?.length) return empty;
  return rows
    .slice(0, 3)
    .map((row, index) => `${index + 1}. ${renderValue(row)}`)
    .join('\n');
};

const renderTopRowsMarkdown = (
  rows: readonly ReportMetricRow[],
  formatter: (value: number) => string,
): string =>
  renderRankedRows(rows, (row) => `${row.playerName}: ${formatter(row.value)}`, 'unavailable') ??
  'unavailable';

const renderOptionalMetricRowsMarkdown = (
  rows: readonly ReportMetricRow[] | undefined,
  formatter: (value: number) => string,
): string | undefined =>
  renderRankedRows(rows, (row) => `${row.playerName}: ${formatter(row.value)}`, undefined);

const renderOptionalParseRowsMarkdown = (
  rows: readonly ReportParseRow[] | undefined,
): string | undefined =>
  renderRankedRows(
    rows,
    (row) => `${row.playerName}: ${decimalFormatter.format(row.value)}`,
    undefined,
  );

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
    `Healer Parse: ${formatParseMarkdown(encounter.highestParseHps)}`,
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
    '** 🏅 Highest Avg Parses**',
    renderTopRowsMarkdown(summary.topPlayers.highestAverageParse, (value) =>
      decimalFormatter.format(value),
    ),
    '',
    '**⚔️ Highest Total DPS**',
    renderTopRowsMarkdown(summary.topPlayers.highestTotalDps, formatRate),
    '',
    '**🍃 Highest Total HPS**',
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
    Number.isSafeInteger(encounterId) &&
    (encounterId > 0 || encounterId === -1)
  );
};
const encounterButtonKey = (summary: ReportSummary, encounter: ReportEncounterWithId): string =>
  [encounter.bossName, encounter.difficultyName ?? summary.difficultyName ?? ''].join(':');

const encounterButtonScore = (encounter: ReportEncounterWithId): number =>
  [
    encounter.difficultyName ? 1_000_000 : 0,
    encounter.highestTotalDps ? 1_000_000 : 0,
    encounter.highestHps ? 1_000_000 : 0,
    encounter.highestParseDps ? 1_000_000 : 0,
    encounter.highestParseHps ? 1_000_000 : 0,
    encounter.kills * 10_000,
    encounter.wipes * 1000,
    encounter.totalDurationMs ?? 0,
  ].reduce((total, value) => total + value, 0);

export const getReportEncounterButtonEncounters = (
  summary: ReportSummary,
): ReportEncounterWithId[] => {
  const selected = new Map<string, ReportEncounterWithId>();

  for (const encounter of summary.encounters.filter(hasEncounterId)) {
    const key = encounterButtonKey(summary, encounter);
    const current = selected.get(key);

    if (!current || encounterButtonScore(encounter) > encounterButtonScore(current)) {
      selected.set(key, encounter);
    }
  }

  return [...selected.values()];
};

const formatEncounterButtonLabel = (bossName: string): string =>
  bossName.length > 80 ? bossName.slice(0, 77).trimEnd() + '...' : bossName;

const buildEncounterButtonRows = (summary: ReportSummary): DiscordActionRowComponent[] =>
  chunk(getReportEncounterButtonEncounters(summary), 5).map((encounters) => ({
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

const renderEncounterBreakdownStatsText = (
  summary: ReportSummary,
  encounter: ReportEncounterSummary,
): string => {
  const difficulty = encounter.difficultyName ?? summary.difficultyName;
  return [
    `# ${encounter.bossName}`,
    difficulty ? `**Difficulty:** ${difficulty}` : '',
    `**Report:** ${summary.reportTitle}`,
    '',
    `**Pulls:** ${integerFormatter.format(encounter.pulls)}`,
    `**Kills/Wipes:** ${integerFormatter.format(encounter.kills)}/${integerFormatter.format(
      encounter.wipes,
    )}`,
    `**Deaths:** ${formatDeaths(encounter.deaths)}`,
    typeof encounter.longestPullMs === 'number'
      ? `**Longest Pull:** ${formatPullDuration(encounter.longestPullMs)}`
      : '',
    typeof encounter.shortestPullMs === 'number'
      ? `**Shortest Pull:** ${formatPullDuration(encounter.shortestPullMs)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const renderEncounterBestText = (encounter: ReportEncounterSummary): string =>
  [
    '## Top Players',
    `**DPS Parse:** ${formatParseMarkdown(encounter.highestParseDps)}`,
    `**Healer Parse:** ${formatParseMarkdown(encounter.highestParseHps)}`,
    `**Top DPS:** ${formatMetricMarkdown(encounter.highestTotalDps, formatRate)}`,
    `**Top HPS:** ${formatMetricMarkdown(encounter.highestHps, formatRate)}`,
  ].join('\n');

const encounterRowsSection = (
  title: string,
  rows: string | undefined,
): ReturnType<typeof textDisplay>[] => (rows ? [textDisplay(`## ${title}\n${rows}`)] : []);

export const buildEncounterBreakdownResponseBody = ({
  encounter,
  summary,
}: {
  summary: ReportSummary;
  encounter: ReportEncounterSummary;
}): DiscordMessageBody => {
  const utilityComponents = [
    ...encounterRowsSection(
      'Top DPS Parses',
      renderOptionalParseRowsMarkdown(encounter.topParseDps),
    ),
    ...encounterRowsSection(
      'Top Healer Parses',
      renderOptionalParseRowsMarkdown(encounter.topParseHps),
    ),
    ...encounterRowsSection(
      'Most Deaths',
      renderOptionalMetricRowsMarkdown(encounter.mostDeaths, (value) =>
        integerFormatter.format(value),
      ),
    ),
    ...encounterRowsSection(
      'Most Interrupts',
      renderOptionalMetricRowsMarkdown(encounter.mostInterrupts, (value) =>
        integerFormatter.format(value),
      ),
    ),
    ...encounterRowsSection(
      'Most Dispels',
      renderOptionalMetricRowsMarkdown(encounter.mostDispels, (value) =>
        integerFormatter.format(value),
      ),
    ),
    ...encounterRowsSection(
      'Healthstones Used',
      renderOptionalMetricRowsMarkdown(encounter.mostHealthstonesConsumed, (value) =>
        integerFormatter.format(value),
      ),
    ),
  ];

  return {
    flags: EPHEMERAL_MESSAGE_FLAG | IS_COMPONENTS_V2_MESSAGE_FLAG,
    allowed_mentions: SAFE_ALLOWED_MENTIONS,
    components: [
      {
        type: 17,
        accent_color: 0x7d3cff,
        components: [
          textDisplay(renderEncounterBreakdownStatsText(summary, encounter)),
          separator(),
          textDisplay(renderEncounterBestText(encounter)),
          ...(utilityComponents.length > 0 ? [separator(), ...utilityComponents] : []),
        ],
      },
    ],
  };
};

export const buildReportV2ResponseBody = async (
  summary: ReportSummary,
  options: { ephemeral?: boolean } = {},
): Promise<DiscordMessageBody> => {
  const ephemeral = options.ephemeral ?? false;

  const brezComponents = summary.battleRez ? buildBattleRezComponentsV2(summary.battleRez) : [];

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
    ...buildEncounterButtonRows(summary),
    separator(),
    textDisplay(renderReportNoteText(summary)),
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
      ...brezComponents,
    ],
  };
};
