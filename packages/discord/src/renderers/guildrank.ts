import type { GuildRankSummary } from '@wcl/domain';

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

const formatDelta = (value?: number): string =>
  typeof value === 'number' ? `${value >= 0 ? '+' : ''}${decimalFormatter.format(value)}` : 'n/a';

const formatMetric = (best?: number, median?: number, bestDelta?: number, medianDelta?: number): string =>
  [
    `Best Avg %: ${typeof best === 'number' ? decimalFormatter.format(best) : 'n/a'} (${formatDelta(bestDelta)})`,
    `Median Avg %: ${typeof median === 'number' ? decimalFormatter.format(median) : 'n/a'} (${formatDelta(medianDelta)})`,
  ].join('\n');

const formatPercentLine = (label: string, value?: number, delta?: number): string =>
  `${label}: ${typeof value === 'number' ? decimalFormatter.format(value) : 'n/a'} (${formatDelta(delta)})`;

const formatEncounterRankings = (
  encounters: Array<{
    encounterName: string;
    speed: { bestPercentile?: number; bestDelta?: number; medianPercentile?: number; medianDelta?: number };
    execution: { bestPercentile?: number; bestDelta?: number; medianPercentile?: number; medianDelta?: number };
  }>,
  metric: 'speed' | 'execution',
): string => {
  const rows = encounters.slice(0, 6).map((encounter) => {
    const values = encounter[metric];
    return [
      encounter.encounterName,
      formatPercentLine('Best %', values.bestPercentile, values.bestDelta),
      formatPercentLine('Median %', values.medianPercentile, values.medianDelta),
    ].join('\n');
  });
  return rows.length > 0 ? rows.join('\n\n') : 'unavailable';
};

export const buildGuildRankResponseBody = (summary: GuildRankSummary) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  fields.push({
    name: 'Progress',
    value: [
      `Cleared: ${summary.progress.clearedEncounters}/${summary.progress.totalEncounters}`,
      `World: ${typeof summary.progress.ranks.world === 'number' ? `#${summary.progress.ranks.world}` : 'unavailable'}`,
      `Region: ${typeof summary.progress.ranks.region === 'number' ? `#${summary.progress.ranks.region}` : 'unavailable'}`,
      `Realm: ${typeof summary.progress.ranks.realm === 'number' ? `#${summary.progress.ranks.realm}` : 'unavailable'}`,
    ].join('\n'),
  });

  fields.push({
    name: 'Guild Rankings',
    value: `Pulls/Wipes: ${integerFormatter.format(summary.progress.pulls)}/${integerFormatter.format(summary.progress.wipes)}`,
  });

  fields.push({
    name: 'Speed',
    value: [
      `Source: ${summary.speed.sourceLabel}`,
      formatMetric(
        summary.speed.overall.bestPercentile,
        summary.speed.overall.medianPercentile,
        summary.speed.overall.bestDelta,
        summary.speed.overall.medianDelta,
      ),
      summary.speed.bestEncounterGain
        ? `Best Encounter Gain: ${summary.speed.bestEncounterGain.encounterName} ${formatDelta(summary.speed.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
    ].join('\n'),
  });

  fields.push({
    name: 'Speed - Per Encounter',
    value: formatEncounterRankings(summary.speed.encounters, 'speed'),
  });

  fields.push({
    name: 'Execution',
    value: [
      `Source: ${summary.execution.sourceLabel}`,
      formatMetric(
        summary.execution.overall.bestPercentile,
        summary.execution.overall.medianPercentile,
        summary.execution.overall.bestDelta,
        summary.execution.overall.medianDelta,
      ),
      summary.execution.bestEncounterGain
        ? `Best Encounter Gain: ${summary.execution.bestEncounterGain.encounterName} ${formatDelta(summary.execution.bestEncounterGain.delta)}`
        : 'Best Encounter Gain: n/a',
    ].join('\n'),
  });

  fields.push({
    name: 'Execution - Per Encounter',
    value: formatEncounterRankings(summary.execution.encounters, 'execution'),
  });

  fields.push({
    name: 'Window',
    value: [
      `Current: ${summary.window.currentStartIso} -> ${summary.window.currentEndIso}`,
      `Baseline: ${summary.window.baselineStartIso} -> ${summary.window.baselineEndIso}`,
      ...summary.notes.map((note) => `Note: ${note}`),
    ].join('\n'),
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
