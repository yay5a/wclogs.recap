# First Seam

## The golden path, simplified
Discord command
-> get report data
-> build recap data
-> render Discord recap

## What is obviously mixed today
- command handling and recap building
- recap building and Discord formatting
- transport and normalization
- maybe persistence and runtime flow

## The first seam to extract
The first seam is:
`separating recap data building from Discord embed rendering`

```typescript
const processReportRecapInteraction = async (
  interaction: DiscordInteraction,
  options: HandleOptions,
  url: string,
): Promise<void> => {
  const previewStateTtlMs =
    (options.previewStateTtlSeconds ?? DEFAULT_PREVIEW_STATE_TTL_SECONDS) *
    1000;
  const interactionId = interaction.id;
  const guildId = interaction.guild_id ?? "dm";
  const channelId = interaction.channel_id ?? "unknown";
  const createdByUserId =
    interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";
  const applicationId = interaction.application_id;
  const interactionToken = interaction.token;

  if (!applicationId || !interactionToken) {
    logger.error(
      {
        interactionId,
        applicationIdPresent: Boolean(applicationId),
        tokenPresent: Boolean(interactionToken),
      },
      "report recap missing application id or token",
    );
    return;
  }

  try {
    const guildConfigStart = Date.now();
    const guildConfig = await options.guildConfigStore.getGuildConfig(guildId);
    logReportRecapStep(interactionId, "guild_config_load", guildConfigStart);

    const reportFetchStart = Date.now();
    const report = await options.wclClient.fetchAndNormalizeReport(url);
    logReportRecapStep(
      interactionId,
      "report_fetch_normalize",
      reportFetchStart,
    );

    const previousLookupStart = Date.now();
    const previousPlayers = options.wclClient.findPreviousRaidSummaries
      ? await options.wclClient.findPreviousRaidSummaries(
          guildId,
          new Date(report.startTime),
        )
      : [];
    logReportRecapStep(
      interactionId,
      "previous_raid_summary_lookup",
      previousLookupStart,
    );

    const summaryBuildStart = Date.now();
    const summary = buildRecapSummary(report, previousPlayers, {
      guildConfig,
    });
    logReportRecapStep(interactionId, "summary_build", summaryBuildStart);

    const createdAt = new Date();
    const previewStateInput: SavePreviewStateInput = {
      guildId,
      channelId,
      reportCode: report.reportCode,
      sourceUrl: url,
      summaryPayload: toRecapPreviewSummary(summary),
      createdByUserId,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + previewStateTtlMs),
    };
    if (interactionId) {
      previewStateInput.interactionId = interactionId;
    }
    await options.recapPreviewStateService.savePreviewState(previewStateInput);

    const editStart = Date.now();
    await editOriginalInteractionResponse(
      applicationId,
      interactionToken,
      buildRecapPreviewBody(summary, report.reportCode, guildId),
    );
    logReportRecapStep(interactionId, "original_response_edit", editStart);
  } catch (error) {
    logger.error(
      {
        error,
        interactionId,
        guildId,
      },
      "report recap processing failed",
    );
    const errorMessage =
      error instanceof Error ? error.message.toLowerCase() : "";
    const userFacingContent = errorMessage.includes("report code")
      ? "I couldn't find a Warcraft Logs report code in that URL. Paste the full report link."
      : "Could not build recap preview for that report. Please verify the URL and try again.";

    await safeEditOriginalInteractionResponse(applicationId, interactionToken, {
      flags: EPHEMERAL_MESSAGE_FLAG,
      content: userFacingContent,
    });
  }
};
```

## Why this seam first
- easiest to isolate
- lowest risk to golden path
- reduces confusion fastest

## What stays where for now
- leave transport where it is
- leave OAuth where it is
- leave deployment alone
- leave worker alone unless proven necessary

## What moves in this seam
- recap section formatting
- Discord-specific labels/icons/string assembly
- embed field construction

