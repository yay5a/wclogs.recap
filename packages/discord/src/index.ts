import {
    InteractionResponseType,
    InteractionType,
    MessageComponentTypes,
} from "discord-interactions";
import { buildRecapSummary } from "@wcl/domain";
import { WclClient } from "@wcl/wcl-client";

interface HandleOptions {
    wclClient: WclClient;
}

const previewCustomId = "post_recap";

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

    await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
        method: "PUT",
        headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
    });
};

export const handleInteraction = async (
    interaction: any,
    options: HandleOptions,
): Promise<any> => {
    if (interaction.type === InteractionType.PING) {
        return { type: InteractionResponseType.PONG };
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        if (interaction.data.name === "health") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "OK", flags: 64 },
            };
        }

        if (interaction.data.name === "config") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: { content: "Config saved (MVP placeholder).", flags: 64 },
            };
        }

        if (interaction.data.name === "Analyze Log") {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    content: "Use /report recap <url> to analyze this log.",
                    flags: 64,
                },
            };
        }

        if (interaction.data.name === "report") {
            const recap = interaction.data.options?.find(
                (o: any) => o.name === "recap",
            );
            const url = recap?.options?.find(
                (o: any) => o.name === "url",
            )?.value;
            if (!url || typeof url !== "string") {
                return {
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: "Missing URL", flags: 64 },
                };
            }

            const report = await options.wclClient.fetchAndNormalizeReport(url);
            const summary = buildRecapSummary(report);

            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    flags: 64,
                    embeds: [
                        {
                            title: `Preview: ${summary.reportTitle}`,
                            description: `Bosses killed: ${summary.bossesKilled} • ${summary.gameFamily}`,
                        },
                    ],
                    components: [
                        {
                            type: 1,
                            components: [
                                {
                                    type: MessageComponentTypes.BUTTON,
                                    style: 1,
                                    custom_id: `${previewCustomId}:${report.reportCode}`,
                                    label: "Post Recap",
                                },
                            ],
                        },
                    ],
                },
            };
        }
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
        const id: string = interaction.data.custom_id;
        if (id.startsWith(previewCustomId)) {
            return {
                type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                data: {
                    embeds: [
                        {
                            title: "Raid Recap",
                            description: "Recap posted from preview (MVP).",
                        },
                    ],
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
