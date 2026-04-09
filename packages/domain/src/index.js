export const defaultGuildConfigFor = (guildId) => ({
    guildId,
    defaultGameFamily: "retail",
    compareModeDefault: "character",
    accountabilityVisibility: "off",
    coachingShareabilityDefault: "private",
    recapPostModeDefault: "preview-and-post",
});
export const deriveDeterministicTeamNote = (bossesKilled) => {
    if (bossesKilled >= 8)
        return "Team note: Full-clear momentum is strong; capture callout clips.";
    if (bossesKilled >= 4)
        return "Team note: Progress is stable; set one focus mechanic for next raid.";
    return "Team note: Early progression week; prioritize clean mechanic reps.";
};
export const buildRecapSummary = (report, previousPlayers, options) => {
    const killed = report.fights.filter((f) => f.kill).length;
    const byParse = [...report.players]
        .filter((p) => typeof p.bestParse === "number")
        .sort((a, b) => (b.bestParse ?? 0) - (a.bestParse ?? 0));
    const byAvg = [...report.players]
        .filter((p) => typeof p.avgParse === "number")
        .sort((a, b) => (b.avgParse ?? 0) - (a.avgParse ?? 0));
    const byExec = [...report.players]
        .filter((p) => typeof p.executionScore === "number")
        .sort((a, b) => (b.executionScore ?? 0) - (a.executionScore ?? 0));
    const previousByName = new Map((previousPlayers ?? []).map((p) => [p.name, p]));
    const improved = report.players
        .map((p) => {
        const prev = previousByName.get(p.name);
        if (!prev ||
            typeof p.avgParse !== "number" ||
            typeof prev.avgParse !== "number")
            return undefined;
        return { playerName: p.name, delta: p.avgParse - prev.avgParse };
    })
        .filter((x) => Boolean(x))
        .sort((a, b) => b.delta - a.delta);
    const guildConfig = options?.guildConfig;
    const summary = {
        reportTitle: report.title,
        reportDateISO: new Date(report.startTime).toISOString(),
        gameFamily: report.gameFamily,
        bossesKilled: killed,
        compareModeUsed: guildConfig?.compareModeDefault ?? "character",
        accountabilityVisibility: guildConfig?.accountabilityVisibility ?? "off",
        coachingShareability: guildConfig?.coachingShareabilityDefault ?? "private",
        recapPostMode: guildConfig?.recapPostModeDefault ?? "preview-and-post",
        teamNote: deriveDeterministicTeamNote(killed),
    };
    if (report.zoneName)
        summary.zoneName = report.zoneName;
    if (byParse[0])
        summary.bestSingleBossParse = {
            playerName: byParse[0].name,
            value: byParse[0].bestParse ?? 0,
        };
    if (byAvg[0])
        summary.bestAverageParse = {
            playerName: byAvg[0].name,
            value: byAvg[0].avgParse ?? 0,
        };
    if (byExec[0])
        summary.bestExecution = {
            playerName: byExec[0].name,
            value: byExec[0].executionScore ?? 0,
        };
    if (improved[0] && improved[0].delta > 0)
        summary.mostImprovedPlayer = improved[0];
    return summary;
};
//# sourceMappingURL=index.js.map