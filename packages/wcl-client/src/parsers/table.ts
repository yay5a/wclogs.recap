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

export const parseTablePayload = (
    payload: unknown,
    dataType: TableDataType,
    warn: DebugWarn = defaultDebugWarn,
): ParsedTableEntry[] => {
    const parsed = parseUnknownJson(payload, warn, `table:${dataType}`);
    const root = asObject(parsed);
    const rows = root
        ? [
              ...(asArray(root.entries) ?? []),
              ...(asArray(root.composition) ?? []),
              ...(asArray(root.data) ?? []),
              ...(asArray(root.players) ?? []),
              ...(asArray(asObject(root.table)?.entries) ?? []),
              ...(asArray(asObject(root.table)?.data) ?? []),
              ...(asArray(asObject(root.details)?.entries) ?? []),
          ]
        : (asArray(parsed) ?? []);

    if (rows.length === 0) {
        warn(`table parser (${dataType} payload): unrecognized payload shape`, {
            payload: parsed,
        });
    }

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
