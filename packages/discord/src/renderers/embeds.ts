import { MessageComponentTypes } from "discord-interactions";
import type { RecapSummary } from "../types.js";
import type { RecapRenderModel } from "./recap-domain.js";
import { toRecapRenderModel } from "./recap-domain.js";

const RECAP_COMPONENT_PREFIX = "recap:v1";
const POST_RECAP_ACTION = "post";
const EPHEMERAL_MESSAGE_FLAG = 64;

type RecapMetric = "DPS" | "HPS" | "DTPS";
const toMetricLabel = (metricLabel?: string, metric?: string): RecapMetric | undefined => {
    const candidate = metricLabel?.trim().toUpperCase() ?? metric?.trim().toUpperCase();
    return candidate === "DPS" || candidate === "HPS" || candidate === "DTPS" ? candidate : undefined;
};
const getMetricIcon = (metricLabel?: string, metric?: string): string | undefined => {
    const metricValue = toMetricLabel(metricLabel, metric);
    if (metricValue === "DPS") return "⚔️";
    if (metricValue === "HPS") return "💚";
    if (metricValue === "DTPS") return "🛡️";
    return undefined;
};
const formatCompactNumber = (value: number): string =>
    new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
const formatParseHighlightRow = (entry: RecapSummary["bestPlayerParses"][number]): string => {
    const parseValue = Number.isInteger(entry.parse) ? entry.parse.toFixed(0) : entry.parse.toFixed(1);
    const metricLabel = toMetricLabel(entry.metricLabel, entry.metric);
    const metricIcon = getMetricIcon(entry.metricLabel, entry.metric);
    const amountSection = typeof entry.amount === "number" ? ` · **${formatCompactNumber(entry.amount)}${metricLabel ? ` ${metricLabel}` : ""}**` : "";
    const classSpec = entry.classSpecLabel ?? [entry.specName, entry.className].filter((value): value is string => Boolean(value)).join(" ");
    const classSpecSection = classSpec ? ` · ${classSpec}` : "";
    return `${metricIcon ? `${metricIcon} ` : ""}**${entry.playerName}** **${parseValue}**${amountSection}${classSpecSection}`;
};
const formatCompactParseRow = (playerName: string, value: number, metric: string): string =>
    `${getMetricIcon(undefined, metric) ? `${getMetricIcon(undefined, metric)} ` : ""}**${playerName}** **${value.toFixed(1)}** (${metric})`;
const formatRankingLine = (labelIcon: string, label: string, playerName: string, value: number, metric: string, bossName?: string): string =>
    `${labelIcon} ${label}: **${playerName} ${value.toFixed(1)} ${metric}**${bossName ? ` (${bossName})` : ""}`;
const formatTotalLine = (label: string, value: string | number, icon?: string, emphasizeLabel = false): string =>
    icon ? `${icon} ${emphasizeLabel ? `**${label}:**` : `${label}:`} ${value}` : `${emphasizeLabel ? `**${label}:**` : `${label}:`} ${value}`;
const formatTopStatRows = (entries: Array<{ playerName: string; value: number; classSpecLabel?: string }>, formatter: (value: number) => string): string =>
    entries.slice(0, 3).map((entry, index) => `${index + 1}. **${entry.playerName}** ${formatter(entry.value)}${entry.classSpecLabel ? ` · ${entry.classSpecLabel}` : ""}`).join("\n");

export const makeRecapComponentCustomId = (action: string, reportCode: string, guildId: string): string =>
    `${RECAP_COMPONENT_PREFIX}:${action}:${reportCode}:${guildId}`;

export const parseRecapComponentCustomId = (customId: string): { action: string; reportCode: string; guildId: string } | undefined => {
    const [prefix, version, action, reportCode, guildId] = customId.split(":");
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
    embeds: [{
        title: `Preview: ${model.outcome.titleLine}`,
        description: [
            model.outcome.secondaryLine,
            `Raid Duration: ${model.outcome.killTimeLabel} (${model.outcome.pullCount} Pulls)`,
            `Date: ${model.outcome.reportDateLabel}`,
            model.performance.bestPlayerParses[0]
                ? `Best Parse: ${getMetricIcon(model.performance.bestPlayerParses[0].metricLabel, model.performance.bestPlayerParses[0].metric) ?? "⭐"} ${model.performance.bestPlayerParses[0].playerName} (${model.performance.bestPlayerParses[0].parse.toFixed(1)})`
                : undefined,
        ].filter((line): line is string => Boolean(line)).join("\n"),
    }],
    components: [{ type: 1, components: [{ type: MessageComponentTypes.BUTTON, style: 1, custom_id: makeRecapComponentCustomId(POST_RECAP_ACTION, reportCode, guildId), label: "Post Recap" }] }],
});

export const buildRecapPreviewBody = (summary: RecapSummary, reportCode: string, guildId: string) =>
    buildRecapPreviewBodyFromModel(toRecapRenderModel(summary), reportCode, guildId);

