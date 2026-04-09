import { asObject, asString, defaultDebugWarn, parseUnknownJson, type DebugWarn } from "./common.js";

export interface ParsedPlayerDetail {
    name: string;
    className?: string;
    specName?: string;
    role?: string;
}

const collectPlayerNodes = (root: Record<string, unknown>): unknown[] => {
    const players = asObject(root.players);
    return [
        ...(Array.isArray(root.data) ? root.data : []),
        ...(Array.isArray(root.entries) ? root.entries : []),
        ...(Array.isArray(root.composition) ? root.composition : []),
        ...(players && Array.isArray(players.data) ? players.data : []),
        root,
    ];
};

export const parsePlayerDetailsPayload = (
    payload: unknown,
    warn: DebugWarn = defaultDebugWarn,
): ParsedPlayerDetail[] => {
    const parsed = parseUnknownJson(payload, warn, "playerDetails");
    const root = asObject(parsed);
    if (!root) return [];

    const results: ParsedPlayerDetail[] = [];
    for (const candidate of collectPlayerNodes(root)) {
        const entry = asObject(candidate);
        if (!entry) continue;

        const name = asString(entry.name) ?? asString(asObject(entry.player)?.name);
        if (!name) continue;

        results.push({
            name,
            className: asString(entry.class) ?? asString(entry.type),
            specName: asString(entry.spec) ?? asString(asObject(entry.talentTree)?.name),
            role: asString(entry.role),
        });
    }

    if (results.length === 0) {
        warn("playerDetails parser: no player details extracted", { payload: parsed });
    }

    return results;
};
