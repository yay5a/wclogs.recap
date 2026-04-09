import { describe, expect, it, vi } from "vitest";
import { parseTablePayload } from "./table.js";

describe("table parser", () => {
    it("handles multiple table payload variants", () => {
        const damage = parseTablePayload(
            { entries: [{ id: 1, name: "Alyra", total: 12345 }] },
            "DamageDone",
        );
        const deaths = parseTablePayload(
            { data: [{ id: 1, name: "Alyra", deaths: 2 }] },
            "Deaths",
        );

        expect(damage[0]?.value).toBe(12345);
        expect(deaths[0]?.value).toBe(2);
    });

    it("returns empty rows and warns for null sections", () => {
        const warn = vi.fn();
        const entries = parseTablePayload(null, "Healing", warn);
        expect(entries).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });
});
