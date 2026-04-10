import {
    asArray,
    asNumber,
    asObject,
    asString,
    defaultDebugWarn,
    parseUnknownJson,
} from "./common.js";
import type { DebugWarn } from "./common.js";
import type { TableDataType } from "../schema-enums.js";

export interface ParsedTableEntry {
    dataType: TableDataType;
    playerId?: number;
    playerName?: string;
    value: number;
}

const VALUE_KEY_BY_TYPE: Record<TableDataType, string[]> = {
    DamageDone: ["total", "amount", "value"],
    DamageTaken: ["total", "amount", "value"],
    Healing: ["total", "amount", "value"],
    Deaths: ["deaths", "amount", "total", "value"],
    Interrupts: ["interrupts", "amount", "total", "value"],
    Dispels: ["dispels", "total", "amount", "value"],
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

const getTableEntries = (
    payload: unknown,
    dataType: TableDataType,
    warn: DebugWarn,
): unknown[] => {
    const root = asObject(payload);
    if (!root) {
        const rows = asArray(payload) ?? [];
        if (rows.length === 0) {
            warn(`table parser (${dataType} payload): unrecognized payload shape`, {
                payload,
            });
        }
        return rows;
    }

    const data = asObject(root.data);
    const table = asObject(root.table);
    const details = asObject(root.details);

    const rows = [
        ...(asArray(root.entries) ?? []),
        ...(asArray(root.composition) ?? []),
        ...(asArray(root.data) ?? []),
        ...(asArray(data?.entries) ?? []),
        ...(asArray(data?.data) ?? []),
        ...(asArray(root.players) ?? []),
        ...(asArray(table?.entries) ?? []),
        ...(asArray(table?.data) ?? []),
        ...(asArray(details?.entries) ?? []),
    ];

    if (rows.length === 0) {
        warn(`table parser (${dataType} payload): unrecognized payload shape`, {
            payload,
        });
    }

    return rows;
};

export const parseTablePayload = (
    payload: unknown,
    dataType: TableDataType,
    warn: DebugWarn = defaultDebugWarn,
): ParsedTableEntry[] => {
    const parsed = parseUnknownJson(payload, warn, `table:${dataType}`);
    const rows = getTableEntries(parsed, dataType, warn);

    return rows.flatMap((row) => {
        const entry = asObject(row);
        if (!entry) return [];

        // WCL table rows vary across report types; probe multiple keys for totals and IDs.
        const value = findValue(entry, VALUE_KEY_BY_TYPE[dataType]);
        if (typeof value !== "number") {
            warn(`table parser (${dataType} payload): skipped malformed row`, {
                row: entry,
            });
            return [];
        }

        const playerId =
            asNumber(entry.id) ??
            asNumber(entry.playerID) ??
            asNumber(entry.playerId);
        const playerName = asString(entry.name) ?? asString(asObject(entry.actor)?.name);

        // Construct the entry object, only adding playerId and playerName when defined. exact
        // optional property types disallow explicitly assigning undefined to optional properties.
        const parsedEntry: ParsedTableEntry = {
            dataType,
            value,
            ...(typeof playerId === "number" ? { playerId } : {}),
            ...(playerName ? { playerName } : {}),
        };
        return [parsedEntry];
    });
};
