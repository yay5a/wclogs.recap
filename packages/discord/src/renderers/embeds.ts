import { MessageComponentTypes } from 'discord-interactions';
import type { RecapSummary } from '../types.js';
import type { RecapRenderModel } from './recap-domain.js';
import { toRecapRenderModel } from './recap-domain.js';

const RECAP_COMPONENT_PREFIX = 'recap:v1';
const RECAP_COMPONENT_V2_PREFIX = 'recap:v2';
const POST_RECAP_ACTION = 'post';
const CANCEL_RECAP_ACTION = 'cancel';
const EPHEMERAL_MESSAGE_FLAG = 64;
const DOMAIN_DIVIDER = '━━━━━━━━━━━━━━━━━━━━';
const PERFORMANCE_NOTE =
  'Note: Parses are WCL percentiles; damage/healing values are totals across included boss kills and not including damage/healing for wipes.';
const formatWarcraftLogsField = (reportLink: string): string =>
  `${reportLink}\n\n*${PERFORMANCE_NOTE}*`;
const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const formatRankPrefix = (index: number): string => `#${index + 1}`;
const formatHighestParseRow = (
  entry: RecapSummary['highestParses'][number],
  index: number,
): string =>
  `${formatRankPrefix(index)} **${entry.playerName}** · ${entry.metric} parse: ${entry.value.toFixed(
    1,
  )}${entry.bossName ? ` on ${entry.bossName}` : ''}`;
const formatAverageParseRow = (
  entry: RecapSummary['topDamageAverageParses'][number],
  index: number,
): string => `${formatRankPrefix(index)} **${entry.playerName}** · average parse: ${entry.value}`;
const formatPreviewHighestParseLine = (
  entry?: RecapSummary['highestParses'][number],
): string | undefined =>
  entry
    ? `Highest parse: ${entry.playerName} · ${entry.metric} parse: ${entry.value.toFixed(1)}${
        entry.bossName ? ` on ${entry.bossName}` : ''
      }`
    : undefined;
const formatPreviewAverageParseLine = (
  label: string,
  entry?: RecapSummary['topDamageAverageParses'][number],
): string | undefined =>
  entry ? `${label}: ${entry.playerName} · average parse: ${entry.value}` : undefined;
const formatPreviewTotalsLine = (model: RecapRenderModel): string | undefined => {
  const totals = [
    typeof model.outcome.totals.totalDeaths === 'number'
      ? `☠️ Deaths: ${model.outcome.totals.totalDeaths}`
      : undefined,
    typeof model.outcome.totals.kicks === 'number'
      ? `🦵 Kicks: ${model.outcome.totals.kicks}`
      : undefined,
    typeof model.outcome.totals.dispels === 'number'
      ? `🪄 Dispels: ${model.outcome.totals.dispels}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return totals.length > 0 ? totals.join(' · ') : undefined;
};

const formatTotalLine = (model: RecapRenderModel): string | undefined => {
  const totals = [
    typeof model.outcome.totals.totalDeaths === 'number'
      ? `☠️ Deaths: ${model.outcome.totals.totalDeaths}`
      : undefined,
    typeof model.outcome.totals.raidDamageTaken === 'number'
      ? `🩸 Raid-wide damage taken: ${formatCompactNumber(model.outcome.totals.raidDamageTaken)}`
      : undefined,
    typeof model.outcome.totals.kicks === 'number'
      ? `🦵 Kicks: ${model.outcome.totals.kicks}`
      : undefined,
    typeof model.outcome.totals.dispels === 'number'
      ? `🪄 Dispels: ${model.outcome.totals.dispels}`
      : undefined,
    typeof model.outcome.totals.battleRezzes === 'number'
      ? `♻️ Battle rezzes: ${model.outcome.totals.battleRezzes}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return totals.length > 0 ? totals.join('\n') : undefined;
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
const withDomainDivider = (value: string): string =>
  value.length > 0 ? `${value}\n\n${DOMAIN_DIVIDER}` : value;
const indentLines = (body: string): string =>
  body
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n');
const subsectionBlock = (label: string, body?: string): string | undefined => {
  const trimmedBody = body?.trim();
  return trimmedBody ? `▸ __**${label}**__\n${indentLines(trimmedBody)}` : undefined;
};
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
  channelId: string,
): string => `${RECAP_COMPONENT_V2_PREFIX}:${action}:${reportCode}:${guildId}:${channelId}`;

export const parseRecapComponentCustomId = (
  customId: string,
): { action: string; reportCode: string; guildId: string; channelId?: string } | undefined => {
  const [prefix, version, action, reportCode, guildId, channelId] = customId.split(':');
  const parsedPrefix = `${prefix}:${version}`;
  if (parsedPrefix !== RECAP_COMPONENT_PREFIX && parsedPrefix !== RECAP_COMPONENT_V2_PREFIX) {
    return undefined;
  }
  if (!action || !reportCode || !guildId) return undefined;
  if (parsedPrefix === RECAP_COMPONENT_V2_PREFIX && !channelId) return undefined;
  return { action, reportCode, guildId, ...(channelId ? { channelId } : {}) };
};

export const buildRecapPreviewBodyFromModel = (
  model: RecapRenderModel,
  reportCode: string,
  guildId: string,
  channelId: string,
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
        formatPreviewHighestParseLine(model.performance.highestParses[0]),
        formatPreviewAverageParseLine(
          'Damage average',
          model.performance.topDamageAverageParses[0],
        ),
        formatPreviewAverageParseLine(
          'Healing average',
          model.performance.topHealingAverageParses[0],
        ),
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
          custom_id: makeRecapComponentCustomId(POST_RECAP_ACTION, reportCode, guildId, channelId),
          label: 'Post to Current Channel',
        },
        {
          type: MessageComponentTypes.BUTTON,
          style: 2,
          custom_id: makeRecapComponentCustomId(CANCEL_RECAP_ACTION, reportCode, guildId, channelId),
          label: 'Cancel',
        },
      ],
    },
  ],
});

