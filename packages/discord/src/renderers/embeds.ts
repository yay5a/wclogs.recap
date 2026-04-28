import { MessageComponentTypes } from 'discord-interactions';
import type { RecapSummary } from '../types.js';
import type { RecapRenderModel } from './recap-domain.js';
import { toRecapRenderModel } from './recap-domain.js';

const RECAP_COMPONENT_PREFIX = 'recap:v1';
const POST_RECAP_ACTION = 'post';
const CANCEL_RECAP_ACTION = 'cancel';
const EPHEMERAL_MESSAGE_FLAG = 64;
const PERFORMANCE_NOTE =
  'Note: Parses are WCL percentiles; damage/healing values are totals across included boss kills.';

type RecapMetric = 'DPS' | 'HPS' | 'DTPS';
const toMetricLabel = (metricLabel?: string, metric?: string): RecapMetric | undefined => {
  const candidate = metricLabel?.trim().toUpperCase() ?? metric?.trim().toUpperCase();
  return candidate === 'DPS' || candidate === 'HPS' || candidate === 'DTPS' ? candidate : undefined;
};
const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const formatRankPrefix = (index: number): string => `${index + 1}.`;
const formatAmountFamilyLabel = (metric?: RecapMetric): string => {
  if (metric === 'DPS') return 'damage';
  if (metric === 'HPS') return 'healing';
  if (metric === 'DTPS') return 'damage taken';
  return 'total';
};
const formatParseHighlightRow = (
  entry: RecapSummary['bestPlayerParses'][number],
  index: number,
): string => {
  const parseValue = Number.isInteger(entry.parse)
    ? entry.parse.toFixed(0)
    : entry.parse.toFixed(1);
  const metricLabel = toMetricLabel(entry.metricLabel, entry.metric);
  const amountSection =
    typeof entry.amount === 'number'
      ? ` · ${formatCompactNumber(entry.amount)} ${formatAmountFamilyLabel(metricLabel)}`
      : '';
  const classSpec =
    entry.classSpecLabel ??
    [entry.specName, entry.className].filter((value): value is string => Boolean(value)).join(' ');
  const classSpecSection = classSpec ? ` · ${classSpec}` : '';
  return `${formatRankPrefix(index)} **${entry.playerName}** · ${parseValue}${metricLabel ? ` ${metricLabel}` : ''} parse${amountSection}${classSpecSection}`;
};
const formatCompactParseRow = (
  playerName: string,
  value: number,
  metric: string,
  index: number,
): string => `${formatRankPrefix(index)} **${playerName}** · ${value.toFixed(1)} ${metric} parse`;
const formatPreviewRankingLine = (
  label: string,
  entry?: { playerName: string; value: number; metric: string; bossName?: string },
): string | undefined =>
  entry
    ? `${label}: ${entry.playerName} - ${entry.value.toFixed(1)} ${entry.metric}${
        entry.bossName ? ` on ${entry.bossName}` : ''
      }`
    : undefined;
