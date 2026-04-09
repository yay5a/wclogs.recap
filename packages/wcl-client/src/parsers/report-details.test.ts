import { describe, expect, it, vi } from "vitest";
import { parsePlayerDetailsPayload } from "./report-details.js";

describe("playerDetails parser", () => {
    it("extracts class/spec/role from playerDetails payload", () => {
        const entries = parsePlayerDetailsPayload({
            players: {
                data: [
                    {
                        name: "Alyra",
                        class: "Paladin",
                        spec: "Holy",
                        role: "Healer",
                    },
                ],
            },
        });

        expect(entries[0]).toMatchObject({
            name: "Alyra",
            className: "Paladin",
            specName: "Holy",
            role: "Healer",
        });
    });

    it("does not throw on absent fields and logs warning", () => {
        const warn = vi.fn();
        expect(() => parsePlayerDetailsPayload({}, warn)).not.toThrow();
        const entries = parsePlayerDetailsPayload({}, warn);
        expect(entries).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });
});
