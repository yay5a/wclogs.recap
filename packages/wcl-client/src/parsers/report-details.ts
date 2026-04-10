import {
    asArray,
    asObject,
    asString,
    defaultDebugWarn,
    parseUnknownJson,
} from "./common.js";
import type { DebugWarn } from "./common.js";

export interface ParsedPlayerDetail {
    name: string;
    className?: string;
    specName?: string;
    role?: string;
}

const collectPlayerNodes = (parsed: unknown): unknown[] => {
    const root = asObject(parsed);
    if (!root) return asArray(parsed) ?? [];

    const players = asObject(root.players);
    const details = asObject(root.details);
    const playerDetails = asObject(root.playerDetails);
    return [
        ...(asArray(root.data) ?? []),
        ...(asArray(root.entries) ?? []),
        ...(asArray(root.composition) ?? []),
        ...(asArray(root.players) ?? []),
        ...(asArray(players?.data) ?? []),
        ...(asArray(playerDetails?.data) ?? []),
        ...(asArray(details?.players) ?? []),
        root,
    ];
};

export const parsePlayerDetailsPayload = (
    payload: unknown,
    warn: DebugWarn = defaultDebugWarn,
): ParsedPlayerDetail[] => {
    const parsed = parseUnknownJson(payload, warn, "playerDetails");
    const rows = collectPlayerNodes(parsed);
    if (rows.length === 0) {
        warn("playerDetails parser (report payload): unrecognized payload shape", {
            payload: parsed,
        });
        return [];
    }

    const results: ParsedPlayerDetail[] = [];
    for (const candidate of rows) {
        const entry = asObject(candidate);
        if (!entry) continue;

        const name = asString(entry.name) ?? asString(asObject(entry.player)?.name);
        if (!name) continue;

        const className = asString(entry.class) ?? asString(entry.type);
        const specName = asString(entry.spec) ?? asString(asObject(entry.talentTree)?.name);
        const role = asString(entry.role);
        // Build the detail object, omitting optional properties when they are undefined. Under
        // exactOptionalPropertyTypes, assigning undefined to an optional property is not permitted.
        const detail: ParsedPlayerDetail = {
            name,
            ...(className ? { className } : {}),
            ...(specName ? { specName } : {}),
            ...(role ? { role } : {}),
        };
        results.push(detail);
    }

    if (results.length === 0) {
        warn("playerDetails parser (report payload): no player details extracted", {
            payload: parsed,
        });
    }

    return results;
};
