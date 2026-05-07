import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseTablePayload, parseTablePayloadDetailed } from "./table.js";
import type { TableDataType } from "../schema-enums.js";

const PROBE_ROOT = "/home/_yaysa/dev/wcl-probes/probes";
const REPORT_WIDE_KILLS_PROBE_DIR = join(
    PROBE_ROOT,
    "cNxRty7DWgPBLQT.table.report-wide.kills",
);

const loadReportWideKillsProbePayload = (dataType: TableDataType): unknown => {
    const raw = readFileSync(
        join(
            REPORT_WIDE_KILLS_PROBE_DIR,
            `table.cNxRty7DWgPBLQT9.report-wide.kills.${dataType}.debug.json`,
        ),
        "utf8",
    );
    const parsed = JSON.parse(raw) as { payload?: unknown };
    return parsed.payload;
};

describe("table parser", () => {
    it("handles multiple table payload variants", () => {
        const damage = parseTablePayload(
            { entries: [{ id: 1, name: "Alyra", total: 12345, activeTime: 1000 }] },
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
        expect(damage[0]?.activeTimeMs).toBe(1000);
        expect(healing[0]?.value).toBe(67890);
        expect(deaths[0]?.value).toBe(2);
    });

    it("returns empty rows silently for absent optional sections", () => {
        const warn = vi.fn();
        const entries = parseTablePayload(null, "Healing", warn);
        expect(entries).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("warns for malformed present sections", () => {
        const warn = vi.fn();
        const entries = parseTablePayload(
            {
                totalTime: 100,
                privatePlayerName: "Private Player",
                access_token: "private-access-token",
            },
            "Healing",
            warn,
        );
        expect(entries).toEqual([]);
        expect(warn).toHaveBeenCalled();
        const [, context] = warn.mock.calls[0] ?? [];
        expect(context).toEqual({ payloadShape: { type: "object", keyCount: 3 } });
        expect(JSON.stringify(context)).not.toContain("Private Player");
        expect(JSON.stringify(context)).not.toContain("private-access-token");
    });

    it("warns for malformed rows without exposing row contents", () => {
        const warn = vi.fn();
        const entries = parseTablePayload(
            { entries: [{ name: "Private Player", valueText: "hidden" }] },
            "Healing",
            warn,
        );

        expect(entries).toEqual([]);
        expect(warn).toHaveBeenCalled();
        const [, context] = warn.mock.calls[0] ?? [];
        expect(context).toEqual({ rowShape: { type: "object", keyCount: 2 } });
        expect(JSON.stringify(context)).not.toContain("Private Player");
        expect(JSON.stringify(context)).not.toContain("hidden");
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
            {
                data: {
                    actortotals: [
                        { id: 101, name: "Alyra", survivability: 98.2 },
                    ],
                },
            },
            "Survivability",
            warn,
        );
        expect(parsed.entries[0]?.playerName).toBe("Alyra");
        expect(parsed.entries[0]?.value).toBe(98.2);
        expect(warn).not.toHaveBeenCalled();
    });

    it("omits survivability rows when payload exposes metadata totals only", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    players: [{ id: 101, name: "Alyra" }],
                    fights: [{ id: 46 }],
                    actortotals: [{ id: 101, name: "Alyra", class: "PALADIN" }],
                    abilitytotals: [],
                },
            },
            "Survivability",
            warn,
        );
        expect(parsed.entries).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses deaths event rows as one death each", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                entries: [
                    { id: 101, name: "Alyra", timestamp: 1000, overkill: 12 },
                    {
                        id: 102,
                        name: "Bronn",
                        timestamp: 2000,
                        killingBlow: { name: "Lightning" },
                    },
                ],
            },
            "Deaths",
            warn,
        );

        expect(parsed.entries).toHaveLength(2);
        expect(
            parsed.entries.reduce((total, row) => total + row.value, 0),
        ).toBe(2);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses public deaths fixture event rows", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    entries: [
                        {
                            id: 1,
                            name: "One",
                            timestamp: 1000,
                            deathWindow: [],
                        },
                        { id: 2, name: "Two", timestamp: 2000, events: [] },
                        { id: 3, name: "Three", timestamp: 3000, overkill: 1 },
                        {
                            id: 4,
                            name: "Four",
                            timestamp: 4000,
                            killingBlow: { name: "Static Shock" },
                        },
                    ],
                },
            },
            "Deaths",
            warn,
        );
        expect(parsed.entries).toHaveLength(4);
        expect(
            parsed.entries.reduce((total, row) => total + row.value, 0),
        ).toBe(4);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses dispels totals from nested details rows", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                entries: [
                    {
                        details: [
                            { id: 101, name: "Alyra", total: 4 },
                            { id: 102, name: "Bronn", total: 5 },
                        ],
                    },
                ],
            },
            "Dispels",
            warn,
        );

        expect(parsed.entries).toEqual([
            {
                dataType: "Dispels",
                playerId: 101,
                playerName: "Alyra",
                value: 4,
            },
            {
                dataType: "Dispels",
                playerId: 102,
                playerName: "Bronn",
                value: 5,
            },
        ]);
        expect(
            parsed.entries.reduce((total, row) => total + row.value, 0),
        ).toBe(9);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses interrupts totals from nested details rows", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                entries: [
                    {
                        details: [
                            { id: 101, name: "Alyra", total: 3 },
                            { id: 109, name: "Kickz", total: 5 },
                        ],
                    },
                ],
            },
            "Interrupts",
            warn,
        );

        expect(parsed.entries).toEqual([
            {
                dataType: "Interrupts",
                playerId: 101,
                playerName: "Alyra",
                value: 3,
            },
            {
                dataType: "Interrupts",
                playerId: 109,
                playerName: "Kickz",
                value: 5,
            },
        ]);
        expect(
            parsed.entries.reduce((total, row) => total + row.value, 0),
        ).toBe(8);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses public dispels nested entries details totals", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    entries: [
                        {
                            entries: [
                                {
                                    details: [
                                        { id: 3, name: "Dispeller", total: 1 },
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
        expect(
            parsed.entries.reduce((total, row) => total + row.value, 0),
        ).toBe(1);
        expect(warn).not.toHaveBeenCalled();
    });

    it("parses public interrupts nested entries details totals", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            {
                data: {
                    entries: [
                        {
                            entries: [
                                {
                                    details: [
                                        { id: 7, name: "Kicker", total: 3 },
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
        expect(
            parsed.entries.reduce((total, row) => total + row.value, 0),
        ).toBe(3);
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
            {
                dataType: "Dispels",
                playerId: 7,
                playerName: "Priest",
                value: 1,
            },
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
            {
                dataType: "Interrupts",
                playerId: 4,
                playerName: "Shaman",
                value: 3,
            },
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

const describeProbeFixtures = existsSync(REPORT_WIDE_KILLS_PROBE_DIR)
    ? describe
    : describe.skip;

describeProbeFixtures("report-wide kill probe payloads", () => {
    it.each([
        ["DamageDone", 13],
        ["DamageTaken", 11],
        ["Healing", 10],
    ] satisfies Array<[TableDataType, number]>)(
        "parses %s direct player totals from probed payloads",
        (dataType, expectedRows) => {
            const warn = vi.fn();
            const parsed = parseTablePayloadDetailed(
                loadReportWideKillsProbePayload(dataType),
                dataType,
                warn,
            );

            expect(parsed.entries).toHaveLength(expectedRows);
            expect(parsed.entries[0]?.value).toBeGreaterThan(0);
            expect(parsed.entries[0]?.playerName).toBeTruthy();
            expect(warn).not.toHaveBeenCalled();
        },
    );

    it("parses death event rows from probed payloads", () => {
        const warn = vi.fn();
        const parsed = parseTablePayloadDetailed(
            loadReportWideKillsProbePayload("Deaths"),
            "Deaths",
            warn,
        );

        expect(parsed.entries).toHaveLength(19);
        expect(
            parsed.entries.reduce((total, row) => total + row.value, 0),
        ).toBe(19);
        expect(warn).not.toHaveBeenCalled();
    });

    it.each([
        ["Dispels", 8],
        ["Interrupts", 9],
    ] satisfies Array<[TableDataType, number]>)(
        "parses %s nested detail totals from probed payloads",
        (dataType, minimumTotal) => {
            const warn = vi.fn();
            const parsed = parseTablePayloadDetailed(
                loadReportWideKillsProbePayload(dataType),
                dataType,
                warn,
            );

            expect(parsed.entries.length).toBeGreaterThan(0);
            expect(
                parsed.entries.reduce((total, row) => total + row.value, 0),
            ).toBeGreaterThanOrEqual(minimumTotal);
            expect(warn).not.toHaveBeenCalled();
        },
    );
});
