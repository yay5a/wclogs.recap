import type { GuildRankSummary } from '@wcl/domain';

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const SECTION_SEPARATOR = '='.repeat(32);
const CACHED_TREND_NOTE = 'Speed and execution are read from cached WCL ranking trends.';

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
        best: 'Best WCL Percentile',
        single: 'WCL Percentile',
      }
    : {
        best: 'Best Percentile',
        single: 'Percentile',
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

const formatRanks = (ranks: { world?: number; region?: number; realm?: number }): string =>
  [
    `\nWorld 🌍 ${typeof ranks.world === 'number' ? `#${ranks.world} \n` : 'unavailable'}`,
    `Region 🗾 ${typeof ranks.region === 'number' ? `#${ranks.region} \n` : 'unavailable'}`,
    `Realm 🪐 ${typeof ranks.realm === 'number' ? `#${ranks.realm} \n` : 'unavailable'}`,
  ].join(' / ');

const formatSection = (title: string, lines: string[]): string =>
  [`**${title}**`, '', ...lines].join('\n');

const sectionField = (title: string, lines: string[]) => ({
  name: SECTION_SEPARATOR,
  value: formatSection(title, lines),
});

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

  fields.push(
    sectionField('Progress', [
      `Cleared: ${summary.progress.clearedEncounters}/${summary.progress.totalEncounters}`,
      `World: ${typeof summary.progress.ranks.world === 'number' ? `#${summary.progress.ranks.world}` : 'unavailable'}`,
      `Region: ${typeof summary.progress.ranks.region === 'number' ? `#${summary.progress.ranks.region}` : 'unavailable'}`,
      `Realm: ${typeof summary.progress.ranks.realm === 'number' ? `#${summary.progress.ranks.realm}` : 'unavailable'}`,
    ]),
  );

  fields.push(
    sectionField('Guild Rankings', [
      summary.metricSource === 'trend_cache'
        ? `Ranking samples: ${integerFormatter.format(summary.progress.pulls)}`
        : `Pulls/Wipes: ${integerFormatter.format(summary.progress.pulls)}/${integerFormatter.format(summary.progress.wipes)}`,
    ]),
  );

  fields.push(
    sectionField('Speed', [
      `Source: ${summary.speed.sourceLabel}`,
      ...(summary.speed.ranks ? [`All-Star Ranks: ${formatRanks(summary.speed.ranks)}`] : []),
      ...(summary.speed.completeRaidRanks
        ? [`Complete Raid Ranks: ${formatRanks(summary.speed.completeRaidRanks)}`]
        : []),
      formatMetric(
        labels,
        summary.speed.overall.bestDerivedPercentile,
        summary.speed.overall.bestDerivedPercentileDelta,
      ),
      summary.speed.bestEncounterGain
        ? `Best Encounter Gain: ${summary.speed.bestEncounterGain.encounterName} ${formatDelta(summary.speed.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
    ]),
  );

  fields.push(
    sectionField('Speed - Per Encounter', [
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
      summary.execution.bestEncounterGain
        ? `Best Encounter Gain: ${summary.execution.bestEncounterGain.encounterName} ${formatDelta(summary.execution.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
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
          "Weekly values may summarize multiple reports; verify source values in each report's Rankings table for the same encounter/difficulty/size.",
          ...summary.notes
            .filter((note) => note !== CACHED_TREND_NOTE)
            .map((note) => `Note: ${note}`),
        ]
      : [
          `Current: ${summary.window.currentStartIso} -> ${summary.window.currentEndIso}`,
          `Baseline: ${summary.window.baselineStartIso} -> ${summary.window.baselineEndIso}`,
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
