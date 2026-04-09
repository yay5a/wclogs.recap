import {
    InteractionResponseType,
    InteractionType,
    MessageComponentTypes,
} from "discord-interactions";
import type {
    AccountabilityViewService,
    CoachingViewService,
    GuildConfigStore,
    PreviousRaidLookup,
    TrendTrackingService,
} from "@wcl/domain";
import { buildRecapSummary } from "@wcl/domain";
import type { WclClient } from "@wcl/wcl-client";

interface HandleOptions {
    wclClient: WclClient & Partial<PreviousRaidLookup>;
    guildConfigStore: GuildConfigStore;
    coachingViewService?: CoachingViewService;
    accountabilityViewService?: AccountabilityViewService;
    trendTrackingService?: TrendTrackingService;
}

const previewCustomId = "post_recap";
const recapState = new Map<string, ReturnType<typeof buildRecapSummary>>();

const getStringOption = (
    options: unknown,
    name: string,
): string | undefined => {
    if (!Array.isArray(options)) return undefined;
    const found = options.find((option) => {
        if (typeof option !== "object" || option === null) return false;
        return (option as { name?: unknown }).name === name;
    }) as { value?: unknown } | undefined;
    return typeof found?.value === "string" ? found.value : undefined;
};

const makeStateKey = (reportCode: string, guildId: string): string =>
    `${reportCode}:${guildId}`;

