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

export interface ParsedTablePayload {
    entries: ParsedTableEntry[];
    isValidEmpty: boolean;
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
): { rows: unknown[]; isValidShape: boolean } => {
    const root = asObject(payload);
    if (!root) {
        const rows = asArray(payload) ?? [];
        if (rows.length === 0) {
            warn(`table parser (${dataType} payload): unrecognized payload shape`, {
                payload,
            });
        }
        return { rows, isValidShape: rows.length > 0 };
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

    if (dataType === "Survivability") {
        const players = asArray(data?.players) ?? [];
        const actorTotals = asArray(data?.actortotals) ?? [];
        if (players.length > 0 || actorTotals.length > 0) {
            return {
                rows: players.length > 0 ? players : actorTotals,
                isValidShape: true,
            };
        }
    }

    const hasExplicitEmptyEntries =
        Array.isArray(asArray(root.entries)) ||
        Array.isArray(asArray(data?.entries));

    if (rows.length === 0) {
        if (!hasExplicitEmptyEntries) {
            warn(`table parser (${dataType} payload): unrecognized payload shape`, {
                payload,
            });
        }
        return { rows, isValidShape: hasExplicitEmptyEntries };
    }

    return { rows, isValidShape: true };
};

export const parseTablePayloadDetailed = (
    payload: unknown,
    dataType: TableDataType,
    warn: DebugWarn = defaultDebugWarn,
): ParsedTablePayload => {
    const parsed = parseUnknownJson(payload, warn, `table:${dataType}`);
    const { rows, isValidShape } = getTableEntries(parsed, dataType, warn);

    const entries = rows.flatMap((row) => {
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
    return {
        entries,
        isValidEmpty: isValidShape && rows.length === 0,
    };
};

export const parseTablePayload = (
    payload: unknown,
    dataType: TableDataType,
    warn: DebugWarn = defaultDebugWarn,
): ParsedTableEntry[] => parseTablePayloadDetailed(payload, dataType, warn).entries;
