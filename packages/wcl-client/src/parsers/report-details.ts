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

const isExplicitlyEmptyPlayerDetailsPayload = (parsed: unknown): boolean => {
    const root = asObject(parsed);
    if (!root) return false;

    const rootData = asArray(root.data);
    if (rootData?.length === 0) return true;

    const rootEntries = asArray(root.entries);
    if (rootEntries?.length === 0) return true;

    const rootComposition = asArray(root.composition);
    if (rootComposition?.length === 0) return true;

    const rootPlayers = asArray(root.players);
    if (rootPlayers?.length === 0) return true;

    const data = asObject(root.data);
    const dataPlayerDetails = asArray(data?.playerDetails);
    if (dataPlayerDetails?.length === 0) return true;

    const players = asObject(root.players);
    const playersData = asArray(players?.data);
    if (playersData?.length === 0) return true;

    const playerDetails = asObject(root.playerDetails);
    const playerDetailsData = asArray(playerDetails?.data);
    if (playerDetailsData?.length === 0) return true;

    const details = asObject(root.details);
    const detailsPlayers = asArray(details?.players);
    if (detailsPlayers?.length === 0) return true;

    return false;
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
        if (isExplicitlyEmptyPlayerDetailsPayload(parsed)) {
            return [];
        }
        warn("playerDetails parser (report payload): no player details extracted", {
            payload: parsed,
        });
    }

    return results;
};
