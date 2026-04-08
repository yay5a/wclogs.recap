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
});
