import type { GuildRankSummary } from '@wcl/domain';

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const SECTION_SEPARATOR = '='.repeat(32);
const CACHED_TREND_NOTE = `Speed and Execution Rank Percentiles are read from the guild's cached reports.`;

const formatDelta = (value?: number): string =>
  typeof value === 'number' ? `${value >= 0 ? '+' : ''}${decimalFormatter.format(value)}` : 'n/a';

const formatPreviousAndDelta = (current?: number, delta?: number): string => {
  if (typeof current === 'number' && typeof delta === 'number') {
    const previousLabel = delta < 0 ? 'prev best' : 'prev';
    return `${previousLabel} ${decimalFormatter.format(current - delta)}, ${formatDelta(delta)}`;
  }
  return `prev n/a, ${formatDelta(delta)}`;
};

const metricLabels = (summary: GuildRankSummary): { best: string; single: string } =>
  summary.metricSource === 'trend_cache'
    ? {
        best: 'Best Rank Percentile',
        single: 'Rank Percentile',
      }
    : {
        best: 'Best Rank',
        single: 'Rank',
      };

const formatMetricLines = (
  labels: { best: string; single: string },
  best?: number,
  bestDerivedPercentileDelta?: number,
): string[] => {
  const label =
    typeof bestDerivedPercentileDelta === 'number' && bestDerivedPercentileDelta > 0
      ? labels.best
      : labels.single;
  return [
    `${label}: ${typeof best === 'number' ? decimalFormatter.format(best) : 'n/a'} (${formatPreviousAndDelta(best, bestDerivedPercentileDelta)})`,
  ];
};

const formatMetric = (
  labels: { best: string; single: string },
  best?: number,
  bestDerivedPercentileDelta?: number,
): string => formatMetricLines(labels, best, bestDerivedPercentileDelta).join('\n');

const formatRanks = (ranks: { world?: number; region?: number; realm?: number }): string => {
  const lines = [
    `World 🌍 ${typeof ranks.world === 'number' ? `#${ranks.world}` : 'unavailable'}`,
    `Region 🗾 ${typeof ranks.region === 'number' ? `#${ranks.region}` : 'unavailable'}`,
    `Realm 🪐 ${typeof ranks.realm === 'number' ? `#${ranks.realm}` : 'unavailable'}`,
  ];
  return `\n${lines.join('\n')}\n`;
};

const formatSection = (title: string, lines: string[]): string =>
  [`**${title}**`, '', ...lines].join('\n');

const sectionField = (title: string, lines: string[]) => ({
  name: SECTION_SEPARATOR,
  value: formatSection(title, lines),
});

type GuildRankEncounterMetric = GuildRankSummary['speed']['encounters'][number];
type GuildRankMetricName = 'speed' | 'execution';

const formatBestEncounterGain = (
  gain: { encounterName: string; delta: number } | undefined,
  encounters: GuildRankEncounterMetric[],
  metric: GuildRankMetricName,
): string => {
  if (!gain) return 'Best Encounter Gain: n/a';

  const percentile = encounters.find(
    (encounter) => encounter.encounterName === gain.encounterName,
  )?.[metric].bestDerivedPercentile;
  const percentileText =
    typeof percentile === 'number' ? ` ${decimalFormatter.format(percentile)}` : '';
  return `Best Encounter Gain: ${gain.encounterName}${percentileText} (${formatDelta(gain.delta)})`;
};

const formatEncounterRankings = (
  encounters: Array<{
    encounterName: string;
    speed: {
      bestDerivedPercentile?: number;
      bestDerivedPercentileDelta?: number;
      medianDerivedPercentile?: number;
      medianDerivedPercentileDelta?: number;
    };
    execution: {
      bestDerivedPercentile?: number;
      bestDerivedPercentileDelta?: number;
      medianDerivedPercentile?: number;
      medianDerivedPercentileDelta?: number;
    };
  }>,
  metric: 'speed' | 'execution',
  labels: { best: string; single: string },
): string => {
  const rows = encounters.slice(0, 6).map((encounter) => {
    const values = encounter[metric];
    return [
      `• ${encounter.encounterName}`,
      ...formatMetricLines(labels, values.bestDerivedPercentile, values.bestDerivedPercentileDelta),
    ].join('\n');
  });
  return rows.length > 0 ? rows.join('\n\n') : 'unavailable';
};

