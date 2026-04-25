import { describe, expect, it } from "vitest";
import {
    getBossEncounterId,
    parseFightSummaries,
    pickEncounterSummaryFight,
    sumTableValues,
    summarizeBossTables,
} from "./report-mappers.js";

describe("report mappers", () => {
    it("parseFightSummaries parses valid fights and omits invalid rows", () => {
        const fights = parseFightSummaries({
            fights: [
                {
                    id: 1,
                    encounterID: 100,
                    name: "Boss",
                    startTime: 10,
                    endTime: 20,
                    kill: true,
                    phaseTransitions: [{ id: 2, startTime: 15 }],
                },
                { id: "bad" },
            ],
        });

        expect(fights).toHaveLength(1);
        expect(fights[0]).toMatchObject({ id: 1, encounterID: 100, kill: true });
    });

    it("getBossEncounterId falls back to originalEncounterID", () => {
        expect(
            getBossEncounterId({
                id: 1,
                encounterID: 0,
                originalEncounterID: 200,
                name: "Trash",
                startTime: 0,
                endTime: 1,
                kill: false,
                phaseTransitions: [],
            }),
        ).toBe(200);
    });

    it("pickEncounterSummaryFight prefers recent kill", () => {
        const picked = pickEncounterSummaryFight([
            {
                id: 1,
                encounterID: 100,
                name: "Boss",
                startTime: 0,
                endTime: 10,
                kill: true,
                phaseTransitions: [],
            },
            {
                id: 2,
                encounterID: 100,
                name: "Boss",
                startTime: 20,
                endTime: 40,
                kill: true,
                phaseTransitions: [],
            },
        ]);

        expect(picked?.id).toBe(2);
    });

    it("sumTableValues sums values and tolerates undefined", () => {
        expect(sumTableValues([{ value: 1 }, { value: 2 }, {}])).toBe(3);
        expect(sumTableValues(undefined)).toBeUndefined();
    });

    it("summarizeBossTables maps top rows into performance fields", () => {
        const summary = summarizeBossTables(
            "Boss",
            10,
            {
                DamageDone: [{ playerName: "A", value: 100 }],
                Healing: [{ playerName: "B", value: 50 }],
                Deaths: [{ playerName: "C", value: 2 }],
            },
            {
                scope: "boss",
                metric: "bestPercent",
                value: 99,
            },
        );

        expect(summary.topDamage?.playerName).toBe("A");
        expect(summary.topHealing?.playerName).toBe("B");
        expect(summary.mostDeaths?.value).toBe(2);
        expect(summary.topParse?.value).toBe(99);
    });
});
