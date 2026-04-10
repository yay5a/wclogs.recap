import { describe, expect, it, vi } from "vitest";
import { parseTablePayload, parseTablePayloadDetailed } from "./table.js";

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
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    players: [{ id: 3, name: "Survive", survivability: 97.5 }],
                    fights: [],
                    actortotals: [],
                    abilitytotals: [],
                },
            },
            "Survivability",
        );
        expect(parsed.entries[0]?.playerName).toBe("Survive");
        expect(parsed.entries[0]?.value).toBe(97.5);
    });
});
