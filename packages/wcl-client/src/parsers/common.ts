export type DebugWarn = (message: string, context?: unknown) => void;

export const defaultDebugWarn: DebugWarn = (message, context) => {
    console.warn(message, context);
};

export type PayloadShapeSummary = {
    type: string;
    length?: number;
    keyCount?: number;
};

export const describePayloadShape = (payload: unknown): PayloadShapeSummary => {
    if (Array.isArray(payload)) {
        return { type: "array", length: payload.length };
    }

    if (payload === null) return { type: "null" };

    if (typeof payload === "object") {
        return { type: "object", keyCount: Object.keys(payload).length };
    }

    if (typeof payload === "string") {
        return { type: "string", length: payload.length };
    }

    return { type: typeof payload };
};

export const asObject = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;

export const asArray = (value: unknown): unknown[] | undefined =>
    Array.isArray(value) ? value : undefined;

export const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

export const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export const normalizeName = (value: string): string =>
    value.trim().toLowerCase().replace(/\s+/g, " ");

export const parseUnknownJson = (
    payload: unknown,
    warn: DebugWarn,
    label: string,
): unknown => {
    if (typeof payload !== "string") return payload;

    try {
        return JSON.parse(payload) as unknown;
    } catch {
        warn(`${label}: failed to parse JSON string payload`, {
            payloadShape: describePayloadShape(payload),
        });
        return undefined;
    }
};