```typescript
interface HandleOptions {
    wclClient: WclClient & Partial<PreviousRaidLookup>;
    guildConfigStore: GuildConfigStore;
    recapPreviewStateService: RecapPreviewStateService;
    previewStateTtlSeconds?: number;
}

type RecapSummary = ReturnType<typeof buildRecapSummary>;

type RecapPreviewSummary = RecapSummary;

interface SavePreviewStateInput {
    guildId: string;
    channelId: string;
    reportCode: string;
    sourceUrl: string;
    summaryPayload: RecapPreviewSummary;
    createdByUserId: string;
    createdAt: Date;
    expiresAt: Date;
    interactionId?: string;
    messageId?: string;
}

interface PreviewStateLookup {
    reportCode: string;
    guildId: string;
}

type PreviewStateRecord = SavePreviewStateInput;

export interface RecapPreviewStateService {
    savePreviewState(input: SavePreviewStateInput): Promise<PreviewStateRecord>;
    getValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<PreviewStateRecord | null>;
    consumeValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<PreviewStateRecord | null>;
    deletePreviewState(lookup: PreviewStateLookup): Promise<void>;

const logReportRecapStep = (
    interactionId: string | undefined,
    step: string,
    startedAt: number,
) => {
    logger.info(
        {
            interactionId,
            step,
            durationMs: toDurationMs(startedAt),
        },
        "report recap step complete",
    );
};

export const buildRecapPreviewBody = (
    summary: ReturnType<typeof buildRecapSummary>,
    reportCode: string,
    guildId: string,
) => ({
    flags: EPHEMERAL_MESSAGE_FLAG,
    embeds: [
        {
            title: `Preview: ${summary.titleLine}`,
            description: [
                summary.secondaryLine,
                `Raid Duration: ${summary.killTimeLabel} (${summary.pullCount} Pulls)`,
                `Date: ${summary.reportDateLabel}`,
                summary.bestPlayerParses[0]
                    ? `Best Parse: ${getMetricIcon(summary.bestPlayerParses[0].metricLabel, summary.bestPlayerParses[0].metric) ?? "⭐"} ${summary.bestPlayerParses[0].playerName} (${summary.bestPlayerParses[0].parse.toFixed(1)})`
                    : undefined,
            ]
                .filter((line): line is string => Boolean(line))
                .join("\n"),
        },
    ],
    components: [
        {
            type: 1,
            components: [
                {
                    type: MessageComponentTypes.BUTTON,
                    style: 1,
                    custom_id: makeRecapComponentCustomId(
                        POST_RECAP_ACTION,
                        reportCode,
                        guildId,
                    ),
                    label: "Post Recap",
                },
            ],
        },
    ],
});

const toRecapPreviewSummary = (summary: RecapSummary): RecapPreviewSummary =>
    summary;

export function buildPublicRecapEmbed(summary: RecapPreviewSummary) {
    const spacerField = { name: "\u200B", value: "\u200B" };
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
        {
            name: "🛡️ Raid",
            value: [
                summary.secondaryLine,
                `Raid Duration: ${summary.killTimeLabel} (${summary.pullCount} Pulls)`,
                `Date: ${summary.reportDateLabel}`,
            ]
                .filter((line): line is string => Boolean(line))
                .join("\n"),
        },
    ];
    let hasSecondarySection = false;
    const pushSection = (name: string, value: string): void => {
        if (hasSecondarySection) {
            fields.push(spacerField);
        }
        fields.push({ name, value });
        hasSecondarySection = true;
    };

    if (summary.bossHighlights.length > 0) {
        pushSection(
            "🏆 Boss Highlights",
            summary.bossHighlights
                .slice(0, 4)
                .map((entry) => `• **${entry.bossName}:** ${entry.text}`)
                .join("\n"),
        );
    }

    const standoutLines = [
        summary.bestExecution
            ? `🎯 Best execution: **${summary.bestExecution.playerName} ${summary.bestExecution.value.toFixed(1)}**`
            : undefined,
        summary.mostImprovedPlayer
            ? `📈 Most improved: **${summary.mostImprovedPlayer.playerName} +${summary.mostImprovedPlayer.delta.toFixed(1)}**`
            : undefined,
    ].filter((line): line is string => Boolean(line));
    if (standoutLines.length > 0) {
        pushSection("🌟 Standouts", standoutLines.join("\n"));
    }

    if (summary.bestSingleBossParse || summary.bestAverageParse) {
        const rankingLines = [
            summary.bestSingleBossParse
                ? formatRankingLine(
                      "🥇",
                      "Best single-boss parse",
                      summary.bestSingleBossParse.playerName,
                      summary.bestSingleBossParse.value,
                      summary.bestSingleBossParse.metric,
                      summary.bestSingleBossParse.bossName,
                  )
                : undefined,
            summary.bestAverageParse
                ? formatRankingLine(
                      "📊",
                      "Best average parse",
                      summary.bestAverageParse.playerName,
                      summary.bestAverageParse.value,
                      summary.bestAverageParse.metric,
                  )
                : undefined,
        ].filter((line): line is string => Boolean(line));
        pushSection("📈 Overall Rankings", rankingLines.join("\n"));
    }

    if (summary.bestPlayerParses.length > 0) {
        pushSection(
            "⭐ Best Player Parses",
            summary.bestPlayerParses
                .map((entry) => formatParseHighlightRow(entry))
                .join("\n"),
        );
    }

    if (summary.topOverallParsers.length > 0) {
        pushSection(
            "📊 Top Overall Parsers",
            summary.topOverallParsers
                .map((entry) =>
                    formatCompactParseRow(entry.playerName, entry.value, entry.metric),
                )
                .join("\n"),
        );
    }

    if (summary.topOverallDamageParsers.length > 0) {
        pushSection(
            "⚔️ Top Overall Damage Parse",
            summary.topOverallDamageParsers
                .map((entry) =>
                    formatCompactParseRow(entry.playerName, entry.value, entry.metric),
                )
                .join("\n"),
        );
    }

    if (summary.topOverallHealingParsers.length > 0) {
        pushSection(
            "💚 Top Overall Healing Parse",
            summary.topOverallHealingParsers
                .map((entry) =>
                    formatCompactParseRow(entry.playerName, entry.value, entry.metric),
                )
                .join("\n"),
        );
    }

    if (summary.raidSuperlatives.length > 0) {
        pushSection(
            "🏅 Raid Superlatives",
            summary.raidSuperlatives
                .slice(0, 4)
                .map((entry) => `• **${entry.label}:** ${entry.text}`)
                .join("\n"),
        );
    }

    if (summary.topDamageDone.length > 0) {
        pushSection(
            "⚔️ Top Damage Done",
            formatTopStatRows(summary.topDamageDone, (value) => formatCompactNumber(value)),
        );
    }

    if (summary.topHealingDone.length > 0) {
        pushSection(
            "💚 Top Healing Done",
            formatTopStatRows(summary.topHealingDone, (value) => formatCompactNumber(value)),
        );
    }

    if (summary.topDamageTaken.length > 0) {
        pushSection(
            "🩸 Top Damage Taken",
            formatTopStatRows(summary.topDamageTaken, (value) => formatCompactNumber(value)),
        );
    }

    if (summary.topInterrupts.length > 0) {
        pushSection(
            "🛑 Top Interrupts",
            formatTopStatRows(summary.topInterrupts, (value) => value.toFixed(0)),
        );
    }

    if (summary.topDispels.length > 0) {
        pushSection(
            "✨ Top Dispels",
            formatTopStatRows(summary.topDispels, (value) => value.toFixed(0)),
        );
    }

    if (summary.topSurvivability.length > 0) {
        pushSection(
            "🛡️ Top Survivability",
            formatTopStatRows(summary.topSurvivability, (value) => value.toFixed(1)),
        );
    }

    const totalLines = [
        typeof summary.totals.totalDeaths === "number"
            ? formatTotalLine("Total deaths", summary.totals.totalDeaths, "☠️", true)
            : undefined,
        typeof summary.totals.raidDamageTaken === "number"
            ? formatTotalLine(
                  "Raid damage taken",
                  formatCompactNumber(summary.totals.raidDamageTaken),
                  "🩸",
                  true,
              )
            : undefined,
        typeof summary.totals.dispels === "number"
            ? formatTotalLine("Dispels", summary.totals.dispels, "✨", true)
            : undefined,
        typeof summary.totals.battleRezzes === "number"
            ? formatTotalLine("Battle rezzes", summary.totals.battleRezzes)
            : undefined,
        typeof summary.totals.kicks === "number"
            ? formatTotalLine("Kicks", summary.totals.kicks, "🛑", true)
            : undefined,
    ].filter((line): line is string => Boolean(line));

    if (totalLines.length > 0) {
        pushSection("🧾 Totals", totalLines.join("\n"));
    }
    pushSection("🔗 Report", summary.reportLink);

    return {
        title: summary.titleLine,
        fields,
    };
}
```

## What absolutely does NOT move yet
- GraphQL queries
- token handling
- report fetch pipeline
- package renames
- deployment files

## Success condition
After this seam is extracted:
- one thing is cleaner
- app still works
- no package rename required yet