export const buildRecapPreviewBody = (
  summary: RecapSummary,
  reportCode: string,
  guildId: string,
  channelId: string,
) => buildRecapPreviewBodyFromModel(toRecapRenderModel(summary), reportCode, guildId, channelId);

export function buildPublicRecapEmbedFromModel(model: RecapRenderModel) {
  const standoutLines = [
    model.performance.bestExecution
      ? `**Best execution:** ${model.performance.bestExecution.playerName} · ${model.performance.bestExecution.value.toFixed(1)}`
      : undefined,
    model.performance.mostImprovedPlayer
      ? `**Most improved:** ${model.performance.mostImprovedPlayer.playerName} · +${model.performance.mostImprovedPlayer.delta.toFixed(1)}`
      : undefined,
  ].filter((line): line is string => Boolean(line));
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: '🏁 Raid Snapshot',
      value: truncateFieldValue(
        withDomainDivider(
          joinSectionBlocks([
            subsectionBlock(
              'Boss Highlights',
              model.outcome.bossHighlights.slice(0, 4).map(formatBossHighlightRow).join('\n'),
            ),
            subsectionBlock('Raid Totals', formatTotalLine(model)),
          ]),
        ),
      ),
    },
  ];
  const pushSection = (name: string, value: string): void => {
    if (value.length > 0) fields.push({ name, value: truncateFieldValue(value) });
  };
  if (
    model.performance.highestParses.length > 0 ||
    model.performance.topDamageAverageParses.length > 0 ||
    model.performance.topHealingAverageParses.length > 0
  ) {
    pushSection(
      '⚡ Performance',
      withDomainDivider(
        joinSectionBlocks([
          subsectionBlock(
            'Highest Parse',
            model.performance.highestParses
              .map((entry, index) => formatHighestParseRow(entry, index))
              .join('\n'),
          ),
          subsectionBlock(
            'Damage Parse Averages',
            model.performance.topDamageAverageParses
              .map((entry, index) => formatAverageParseRow(entry, index))
              .join('\n'),
          ),
          subsectionBlock(
            'Healing Parse Averages',
            model.performance.topHealingAverageParses
              .map((entry, index) => formatAverageParseRow(entry, index))
              .join('\n'),
          ),
        ]),
      ),
    );
  }
  pushSection(
    '🎛️ Output & Intake',
    withDomainDivider(
      joinSectionBlocks([
        subsectionBlock(
          'Damage Done',
          formatTopStatRows(model.volume.topDamageDone, (value) => formatCompactNumber(value)),
        ),
        subsectionBlock(
          'Healing Done',
          formatTopStatRows(model.volume.topHealingDone, (value) => formatCompactNumber(value)),
        ),
        subsectionBlock(
          'Damage Taken',
          formatTopStatRows(model.volume.topDamageTaken, (value) => formatCompactNumber(value)),
        ),
      ]),
    ),
  );
  pushSection(
    '🎯 Utility & Execution',
    joinSectionBlocks([
      subsectionBlock('Standouts', standoutLines.join('\n')),
      subsectionBlock(
        'Top Interrupts',
        formatTopStatRows(model.execution.topInterrupts, (value) => value.toFixed(0)),
      ),
      subsectionBlock(
        'Top Dispels',
        formatTopStatRows(model.execution.topDispels, (value) => value.toFixed(0)),
      ),
      subsectionBlock(
        'Top Survivability',
        formatTopStatRows(model.execution.topSurvivability, (value) => value.toFixed(1)),
      ),
      subsectionBlock(
        'Raid Notes',
        model.outcome.raidSuperlatives.slice(0, 4).map(formatRaidSuperlativeRow).join('\n'),
      ),
    ]),
  );
  pushSection('🔗 Warcraft Logs', formatWarcraftLogsField(model.outcome.reportLink));
  return {
    title: model.outcome.titleLine,
    description: formatSummaryDescription(model),
    color: 0x5b8def,
    fields,
  };
}

export const buildPublicRecapEmbed = (summary: RecapSummary) =>
  buildPublicRecapEmbedFromModel(toRecapRenderModel(summary));