const formatPreviewTotalsLine = (model: RecapRenderModel): string | undefined => {
  const totals = [
    typeof model.outcome.totals.totalDeaths === 'number'
      ? `☠️ Deaths: ${model.outcome.totals.totalDeaths}`
      : undefined,
    typeof model.outcome.totals.kicks === 'number'
      ? `🛑 Kicks: ${model.outcome.totals.kicks}`
      : undefined,
    typeof model.outcome.totals.dispels === 'number'
      ? `✨ Dispels: ${model.outcome.totals.dispels}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return totals.length > 0 ? totals.join(' · ') : undefined;
};

const formatRankingLine = (
  label: string,
  playerName: string,
  value: number,
  metric: string,
  bossName?: string,
): string =>
  `**${label}:** ${playerName} · ${value.toFixed(1)} ${metric} parse${bossName ? ` · ${bossName}` : ''}`;
const formatTotalLine = (model: RecapRenderModel): string | undefined => {
  const totals = [
    typeof model.outcome.totals.totalDeaths === 'number'
      ? `Deaths: ${model.outcome.totals.totalDeaths}`
      : undefined,
    typeof model.outcome.totals.raidDamageTaken === 'number'
      ? `Damage taken: ${formatCompactNumber(model.outcome.totals.raidDamageTaken)}`
      : undefined,
    typeof model.outcome.totals.kicks === 'number'
      ? `Kicks: ${model.outcome.totals.kicks}`
      : undefined,
    typeof model.outcome.totals.dispels === 'number'
      ? `Dispels: ${model.outcome.totals.dispels}`
      : undefined,
    typeof model.outcome.totals.battleRezzes === 'number'
      ? `Battle rezzes: ${model.outcome.totals.battleRezzes}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return totals.length > 0 ? totals.join(' · ') : undefined;
};
const formatTopStatRows = (
  entries: Array<{ playerName: string; value: number; classSpecLabel?: string }>,
  formatter: (value: number) => string,
): string =>
  entries
    .slice(0, 3)
    .map(
      (entry, index) =>
        `${formatRankPrefix(index)} **${entry.playerName}** · ${formatter(entry.value)}${entry.classSpecLabel ? ` · ${entry.classSpecLabel}` : ''}`,
    )
    .join('\n');
const DISCORD_FIELD_VALUE_LIMIT = 1024;
const truncateFieldValue = (value: string): string =>
  value.length <= DISCORD_FIELD_VALUE_LIMIT
    ? value
    : `${value.slice(0, DISCORD_FIELD_VALUE_LIMIT - 2)}…`;
const joinSectionLines = (lines: Array<string | undefined>): string =>
  lines.filter((line): line is string => Boolean(line)).join('\n');
const joinSectionBlocks = (blocks: Array<string | undefined>): string =>
  blocks.filter((block): block is string => Boolean(block)).join('\n\n');
const sectionBlock = (label: string, body: string | undefined): string | undefined =>
  body && body.length > 0 ? `**${label}**\n${body}` : undefined;
const formatBossHighlightRow = (entry: RecapSummary['bossHighlights'][number]): string =>
  `• **${entry.bossName}** · ${entry.text}`;
const formatRaidSuperlativeRow = (entry: RecapSummary['raidSuperlatives'][number]): string =>
  `• **${entry.label}** · ${entry.text}`;
const formatSummaryDescription = (model: RecapRenderModel): string =>
  joinSectionLines([
    `**${model.outcome.secondaryLine}**`,
    `${model.outcome.killTimeLabel} · ${model.outcome.pullCount} pulls · ${model.outcome.reportDateLabel}`,
  ]);

export const makeRecapComponentCustomId = (
  action: string,
  reportCode: string,
  guildId: string,
): string => `${RECAP_COMPONENT_PREFIX}:${action}:${reportCode}:${guildId}`;

export const parseRecapComponentCustomId = (
  customId: string,
): { action: string; reportCode: string; guildId: string } | undefined => {
  const [prefix, version, action, reportCode, guildId] = customId.split(':');
  if (`${prefix}:${version}` !== RECAP_COMPONENT_PREFIX) return undefined;
  if (!action || !reportCode || !guildId) return undefined;
  return { action, reportCode, guildId };
};

export const buildRecapPreviewBodyFromModel = (
  model: RecapRenderModel,
  reportCode: string,
  guildId: string,
) => ({
  flags: EPHEMERAL_MESSAGE_FLAG,
  content:
    'Review this preview before posting for everyone to see; cancel if you pasted the wrong link.',
  embeds: [
    {
      title: `Preview: ${model.outcome.titleLine}`,
      description: joinSectionLines([
        model.outcome.secondaryLine,
        `${model.outcome.killTimeLabel} · ${model.outcome.pullCount} pulls · ${model.outcome.reportDateLabel}`,
        '',
        '**Top Line:**',
        formatPreviewRankingLine('Best boss parse', model.performance.bestSingleBossParse),
        formatPreviewRankingLine('Best average parse', model.performance.bestAverageParse),
        formatPreviewTotalsLine(model),
      ]),
    },
  ],
  components: [
    {
      type: 1,
      components: [
        {
          type: MessageComponentTypes.BUTTON,
          style: 1,
          custom_id: makeRecapComponentCustomId(POST_RECAP_ACTION, reportCode, guildId),
          label: 'Post to Current Channel',
        },
        {
          type: MessageComponentTypes.BUTTON,
          style: 2,
          custom_id: makeRecapComponentCustomId(CANCEL_RECAP_ACTION, reportCode, guildId),
          label: 'Cancel',
        },
      ],
    },
  ],
});

export const buildRecapPreviewBody = (summary: RecapSummary, reportCode: string, guildId: string) =>
  buildRecapPreviewBodyFromModel(toRecapRenderModel(summary), reportCode, guildId);

export function buildPublicRecapEmbedFromModel(model: RecapRenderModel) {
  const hasPerformanceRows =
    model.performance.bestPlayerParses.length > 0 ||
    model.performance.topOverallParsers.length > 0 ||
    model.performance.topOverallDamageParsers.length > 0 ||
    model.performance.topOverallHealingParsers.length > 0;
  const standoutLines = [
    model.performance.bestExecution
      ? `**Best execution:** ${model.performance.bestExecution.playerName} · ${model.performance.bestExecution.value.toFixed(1)}`
      : undefined,
    model.performance.mostImprovedPlayer
      ? `**Most improved:** ${model.performance.mostImprovedPlayer.playerName} · +${model.performance.mostImprovedPlayer.delta.toFixed(1)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const rankingLines = [
    model.performance.bestSingleBossParse
      ? formatRankingLine(
          'Best boss parse',
          model.performance.bestSingleBossParse.playerName,
          model.performance.bestSingleBossParse.value,
          model.performance.bestSingleBossParse.metric,
          model.performance.bestSingleBossParse.bossName,
        )
      : undefined,
    model.performance.bestAverageParse
      ? formatRankingLine(
          'Best average parse',
          model.performance.bestAverageParse.playerName,
          model.performance.bestAverageParse.value,
          model.performance.bestAverageParse.metric,
        )
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: '🏁 Raid Snapshot',
      value: truncateFieldValue(
        joinSectionBlocks([
          sectionBlock(
            'Boss Highlights',
            model.outcome.bossHighlights.slice(0, 4).map(formatBossHighlightRow).join('\n'),
          ),
          sectionBlock('Raid Totals', formatTotalLine(model)),
        ]),
      ),
    },
  ];
  const pushSection = (name: string, value: string): void => {
    if (value.length > 0) fields.push({ name, value: truncateFieldValue(value) });
  };
  if (model.performance.bestSingleBossParse || model.performance.bestAverageParse) {
    pushSection(
      '⚔️ Performance',
      joinSectionBlocks([
        sectionBlock('Signature Parses', rankingLines.join('\n')),
        sectionBlock(
          'Player Standouts',
          model.performance.bestPlayerParses
            .map((entry, index) => formatParseHighlightRow(entry, index))
            .join('\n'),
        ),
        sectionBlock(
          'Overall Parses',
          model.performance.topOverallParsers
            .map((entry, index) =>
              formatCompactParseRow(entry.playerName, entry.value, entry.metric, index),
            )
            .join('\n'),
        ),
        sectionBlock(
          'Damage Parses',
          model.performance.topOverallDamageParsers
            .map((entry, index) =>
              formatCompactParseRow(entry.playerName, entry.value, entry.metric, index),
            )
            .join('\n'),
        ),
        sectionBlock(
          'Healing Parses',
          model.performance.topOverallHealingParsers
            .map((entry, index) =>
              formatCompactParseRow(entry.playerName, entry.value, entry.metric, index),
            )
            .join('\n'),
        ),
        PERFORMANCE_NOTE,
      ]),
    );
  } else {
    pushSection(
      '⚔️ Performance',
      joinSectionBlocks([
        sectionBlock(
          'Player Standouts',
          model.performance.bestPlayerParses
            .map((entry, index) => formatParseHighlightRow(entry, index))
            .join('\n'),
        ),
        sectionBlock(
          'Overall Parses',
          model.performance.topOverallParsers
            .map((entry, index) =>
              formatCompactParseRow(entry.playerName, entry.value, entry.metric, index),
            )
            .join('\n'),
        ),
        sectionBlock(
          'Damage Parses',
          model.performance.topOverallDamageParsers
            .map((entry, index) =>
              formatCompactParseRow(entry.playerName, entry.value, entry.metric, index),
            )
            .join('\n'),
        ),
        sectionBlock(
          'Healing Parses',
          model.performance.topOverallHealingParsers
            .map((entry, index) =>
              formatCompactParseRow(entry.playerName, entry.value, entry.metric, index),
            )
            .join('\n'),
        ),
        hasPerformanceRows ? PERFORMANCE_NOTE : undefined,
      ]),
    );
  }
  pushSection(
    '📊 Output & Intake',
    joinSectionBlocks([
      sectionBlock(
        'Damage Done',
        formatTopStatRows(model.volume.topDamageDone, (value) => formatCompactNumber(value)),
      ),
      sectionBlock(
        'Healing Done',
        formatTopStatRows(model.volume.topHealingDone, (value) => formatCompactNumber(value)),
      ),
      sectionBlock(
        'Damage Taken',
        formatTopStatRows(model.volume.topDamageTaken, (value) => formatCompactNumber(value)),
      ),
    ]),
  );
  pushSection(
    '🎯 Utility & Execution',
    joinSectionBlocks([
      sectionBlock('Standouts', standoutLines.join('\n')),
      sectionBlock(
        'Top Interrupts',
        formatTopStatRows(model.execution.topInterrupts, (value) => value.toFixed(0)),
      ),
      sectionBlock(
        'Top Dispels',
        formatTopStatRows(model.execution.topDispels, (value) => value.toFixed(0)),
      ),
      sectionBlock(
        'Top Survivability',
        formatTopStatRows(model.execution.topSurvivability, (value) => value.toFixed(1)),
      ),
      sectionBlock(
        'Raid Notes',
        model.outcome.raidSuperlatives.slice(0, 4).map(formatRaidSuperlativeRow).join('\n'),
      ),
    ]),
  );
  pushSection('🔗 Warcraft Logs', model.outcome.reportLink);
  return {
    title: model.outcome.titleLine,
    description: formatSummaryDescription(model),
    color: 0x5b8def,
    fields,
  };
}

export const buildPublicRecapEmbed = (summary: RecapSummary) =>
  buildPublicRecapEmbedFromModel(toRecapRenderModel(summary));