export function buildPublicRecapEmbedFromModel(model: RecapRenderModel) {
    const spacerField = { name: "\u200B", value: "\u200B" };
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [{ name: "🛡️ Raid", value: [model.outcome.secondaryLine, `Raid Duration: ${model.outcome.killTimeLabel} (${model.outcome.pullCount} Pulls)`, `Date: ${model.outcome.reportDateLabel}`].filter((line): line is string => Boolean(line)).join("\n") }];
    let hasSecondarySection = false;
    const pushSection = (name: string, value: string): void => { if (hasSecondarySection) fields.push(spacerField); fields.push({ name, value }); hasSecondarySection = true; };
    if (model.outcome.bossHighlights.length > 0) pushSection("🏆 Boss Highlights", model.outcome.bossHighlights.slice(0, 4).map((entry) => `• **${entry.bossName}:** ${entry.text}`).join("\n"));
    const standoutLines = [
        model.performance.bestExecution ? `🎯 Best execution: **${model.performance.bestExecution.playerName} ${model.performance.bestExecution.value.toFixed(1)}**` : undefined,
        model.performance.mostImprovedPlayer ? `📈 Most improved: **${model.performance.mostImprovedPlayer.playerName} +${model.performance.mostImprovedPlayer.delta.toFixed(1)}**` : undefined,
    ].filter((line): line is string => Boolean(line));
    if (standoutLines.length > 0) pushSection("🌟 Standouts", standoutLines.join("\n"));
    if (model.performance.bestSingleBossParse || model.performance.bestAverageParse) {
        const rankingLines = [
            model.performance.bestSingleBossParse ? formatRankingLine("🥇", "Best single-boss parse", model.performance.bestSingleBossParse.playerName, model.performance.bestSingleBossParse.value, model.performance.bestSingleBossParse.metric, model.performance.bestSingleBossParse.bossName) : undefined,
            model.performance.bestAverageParse ? formatRankingLine("📊", "Best average parse", model.performance.bestAverageParse.playerName, model.performance.bestAverageParse.value, model.performance.bestAverageParse.metric) : undefined,
        ].filter((line): line is string => Boolean(line));
        pushSection("📈 Overall Rankings", rankingLines.join("\n"));
    }
    if (model.performance.bestPlayerParses.length > 0) pushSection("⭐ Best Player Parses", model.performance.bestPlayerParses.map((entry) => formatParseHighlightRow(entry)).join("\n"));
    if (model.performance.topOverallParsers.length > 0) pushSection("📊 Top Overall Parsers", model.performance.topOverallParsers.map((entry) => formatCompactParseRow(entry.playerName, entry.value, entry.metric)).join("\n"));
    if (model.performance.topOverallDamageParsers.length > 0) pushSection("⚔️ Top Overall Damage Parse", model.performance.topOverallDamageParsers.map((entry) => formatCompactParseRow(entry.playerName, entry.value, entry.metric)).join("\n"));
    if (model.performance.topOverallHealingParsers.length > 0) pushSection("💚 Top Overall Healing Parse", model.performance.topOverallHealingParsers.map((entry) => formatCompactParseRow(entry.playerName, entry.value, entry.metric)).join("\n"));
    if (model.outcome.raidSuperlatives.length > 0) pushSection("🏅 Raid Superlatives", model.outcome.raidSuperlatives.slice(0, 4).map((entry) => `• **${entry.label}:** ${entry.text}`).join("\n"));
    if (model.volume.topDamageDone.length > 0) pushSection("⚔️ Top Damage Done", formatTopStatRows(model.volume.topDamageDone, (value) => formatCompactNumber(value)));
    if (model.volume.topHealingDone.length > 0) pushSection("💚 Top Healing Done", formatTopStatRows(model.volume.topHealingDone, (value) => formatCompactNumber(value)));
    if (model.volume.topDamageTaken.length > 0) pushSection("🩸 Top Damage Taken", formatTopStatRows(model.volume.topDamageTaken, (value) => formatCompactNumber(value)));
    if (model.execution.topInterrupts.length > 0) pushSection("🛑 Top Interrupts", formatTopStatRows(model.execution.topInterrupts, (value) => value.toFixed(0)));
    if (model.execution.topDispels.length > 0) pushSection("✨ Top Dispels", formatTopStatRows(model.execution.topDispels, (value) => value.toFixed(0)));
    if (model.execution.topSurvivability.length > 0) pushSection("🛡️ Top Survivability", formatTopStatRows(model.execution.topSurvivability, (value) => value.toFixed(1)));
    const totalLines = [
        typeof model.outcome.totals.totalDeaths === "number" ? formatTotalLine("Total deaths", model.outcome.totals.totalDeaths, "☠️", true) : undefined,
        typeof model.outcome.totals.raidDamageTaken === "number" ? formatTotalLine("Raid damage taken", formatCompactNumber(model.outcome.totals.raidDamageTaken), "🩸", true) : undefined,
        typeof model.outcome.totals.dispels === "number" ? formatTotalLine("Dispels", model.outcome.totals.dispels, "✨", true) : undefined,
        typeof model.outcome.totals.battleRezzes === "number" ? formatTotalLine("Battle rezzes", model.outcome.totals.battleRezzes) : undefined,
        typeof model.outcome.totals.kicks === "number" ? formatTotalLine("Kicks", model.outcome.totals.kicks, "🛑", true) : undefined,
    ].filter((line): line is string => Boolean(line));
    if (totalLines.length > 0) pushSection("🧾 Totals", totalLines.join("\n"));
    pushSection("🔗 Report", model.outcome.reportLink);
    return { title: model.outcome.titleLine, fields };
}

export const buildPublicRecapEmbed = (summary: RecapSummary) =>
    buildPublicRecapEmbedFromModel(toRecapRenderModel(summary));
