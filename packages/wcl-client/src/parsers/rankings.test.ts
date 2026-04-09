import { describe, expect, it, vi } from "vitest";
import {
    parseBossRankingsPayload,
    parseReportRankingsPayload,
} from "./rankings.js";

describe("rankings parsers", () => {
    it("parses report-wide ranking shapes and does not throw", () => {
        const warn = vi.fn();
        const entries = parseReportRankingsPayload(
            JSON.stringify({
                data: [
                    { name: "Alyra", bestPerformanceAverage: 95.4, rank: 1 },
                    { player: { id: 2, name: "Borin", role: "Healer" }, percentile: 90.1 },
                ],
            }),
            warn,
        );

        expect(entries).toHaveLength(2);
        expect(entries[0]?.playerName).toBe("Alyra");
        expect(entries[1]?.playerId).toBe(2);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses boss-scoped entries with fallback context", () => {
        const entries = parseBossRankingsPayload(
            { rankings: [{ name: "Alyra", bestPercent: 88.8 }] },
            { bossName: "Boss One", fightId: 12 },
        );

        expect(entries[0]?.bossName).toBe("Boss One");
        expect(entries[0]?.fightId).toBe(12);
        expect(entries[0]?.scope).toBe("boss");
    });

    it("returns empty arrays and emits warnings for invalid shape", () => {
        const warn = vi.fn();
        expect(() => parseReportRankingsPayload("not-json", warn)).not.toThrow();
        const entries = parseReportRankingsPayload("not-json", warn);
        expect(entries).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });
});
