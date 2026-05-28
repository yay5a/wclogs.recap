import type { ReportBrezSummary } from '@wcl/domain';

type DiscordComponent = Record<string, unknown>;

const responseSecondsFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 3,
});

const renderPlayerRows = (players: ReportBrezSummary['topCasters']): string[] =>
  players.length > 0
    ? players.map((player, index) => `${index + 1}. ${player.name} - ${player.count}`)
    : ['No matched players.'];

const formatFightLabel = (fastest: NonNullable<ReportBrezSummary['fastest']>): string =>
  fastest.fightName ? `${fastest.fightName} (#${fastest.fightID})` : String(fastest.fightID);

export const buildBattleRezComponentsV2 = (summary: ReportBrezSummary): DiscordComponent[] => [
  {
    type: 17,
    components: [
      {
        type: 10,
        content: [
          '## Battle Rez',
          '',
          '**Top Casters**',
          ...renderPlayerRows(summary.topCasters),
          '',
          '**Top Receivers**',
          ...renderPlayerRows(summary.topReceivers),
          '',
          '**Fastest Rez**',
          summary.fastest
            ? `${summary.fastest.caster.name} -> ${
                summary.fastest.receiver.name
              } in ${responseSecondsFormatter.format(summary.fastest.responseSec)}s`
            : 'No matched battle-rez found.',
          summary.fastest
            ? `Death: ${summary.fastest.deathTimestamp} | Rez: ${
                summary.fastest.resurrectTimestamp
              } | Fight: ${formatFightLabel(summary.fastest)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  },
];

export const renderBrezComponentsV2 = (summary: ReportBrezSummary): {
  flags: number;
  components: DiscordComponent[];
} => ({
  flags: 1 << 15,
  components: buildBattleRezComponentsV2(summary),
});
