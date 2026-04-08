import { describe, expect, it } from "vitest";
import { buildRecapSummary } from "./index.js";

describe("buildRecapSummary", () => {
    it("omits most improved when no prior data", () => {
        const summary = buildRecapSummary({
            reportCode: "abc",
            title: "Raid Night",
            startTime: Date.now(),
            endTime: Date.now(),
            gameFamily: "retail",
            fights: [
                { id: 1, name: "Boss", startTime: 0, endTime: 1, kill: true },
            ],
            players: [
                {
                    id: "1",
                    name: "A",
                    avgParse: 75,
                    bestParse: 90,
                    executionScore: 88,
                },
            ],
        });

        expect(summary.mostImprovedPlayer).toBeUndefined();
    });

    it("applies guild config defaults to summary", () => {
        const summary = buildRecapSummary(
            {
                reportCode: "abc",
                title: "Raid Night",
                startTime: Date.now(),
                endTime: Date.now(),
                gameFamily: "retail",
                fights: [],
                players: [],
            },
            [],
            {
                guildConfig: {
                    guildId: "g1",
                    defaultGameFamily: "mop_classic",
                    compareModeDefault: "mixed",
                    accountabilityVisibility: "officers-only",
                    coachingShareabilityDefault: "shareable",
                    recapPostModeDefault: "preview-only",
                },
            },
        );

        expect(summary.compareModeUsed).toBe("mixed");
        expect(summary.accountabilityVisibility).toBe("officers-only");
        expect(summary.coachingShareability).toBe("shareable");
        expect(summary.recapPostMode).toBe("preview-only");
    });
});
