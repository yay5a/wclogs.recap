import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseTablePayload, parseTablePayloadDetailed } from "./table.js";

const loadProbeFixture = (name: string): unknown => {
    const path = join(
        process.cwd(),
        "src",
        "fixtures",
        "probes",
        `${name}.abc123xyz4567890.fight-5.json`,
    );
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
};

const loadPublicFixture = (name: string): unknown => {
    const path = join(
        process.cwd(),
        "src",
        "fixtures",
        "probes",
        `${name}.v4apgdkyWQmrZ3q8.fight-46.json`,
    );
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
};

describe("table parser", () => {
    it("handles multiple table payload variants", () => {
        const damage = parseTablePayload(
            { entries: [{ id: 1, name: "Alyra", total: 12345 }] },
            "DamageDone",
        );
        const healing = parseTablePayload(
            { data: { entries: [{ id: 2, name: "Healz", total: 67890 }] } },
            "Healing",
        );
        const deaths = parseTablePayload(
            { data: [{ id: 1, name: "Alyra", deaths: 2 }] },
            "Deaths",
        );

        expect(damage[0]?.value).toBe(12345);
        expect(healing[0]?.value).toBe(67890);
        expect(deaths[0]?.value).toBe(2);
    });

    it("returns empty rows and warns for null sections", () => {
        const warn = vi.fn();
        const entries = parseTablePayload(null, "Healing", warn);
        expect(entries).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it("treats explicit empty entries as valid empty payloads", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            { data: { entries: [] } },
            "Deaths",
            warn,
        );
        expect(parsed.entries).toEqual([]);
        expect(parsed.isValidEmpty).toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it("supports survivability payload shape", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadProbeFixture("survivability"),
            "Survivability",
            warn,
        );
        expect(parsed.entries[0]?.playerName).toBe("Alyra");
        expect(parsed.entries[0]?.value).toBe(98.2);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses deaths event rows as one death each", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadProbeFixture("deaths"),
            "Deaths",
            warn,
        );

        expect(parsed.entries).toHaveLength(2);
        expect(parsed.entries.reduce((total, row) => total + row.value, 0)).toBe(2);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses public deaths fixture event rows", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadPublicFixture("deaths"),
            "Deaths",
            warn,
        );
        expect(parsed.entries).toHaveLength(4);
        expect(parsed.entries.reduce((total, row) => total + row.value, 0)).toBe(4);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses dispels totals from nested details rows", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadProbeFixture("dispels"),
            "Dispels",
            warn,
        );

        expect(parsed.entries).toEqual([
            { dataType: "Dispels", playerId: 101, playerName: "Alyra", value: 4 },
            { dataType: "Dispels", playerId: 102, playerName: "Bronn", value: 5 },
        ]);
        expect(parsed.entries.reduce((total, row) => total + row.value, 0)).toBe(9);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses interrupts totals from nested details rows", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadProbeFixture("interrupts"),
            "Interrupts",
            warn,
        );

        expect(parsed.entries).toEqual([
            { dataType: "Interrupts", playerId: 101, playerName: "Alyra", value: 3 },
            { dataType: "Interrupts", playerId: 109, playerName: "Kickz", value: 5 },
        ]);
        expect(parsed.entries.reduce((total, row) => total + row.value, 0)).toBe(8);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses public dispels nested entries details totals", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadPublicFixture("dispels"),
            "Dispels",
            warn,
        );
        expect(parsed.entries.reduce((total, row) => total + row.value, 0)).toBe(1);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses public interrupts nested entries details totals", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadPublicFixture("interrupts"),
            "Interrupts",
            warn,
        );
        expect(parsed.entries.reduce((total, row) => total + row.value, 0)).toBe(3);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses wrapped dispels rows from data.entries[].entries[].details[] shape", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    entries: [
                        {
                            entries: [
                                {
                                    details: [
                                        { id: 7, name: "Priest", total: 1 },
                                        { id: 9, name: "Monk", total: 2 },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
            "Dispels",
            warn,
        );

        expect(parsed.entries).toEqual([
            { dataType: "Dispels", playerId: 7, playerName: "Priest", value: 1 },
            { dataType: "Dispels", playerId: 9, playerName: "Monk", value: 2 },
        ]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses wrapped interrupts rows from data.entries[].entries[].details[] shape", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    entries: [
                        {
                            entries: [
                                {
                                    details: [
                                        { id: 4, name: "Shaman", total: 3 },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            },
            "Interrupts",
            warn,
        );

        expect(parsed.entries).toEqual([
            { dataType: "Interrupts", playerId: 4, playerName: "Shaman", value: 3 },
        ]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("accepts survivability metadata-only rows without malformed warnings", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    players: [{ id: 3, name: "Survive" }],
                    fights: [{ id: 5 }],
                    actortotals: [{ id: 3, name: "Survive", class: "MAGE" }],
                    abilitytotals: [],
                },
            },
            "Survivability",
            warn,
        );

        expect(parsed.entries).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
    });
});
