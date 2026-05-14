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

export const buildGuildRankResponseBody = (summary: GuildRankSummary) => {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

  fields.push({
    name: 'Progress',
    value: [
      `Source: ${summary.progress.sourceLabel}`,
      `Cleared: ${summary.progress.clearedEncounters}/${summary.progress.totalEncounters}`,
      `World: ${typeof summary.progress.ranks.world === 'number' ? `#${summary.progress.ranks.world}` : 'unavailable'}`,
      `Region: ${typeof summary.progress.ranks.region === 'number' ? `#${summary.progress.ranks.region}` : 'unavailable'}`,
      `Realm: ${typeof summary.progress.ranks.realm === 'number' ? `#${summary.progress.ranks.realm}` : 'unavailable'}`,
      `Pulls/Wipes: ${integerFormatter.format(summary.progress.pulls)}/${integerFormatter.format(summary.progress.wipes)}`,
    ].join('\n'),
  });

  fields.push({
    name: 'Speed',
    value: [
      `Source: ${summary.speed.sourceLabel}`,
      typeof summary.speed.ranks?.world === 'number' ||
      typeof summary.speed.ranks?.region === 'number' ||
      typeof summary.speed.ranks?.realm === 'number'
        ? [
            `World: ${typeof summary.speed.ranks.world === 'number' ? `#${summary.speed.ranks.world}` : 'unavailable'}`,
            `Region: ${typeof summary.speed.ranks.region === 'number' ? `#${summary.speed.ranks.region}` : 'unavailable'}`,
            `Realm: ${typeof summary.speed.ranks.realm === 'number' ? `#${summary.speed.ranks.realm}` : 'unavailable'}`,
          ].join('\n')
        : [
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
    ].join('\n'),
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

  for (const encounter of summary.speed.encounters.slice(0, 6)) {
    const executionEncounter = summary.execution.encounters.find(
      (row) => row.encounterName === encounter.encounterName,
    );
    fields.push({
      name: encounter.encounterName,
      value: [
        `Speed Best/Median: ${typeof encounter.speed.bestPercentile === 'number' ? decimalFormatter.format(encounter.speed.bestPercentile) : 'n/a'} / ${typeof encounter.speed.medianPercentile === 'number' ? decimalFormatter.format(encounter.speed.medianPercentile) : 'n/a'}`,
        `Speed Δ Best/Median: ${formatDelta(encounter.speed.bestDelta)} / ${formatDelta(encounter.speed.medianDelta)}`,
        `Execution Best/Median: ${typeof executionEncounter?.execution.bestPercentile === 'number' ? decimalFormatter.format(executionEncounter.execution.bestPercentile) : 'n/a'} / ${typeof executionEncounter?.execution.medianPercentile === 'number' ? decimalFormatter.format(executionEncounter.execution.medianPercentile) : 'n/a'}`,
        `Execution Δ Best/Median: ${formatDelta(executionEncounter?.execution.bestDelta)} / ${formatDelta(executionEncounter?.execution.medianDelta)}`,
      ].join('\n'),
      inline: false,
    });
  }

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