export const buildGuildRankResponseBody = (summary: GuildRankSummary) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  const labels = metricLabels(summary);
  const hasSpeedRanks = Boolean(summary.speed.ranks || summary.speed.completeRaidRanks);
  const rankExplanation =
    'All-Star Base Speed Rank & Complete Raid Speed Ranks are World, Region, and Server Rank Positions; Execution rank position fields are currently unavailable.';

  fields.push(
    sectionField('Progress Rank Positions', [
      `Cleared: ${summary.progress.clearedEncounters}/${summary.progress.totalEncounters}`,
      `World: ${typeof summary.progress.ranks.world === 'number' ? `#${summary.progress.ranks.world}` : 'unavailable'}`,
      `Region: ${typeof summary.progress.ranks.region === 'number' ? `#${summary.progress.ranks.region}` : 'unavailable'}`,
      `Realm: ${typeof summary.progress.ranks.realm === 'number' ? `#${summary.progress.ranks.realm}` : 'unavailable'}`,
    ]),
  );

  fields.push(
    sectionField('Guild Ranking Positions and Rank Percentiles', [
      summary.metricSource === 'trend_cache'
        ? `Rank sample pool: ${integerFormatter.format(summary.progress.pulls)}`
        : `Pulls/Wipes: ${integerFormatter.format(summary.progress.pulls)}/${integerFormatter.format(summary.progress.wipes)}`,
    ]),
  );

  fields.push(
    sectionField('Speed', [
      `Source: ${summary.speed.sourceLabel}`,
      ...(summary.speed.ranks
        ? [`All-Star Base Speed Rank Positions:${formatRanks(summary.speed.ranks)}`]
        : []),
      ...(summary.speed.completeRaidRanks
        ? [`Complete Raid Speed Rank Positions:${formatRanks(summary.speed.completeRaidRanks)}`]
        : []),
      formatMetric(
        labels,
        summary.speed.overall.bestDerivedPercentile,
        summary.speed.overall.bestDerivedPercentileDelta,
      ),
      formatBestEncounterGain(summary.speed.bestEncounterGain, summary.speed.encounters, 'speed'),
    ]),
  );

  fields.push(
    sectionField('Speed Rank Percentiles - Per Encounter', [
      formatEncounterRankings(summary.speed.encounters, 'speed', labels),
    ]),
  );

  fields.push(
    sectionField('Execution', [
      `Source: ${summary.execution.sourceLabel}`,
      formatMetric(
        labels,
        summary.execution.overall.bestDerivedPercentile,
        summary.execution.overall.bestDerivedPercentileDelta,
      ),
      formatBestEncounterGain(
        summary.execution.bestEncounterGain,
        summary.execution.encounters,
        'execution',
      ),
    ]),
  );

  fields.push(
    sectionField('Execution - Per Encounter', [
      formatEncounterRankings(summary.execution.encounters, 'execution', labels),
    ]),
  );

  const windowLines =
    summary.metricSource === 'trend_cache'
      ? [
          'Window: Current week = latest cached WCL ranking week. Baseline = previous cached ranking week.',
          `Current week: ${summary.window.currentStartIso} -> ${summary.window.currentEndIso}`,
          `Baseline week: ${summary.window.baselineStartIso} -> ${summary.window.baselineEndIso}`,
          'Speed/execution percentiles use cached WCL report rankings, not the guild profile page.',
          ...(hasSpeedRanks ? [rankExplanation] : []),
          "Weekly values may summarize multiple reports; verify source values in each report's Rankings table for the same encounter/difficulty/size.",
          ...summary.notes
            .filter((note) => note !== CACHED_TREND_NOTE)
            .map((note) => `Note: ${note}`),
        ]
      : [
          `Current: ${summary.window.currentStartIso} -> ${summary.window.currentEndIso}`,
          `Baseline: ${summary.window.baselineStartIso} -> ${summary.window.baselineEndIso}`,
          ...(hasSpeedRanks ? [`Note: ${rankExplanation}`] : []),
          ...summary.notes.map((note) => `Note: ${note}`),
        ];

  fields.push(
    sectionField(summary.metricSource === 'trend_cache' ? 'How to Read' : 'Window', windowLines),
  );

  return {
    embeds: [
      {
        title: `Guild Rank - ${summary.guildName}`,
        description: `${summary.zoneName} (${summary.difficultyLabel}, ${summary.sizeLabel})`,
        color: 0x2f7a47,
        fields,
      },
    ],
  };
};
