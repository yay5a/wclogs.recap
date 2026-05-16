import type { GuildRankSummary } from '@wcl/domain';

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const SECTION_SEPARATOR = '='.repeat(32);

const formatDelta = (value?: number): string =>
  typeof value === 'number' ? `${value >= 0 ? '+' : ''}${decimalFormatter.format(value)}` : 'n/a';

const formatPreviousAndDelta = (current?: number, delta?: number): string => {
  if (typeof current === 'number' && typeof delta === 'number') {
    return `prev ${decimalFormatter.format(current - delta)}, ${formatDelta(delta)}`;
  }
  return `prev n/a, ${formatDelta(delta)}`;
};

const metricLabels = (
  summary: GuildRankSummary,
): { best: string; median: string } =>
  summary.metricSource === 'trend_cache'
    ? { best: 'Best WCL Percentile', median: 'Median WCL Percentile' }
    : {
        best: 'Best Derived Relative Percentile',
        median: 'Median Derived Relative Percentile',
      };

const formatMetric = (
  labels: { best: string; median: string },
  best?: number,
  median?: number,
  bestDerivedPercentileDelta?: number,
  medianDerivedPercentileDelta?: number,
): string =>
  [
    `${labels.best}: ${typeof best === 'number' ? decimalFormatter.format(best) : 'n/a'} (${formatPreviousAndDelta(best, bestDerivedPercentileDelta)})`,
    `${labels.median}: ${typeof median === 'number' ? decimalFormatter.format(median) : 'n/a'} (${formatPreviousAndDelta(median, medianDerivedPercentileDelta)})`,
  ].join('\n');

const formatScoreLine = (label: string, value?: number, delta?: number): string =>
  `${label}: ${typeof value === 'number' ? decimalFormatter.format(value) : 'n/a'} (${formatPreviousAndDelta(value, delta)})`;

const formatRanks = (ranks: { world?: number; region?: number; realm?: number }): string =>
  [
    `\nWorld 🌍 ${typeof ranks.world === 'number' ? `#${ranks.world} \n` : 'unavailable'}`,
    `Region 🗾 ${typeof ranks.region === 'number' ? `#${ranks.region} \n` : 'unavailable'}`,
    `Realm 🪐 ${typeof ranks.realm === 'number' ? `#${ranks.realm} \n` : 'unavailable'}`,
  ].join(' / ');

const formatSection = (lines: string[]): string => [SECTION_SEPARATOR, '', ...lines].join('\n');

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
  labels: { best: string; median: string },
): string => {
  const rows = encounters.slice(0, 6).map((encounter) => {
    const values = encounter[metric];
    return [
      `• ${encounter.encounterName}`,
      `  ${formatScoreLine(labels.best, values.bestDerivedPercentile, values.bestDerivedPercentileDelta)}`,
      `  ${formatScoreLine(labels.median, values.medianDerivedPercentile, values.medianDerivedPercentileDelta)}`,
    ].join('\n');
  });
  return rows.length > 0
    ? [SECTION_SEPARATOR, '', rows.join('\n\n')].join('\n')
    : formatSection(['unavailable']);
};

export const buildGuildRankResponseBody = (summary: GuildRankSummary) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  const labels = metricLabels(summary);

  fields.push({
    name: 'Progress',
    value: formatSection([
      `Cleared: ${summary.progress.clearedEncounters}/${summary.progress.totalEncounters}`,
      `World: ${typeof summary.progress.ranks.world === 'number' ? `#${summary.progress.ranks.world}` : 'unavailable'}`,
      `Region: ${typeof summary.progress.ranks.region === 'number' ? `#${summary.progress.ranks.region}` : 'unavailable'}`,
      `Realm: ${typeof summary.progress.ranks.realm === 'number' ? `#${summary.progress.ranks.realm}` : 'unavailable'}`,
    ]),
  });

  fields.push({
    name: 'Guild Rankings',
    value: formatSection([
      summary.metricSource === 'trend_cache'
        ? `Ranking samples: ${integerFormatter.format(summary.progress.pulls)}`
        : `Pulls/Wipes: ${integerFormatter.format(summary.progress.pulls)}/${integerFormatter.format(summary.progress.wipes)}`,
    ]),
  });

  fields.push({
    name: 'Speed',
    value: formatSection([
      `Source: ${summary.speed.sourceLabel}`,
      ...(summary.speed.ranks ? [`All-Star Ranks: ${formatRanks(summary.speed.ranks)}`] : []),
      ...(summary.speed.completeRaidRanks
        ? [`Complete Raid Ranks: ${formatRanks(summary.speed.completeRaidRanks)}`]
        : []),
      formatMetric(
        labels,
        summary.speed.overall.bestDerivedPercentile,
        summary.speed.overall.medianDerivedPercentile,
        summary.speed.overall.bestDerivedPercentileDelta,
        summary.speed.overall.medianDerivedPercentileDelta,
      ),
      summary.speed.bestEncounterGain
        ? `Best Encounter Gain: ${summary.speed.bestEncounterGain.encounterName} ${formatDelta(summary.speed.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
    ]),
  });

  fields.push({
    name: 'Speed - Per Encounter',
    value: formatEncounterRankings(summary.speed.encounters, 'speed', labels),
  });

  fields.push({
    name: 'Execution',
    value: formatSection([
      `Source: ${summary.execution.sourceLabel}`,
      formatMetric(
        labels,
        summary.execution.overall.bestDerivedPercentile,
        summary.execution.overall.medianDerivedPercentile,
        summary.execution.overall.bestDerivedPercentileDelta,
        summary.execution.overall.medianDerivedPercentileDelta,
      ),
      summary.execution.bestEncounterGain
        ? `Best Encounter Gain: ${summary.execution.bestEncounterGain.encounterName} ${formatDelta(summary.execution.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
    ]),
  });

  fields.push({
    name: 'Execution - Per Encounter',
    value: formatEncounterRankings(summary.execution.encounters, 'execution', labels),
  });

  fields.push({
    name: 'Window',
    value: formatSection([
      `Current: ${summary.window.currentStartIso} -> ${summary.window.currentEndIso}`,
      `Baseline: ${summary.window.baselineStartIso} -> ${summary.window.baselineEndIso}`,
      ...summary.notes.map((note) => `Note: ${note}`),
    ]),
  });

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
