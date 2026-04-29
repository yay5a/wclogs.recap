import type { RecapSummary } from "../types.js";

export interface Outcome {
    titleLine: string;
    secondaryLine: string;
    killTimeLabel: string;
    pullCount: number;
    reportDateLabel: string;
    reportLink: string;
    bossHighlights: RecapSummary["bossHighlights"];
    raidSuperlatives: RecapSummary["raidSuperlatives"];
    totals: RecapSummary["totals"];
}

export interface Performance {
    bestExecution?: RecapSummary["bestExecution"];
    mostImprovedPlayer?: RecapSummary["mostImprovedPlayer"];
    highestParses: RecapSummary["highestParses"];
    topDamageAverageParses: RecapSummary["topDamageAverageParses"];
    topHealingAverageParses: RecapSummary["topHealingAverageParses"];
}

export interface Volume {
    topDamageDone: RecapSummary["topDamageDone"];
    topHealingDone: RecapSummary["topHealingDone"];
    topDamageTaken: RecapSummary["topDamageTaken"];
}

export interface Execution {
    topInterrupts: RecapSummary["topInterrupts"];
    topDispels: RecapSummary["topDispels"];
    topSurvivability: RecapSummary["topSurvivability"];
}

export interface RecapRenderModel {
    outcome: Outcome;
    performance: Performance;
    volume: Volume;
    execution: Execution;
}

export const toRecapRenderModel = (summary: RecapSummary): RecapRenderModel => ({
    outcome: {
        titleLine: summary.titleLine,
        secondaryLine: summary.secondaryLine,
        killTimeLabel: summary.killTimeLabel,
        pullCount: summary.pullCount,
        reportDateLabel: summary.reportDateLabel,
        reportLink: summary.reportLink,
        bossHighlights: summary.bossHighlights,
        raidSuperlatives: summary.raidSuperlatives,
        totals: summary.totals,
    },
    performance: {
        bestExecution: summary.bestExecution,
        mostImprovedPlayer: summary.mostImprovedPlayer,
        highestParses: summary.highestParses,
        topDamageAverageParses: summary.topDamageAverageParses,
        topHealingAverageParses: summary.topHealingAverageParses,
    },
    volume: {
        topDamageDone: summary.topDamageDone,
        topHealingDone: summary.topHealingDone,
        topDamageTaken: summary.topDamageTaken,
    },
    execution: {
        topInterrupts: summary.topInterrupts,
        topDispels: summary.topDispels,
        topSurvivability: summary.topSurvivability,
    },
});
