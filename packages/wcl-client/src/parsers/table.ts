import { asNumber, asObject, asString, defaultDebugWarn, parseUnknownJson, type DebugWarn } from "./common.js";

export type TableDataType =
    | "DamageDone"
    | "Healing"
    | "Deaths"
    | "Interrupts"
    | "Survivability"
    | "Summary";

export interface ParsedTableEntry {
    dataType: TableDataType;
    playerId?: number;
    playerName?: string;
    value: number;
}

const VALUE_KEY_BY_TYPE: Record<TableDataType, string[]> = {
    DamageDone: ["total", "amount", "value"],
    Healing: ["total", "amount", "value"],
    Deaths: ["deaths", "amount", "total", "value"],
    Interrupts: ["interrupts", "amount", "total", "value"],
    Survivability: ["survivability", "value", "percentile"],
    Summary: ["value", "amount", "total"],
};

const findValue = (entry: Record<string, unknown>, keys: string[]): number | undefined => {
    for (const key of keys) {
        const value = asNumber(entry[key]);
        if (typeof value === "number") return value;
    }
    return undefined;
};

export const parseTablePayload = (
    payload: unknown,
    dataType: TableDataType,
    warn: DebugWarn = defaultDebugWarn,
): ParsedTableEntry[] => {
    const parsed = parseUnknownJson(payload, warn, `table:${dataType}`);
    const root = asObject(parsed);
    if (!root) {
        warn(`table parser: invalid root for ${dataType}`, { payload });
        return [];
    }

    const rows = [
        ...(Array.isArray(root.entries) ? root.entries : []),
        ...(Array.isArray(root.composition) ? root.composition : []),
        ...(Array.isArray(root.data) ? root.data : []),
    ];

    if (rows.length === 0) {
        warn(`table parser: no rows for ${dataType}`, { payload: parsed });
    }

    return rows.flatMap((row) => {
        const entry = asObject(row);
        if (!entry) return [];

        // WCL table rows vary across report types; probe multiple keys for totals and IDs.
        const value = findValue(entry, VALUE_KEY_BY_TYPE[dataType]);
        if (typeof value !== "number") return [];

        return [
            {
                dataType,
                playerId: asNumber(entry.id) ?? asNumber(entry.playerID) ?? asNumber(entry.playerId),
                playerName: asString(entry.name) ?? asString(asObject(entry.actor)?.name),
                value,
            },
        ];
    });
};
