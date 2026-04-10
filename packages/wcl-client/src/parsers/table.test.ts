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