export const registerCommands = async (
    appId: string,
    botToken: string,
): Promise<void> => {
    const commands = [
        { name: "health", description: "Check bot health", type: 1 },
        {
            name: "config",
            description: "Configure guild recap behavior",
            type: 1,
            options: [
                {
                    name: "game_family",
                    description: "Default game family",
                    type: 3,
                    required: false,
                    choices: [
                        { name: "retail", value: "retail" },
                        { name: "mop_classic", value: "mop_classic" },
                    ],
                },
                {
                    name: "compare_mode",
                    description: "Default compare mode",
                    type: 3,
                    required: false,
                    choices: [
                        { name: "character", value: "character" },
                        { name: "mixed", value: "mixed" },
                    ],
                },
                {
                    name: "visibility",
                    description: "Set accountability visibility",
                    type: 3,
                    required: false,
                    choices: [
                        { name: "off", value: "off" },
                        { name: "officers-only", value: "officers-only" },
                        { name: "shareable", value: "shareable" },
                    ],
                },
                {
                    name: "coaching_shareability",
                    description: "Default coaching shareability",
                    type: 3,
                    required: false,
                    choices: [
                        { name: "private", value: "private" },
                        { name: "shareable", value: "shareable" },
                    ],
                },
                {
                    name: "recap_post_mode",
                    description: "Default recap post mode",
                    type: 3,
                    required: false,
                    choices: [
                        { name: "preview-and-post", value: "preview-and-post" },
                        { name: "preview-only", value: "preview-only" },
                    ],
                },
            ],
        },
        {
            name: "report",
            description: "Report tools",
            type: 1,
            options: [
                {
                    name: "recap",
                    description:
                        "Generate a recap preview from a WCL report URL",
                    type: 1,
                    options: [
                        {
                            name: "url",
                            description: "WCL report URL",
                            type: 3,
                            required: true,
                        },
                    ],
                },
            ],
        },
        { name: "Analyze Log", type: 3 },
    ];

    const response = await fetch(
        `https://discord.com/api/v10/applications/${appId}/commands`,
        {
            method: "PUT",
            headers: {
                Authorization: `Bot ${botToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(commands),
        },
    );

    const text = await response.text();

    if (!response.ok) {
        throw new Error(
            `Discord command registration failed: ${response.status} ${response.statusText} - ${text}`,
        );
    }
};

export const handleInteraction = async (
    interaction: unknown,
    options: HandleOptions,
): Promise<unknown> => {
    const typedInteraction = interaction as {
        type?: number;
        guild_id?: string;
        data?: {
            name?: string;
            options?: unknown;
            custom_id?: string;
        };
    };

    if (typedInteraction.type === InteractionType.PING) {
        return { type: InteractionResponseType.PONG };
    }

    if (typedInteraction.type === InteractionType.APPLICATION_COMMAND) {
        if (typedInteraction.data?.name === "health") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "OK", flags: 64 },
            };
        }

        if (typedInteraction.data?.name === "config") {
            const guildId = typedInteraction.guild_id;
            if (!guildId) {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "Guild context is required for /config.",
                        flags: 64,
                    },
                };
            }

            const configUpdate = {
                defaultGameFamily: getStringOption(
                    typedInteraction.data.options,
                    "game_family",
                ),
                compareModeDefault: getStringOption(
                    typedInteraction.data.options,
                    "compare_mode",
                ),
                accountabilityVisibility: getStringOption(
                    typedInteraction.data.options,
                    "visibility",
                ),
                coachingShareabilityDefault: getStringOption(
                    typedInteraction.data.options,
                    "coaching_shareability",
                ),
                recapPostModeDefault: getStringOption(
                    typedInteraction.data.options,
                    "recap_post_mode",
                ),
            };

            const updateEntries = Object.entries(configUpdate).filter(
                ([, value]) => typeof value === "string",
            );
            const updateObject = Object.fromEntries(updateEntries);
            const saved = await options.guildConfigStore.saveGuildConfig(
                guildId,
                updateObject,
            );

            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content:
                        `Config saved for guild ${guildId}: ` +
                        `game_family=${saved.defaultGameFamily}, ` +
                        `compare_mode=${saved.compareModeDefault}, ` +
                        `visibility=${saved.accountabilityVisibility}, ` +
                        `coaching_shareability=${saved.coachingShareabilityDefault}, ` +
                        `recap_post_mode=${saved.recapPostModeDefault}`,
                    flags: 64,
                },
            };
        }

        if (typedInteraction.data?.name === "Analyze Log") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: "Use /report recap <url> to analyze this log.",
                    flags: 64,
                },
            };
        }

        if (typedInteraction.data?.name === "report") {
            const recap = (
                Array.isArray(typedInteraction.data.options)
                    ? typedInteraction.data.options
                    : []
            ).find(
                (o) =>
                    typeof o === "object" &&
                    o !== null &&
                    (o as { name?: unknown }).name === "recap",
            ) as { options?: unknown } | undefined;
            const url = getStringOption(recap?.options, "url");

            if (!url || typeof url !== "string") {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: "Missing URL", flags: 64 },
                };
            }

            const guildId = typedInteraction.guild_id ?? "dm";
            const guildConfig =
                await options.guildConfigStore.getGuildConfig(guildId);
            const report = await options.wclClient.fetchAndNormalizeReport(url);
            const previousPlayers = options.wclClient.findPreviousRaidSummaries
                ? await options.wclClient.findPreviousRaidSummaries(
                      guildId,
                      new Date(report.startTime),
                  )
                : [];
            const summary = buildRecapSummary(report, previousPlayers, {
                guildConfig,
            });

            recapState.set(makeStateKey(report.reportCode, guildId), summary);
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    flags: 64,
                    embeds: [
                        {
                            title: `Preview: ${summary.reportTitle}`,
                            description:
                                `Bosses killed: ${summary.bossesKilled} • ${summary.gameFamily}` +
                                ` • compare=${summary.compareModeUsed}`,
                        },
                    ],
                    components: [
                        {
                            type: 1,
                            components: [
                                {
                                    type: MessageComponentTypes.BUTTON,
                                    style: 1,
                                    custom_id: `${previewCustomId}:${report.reportCode}:${guildId}`,
                                    label: "Post Recap",
                                },
                            ],
                        },
                    ],
                },
            };
        }
    }

    if (typedInteraction.type === InteractionType.MESSAGE_COMPONENT) {
        const id = typedInteraction.data?.custom_id;
        if (typeof id === "string" && id.startsWith(previewCustomId)) {
            const [, reportCode, guildId] = id.split(":");
            if (!reportCode || !guildId) {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: "Invalid recap state key.", flags: 64 },
                };
            }

            const summary = recapState.get(makeStateKey(reportCode, guildId));
            if (!summary) {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: {
                        content: "Preview state expired. Re-run /report recap.",
                        flags: 64,
                    },
                };
            }

            await options.coachingViewService?.buildShareableCoachingView(
                reportCode,
            );
            await options.accountabilityViewService?.buildAccountabilityView(
                reportCode,
                summary.accountabilityVisibility,
            );
            if (options.trendTrackingService) {
                await options.trendTrackingService.recomputeTrendsForGuild(
                    guildId,
                );
            }

            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    embeds: [buildPublicRecapEmbed(summary)],
                },
            };
        }
    }

    return {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Unsupported interaction in MVP.", flags: 64 },
    };
};

export const buildPublicRecapEmbed = (
    summary: ReturnType<typeof buildRecapSummary>,
) => {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
        { name: "Report Date", value: summary.reportDateISO, inline: true },
        { name: "Game Family", value: summary.gameFamily, inline: true },
        {
            name: "Bosses Killed",
            value: String(summary.bossesKilled),
            inline: true,
        },
        {
            name: "Compare Mode",
            value: summary.compareModeUsed,
            inline: true,
        },
        {
            name: "Accountability",
            value: summary.accountabilityVisibility,
            inline: true,
        },
    ];
    if (summary.zoneName)
        fields.push({
            name: "Raid/Zone",
            value: summary.zoneName,
            inline: true,
        });
    if (summary.bestSingleBossParse)
        fields.push({
            name: "Best Single-Boss Parse",
            value: `${summary.bestSingleBossParse.playerName} (${summary.bestSingleBossParse.value.toFixed(1)})`,
        });
    if (summary.bestAverageParse)
        fields.push({
            name: "Best Average Parse",
            value: `${summary.bestAverageParse.playerName} (${summary.bestAverageParse.value.toFixed(1)})`,
        });
    if (summary.bestExecution)
        fields.push({
            name: "Best Execution",
            value: `${summary.bestExecution.playerName} (${summary.bestExecution.value.toFixed(1)})`,
        });
    if (summary.mostImprovedPlayer)
        fields.push({
            name: "Most Improved",
            value: `${summary.mostImprovedPlayer.playerName} (+${summary.mostImprovedPlayer.delta.toFixed(1)})`,
        });

    fields.push({ name: "Team Note", value: summary.teamNote });

    return {
        title: summary.reportTitle,
        fields,
    };
};
