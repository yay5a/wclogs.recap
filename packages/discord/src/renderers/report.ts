import type {
  ReportEncounterSummary,
  ReportMetricRow,
  ReportParseRow,
  ReportSummary,
} from '@wcl/domain';

const EPHEMERAL_MESSAGE_FLAG = 64;
const DISCORD_FIELD_VALUE_LIMIT = 1024;

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
  month: 'numeric',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

const truncateFieldValue = (value: string): string =>
  value.length <= DISCORD_FIELD_VALUE_LIMIT
    ? value
    : `${value.slice(0, DISCORD_FIELD_VALUE_LIMIT - 1)}…`;

const present = (value: string | undefined): value is string => Boolean(value);

const unavailable = (label: string): string => `${label}: unavailable`;

const formatDuration = (durationMs: number): string => {
  const totalMinutes = Math.max(0, Math.floor(durationMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const formatPullDuration = (durationMs?: number): string | undefined => {
  if (typeof durationMs !== 'number') return undefined;
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatDate = (iso: string): string => dateFormatter.format(new Date(iso));

const formatTime = (iso: string): string => timeFormatter.format(new Date(iso));

const formatRate = (value: number): string => `${compactNumberFormatter.format(value)}/s`;

const formatRankedRows = (
  rows: readonly ReportMetricRow[],
  formatter: (value: number) => string,
): string | undefined => {
  const lines = rows.slice(0, 3).map((row, index) => {
    const classSpec = [row.specName, row.className].filter(present).join(' ');
    return `${index + 1}. ${row.playerName} - ${formatter(row.value)}${
      classSpec ? ` (${classSpec})` : ''
    }`;
  });
  return lines.length > 0 ? lines.join('\n') : undefined;
};

const formatRankedRowsOrUnavailable = (
  rows: readonly ReportMetricRow[],
  formatter: (value: number) => string,
): string => formatRankedRows(rows, formatter) ?? 'unavailable';

const formatParseRow = (row?: ReportParseRow): string | undefined =>
  row ? `${row.playerName} - ${decimalFormatter.format(row.value)}` : undefined;

const formatEncounterRateLine = (label: string, row: ReportMetricRow | undefined): string =>
  row ? `${label}: ${row.playerName} - ${formatRate(row.value)}` : unavailable(label);

const formatEncounterParseLine = (label: string, row: ReportParseRow | undefined): string =>
  `${label}: ${formatParseRow(row) ?? 'unavailable'}`;

const formatEncounter = (
  encounter: ReportEncounterSummary | undefined,
  options: {
    includeHighestParse?: boolean;
    includePullDurations?: boolean;
    highestParses?: { dps?: ReportParseRow; hps?: ReportParseRow; dtps?: ReportParseRow };
  } = {},
): string => {
  if (!encounter) return 'unavailable';
  const heading = `**${encounter.bossName}${
    encounter.difficultyName ? ` (${encounter.difficultyName})` : ''
  }**`;
  const longestPull = formatPullDuration(encounter.longestPullMs);
  const shortestPull = formatPullDuration(encounter.shortestPullMs);
  const highestParses = options.highestParses ?? {};
  return [
    heading,
    `Pulls: ${encounter.pulls}`,
    `Kill/Wipes: ${encounter.kills}/${encounter.wipes}`,
    typeof encounter.deaths === 'number'
      ? `Deaths: ${integerFormatter.format(encounter.deaths)}`
      : unavailable('Deaths'),
    ...(options.includeHighestParse
      ? [
          'Highest Parse:',
          `  ${formatEncounterParseLine('DPS', encounter.highestParseDps ?? highestParses.dps)}`,
          `  ${formatEncounterParseLine('HPS', encounter.highestParseHps ?? highestParses.hps)}`,
          `  ${formatEncounterParseLine('DTPS', highestParses.dtps)}`,
        ]
      : []),
    ...(options.includePullDurations
      ? [
          longestPull ? `Longest Pull: ${longestPull}` : unavailable('Longest Pull'),
          shortestPull ? `Shortest Pull: ${shortestPull}` : unavailable('Shortest Pull'),
        ]
      : []),
    formatEncounterRateLine('Highest Total DPS', encounter.highestTotalDps),
    formatEncounterRateLine('Highest Total HPS', encounter.highestHps),
    formatEncounterRateLine('Highest Total DTPS', encounter.highestDamageTakenRate),
  ].join('\n');
};

const pushField = (
  fields: Array<{ name: string; value: string; inline?: boolean }>,
  name: string,
  value: string | undefined,
  inline?: boolean,
): void => {
  if (!value || value.trim().length === 0) return;
  fields.push({
    name,
    value: truncateFieldValue(value),
    ...(typeof inline === 'boolean' ? { inline } : {}),
  });
};

export const buildReportResponseBody = (
  summary: ReportSummary,
  options: { ephemeral?: boolean } = {},
) => {
  const ephemeral = options.ephemeral ?? true;
  const difficultyAndSize = [summary.difficultyName, summary.sizeLabel].filter(present).join(', ');
  const title = `Report Summary - ${summary.raidName ?? summary.reportTitle}${
    difficultyAndSize ? ` (${difficultyAndSize})` : ''
  }`;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  pushField(
    fields,
    'Report Details',
    [
      `Date: ${formatDate(summary.dateISO)}`,
      `Start Time: ${formatTime(summary.startTimeISO)}`,
      `End Time: ${formatTime(summary.endTimeISO)}`,
    ].join('\n'),
  );
  pushField(fields, 'Duration', formatDuration(summary.durationMs), true);
  pushField(fields, 'Boss Pulls', integerFormatter.format(summary.bossPulls), true);
  pushField(fields, 'Total Kills', integerFormatter.format(summary.totalKills), true);
  pushField(fields, 'Total Wipes', integerFormatter.format(summary.totalWipes), true);
  pushField(
    fields,
    'Total Deaths',
    typeof summary.totalDeaths === 'number'
      ? integerFormatter.format(summary.totalDeaths)
      : 'unavailable',
    true,
  );
  pushField(
    fields,
    '====================================================',
    '🗿 Encounter Highlights',
  );
  pushField(
    fields,
    'Best Execution ⚔️',
    formatEncounter(summary.bestExecutionEncounter, {
      includeHighestParse: true,
      highestParses: {
        ...(summary.highestParses.dps ? { dps: summary.highestParses.dps } : {}),
        ...(summary.highestParses.hps ? { hps: summary.highestParses.hps } : {}),
        ...(summary.highestParses.dtps ? { dtps: summary.highestParses.dtps } : {}),
      },
    }),
    true,
  );
  pushField(
    fields,
    'Biggest Trouble 👨‍🦼',
    formatEncounter(summary.biggestTroubleEncounter, {
      includePullDurations: true,
    }),
    true,
  );

  pushField(fields, '====================================================', '🏋️‍♂️ Top Players');
  pushField(
    fields,
    'Highest Avg Parse',
    formatRankedRowsOrUnavailable(summary.topPlayers.highestAverageParse, (value) =>
      decimalFormatter.format(value),
    ),
    true,
  );
  pushField(
    fields,
    'Highest Total DPS',
    formatRankedRowsOrUnavailable(summary.topPlayers.highestTotalDps, formatRate),
    true,
  );
  pushField(
    fields,
    'Highest HPS',
    formatRankedRowsOrUnavailable(summary.topPlayers.highestHps, formatRate),
    true,
  );
  pushField(
    fields,
    'Highest DTPS',
    formatRankedRowsOrUnavailable(summary.topPlayers.highestDamageTakenRate, formatRate),
    true,
  );
  pushField(
    fields,
    'Most Deaths',
    formatRankedRowsOrUnavailable(
      summary.topPlayers.mostDeaths,
      (value) => `${integerFormatter.format(value)} deaths`,
    ),
    true,
  );
  pushField(
    fields,
    'Most Interrupts',
    formatRankedRowsOrUnavailable(
      summary.topPlayers.mostInterrupts,
      (value) => `${integerFormatter.format(value)} interrupts`,
    ),
    true,
  );
  pushField(
    fields,
    'Most Dispels',
    formatRankedRowsOrUnavailable(
      summary.topPlayers.mostDispels,
      (value) => `${integerFormatter.format(value)} dispels`,
    ),
    true,
  );
  pushField(
    fields,
    'Data & Source',
    [
      summary.reportLink,
      'Encounter highlight deaths/totals are shown only when encounter-specific data is available.',
      ...summary.partialDataNotes.map((note) => `Note: ${note}`),
    ].join('\n'),
  );

  return {
    ...(ephemeral ? { flags: EPHEMERAL_MESSAGE_FLAG } : {}),
    embeds: [
      {
        title,
        description: summary.reportTitle,
        color: 0x5b8def,
        fields,
      },
    ],
  };
};
