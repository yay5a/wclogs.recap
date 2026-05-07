import type { WclAuthModeKind } from "./auth-mode.js";

export type WclReportFetchFailureCategory =
    | "public_report_not_found"
    | "private_or_auth_required"
    | "archived_report"
    | "malformed_wcl_response"
    | "wcl_rate_limit"
    | "network_failure"
    | "expired_linked_auth"
    | "linked_auth_unreadable"
    | "missing_linked_auth"
    | "user_auth_rejected"
    | "wcl_auth_failed"
    | "unknown";

export class WclReportFetchError extends Error {
    public readonly category: WclReportFetchFailureCategory;
    public readonly reportCode: string;
    public readonly authMode: WclAuthModeKind;
    public readonly status?: number;

    public constructor(input: {
        category: WclReportFetchFailureCategory;
        reportCode: string;
        authMode: WclAuthModeKind;
        status?: number;
        message?: string;
        cause?: unknown;
    }) {
        super(
            input.message ??
                `WCL report fetch failed (${input.category})`,
            input.cause ? { cause: input.cause } : undefined,
        );
        this.name = "WclReportFetchError";
        this.category = input.category;
        this.reportCode = input.reportCode;
        this.authMode = input.authMode;
        if (typeof input.status === "number") {
            this.status = input.status;
        }
    }
}

const asObject = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;

const readStatus = (error: unknown): number | undefined => {
    const root = asObject(error);
    const response = asObject(root?.response);
    const status = response?.status ?? root?.status;
    return typeof status === "number" ? status : undefined;
};

const readMessages = (error: unknown): string[] => {
    const messages: string[] = [];
    if (error instanceof Error) messages.push(error.message);

    const root = asObject(error);
    const response = asObject(root?.response);
    const errors = response?.errors;
    if (Array.isArray(errors)) {
        for (const item of errors) {
            const message = asObject(item)?.message;
            if (typeof message === "string") messages.push(message);
        }
    }

    return messages;
};

const categoryForAuthStatus = (
    authMode: WclAuthModeKind,
): WclReportFetchFailureCategory =>
    authMode === "userLinked" ? "user_auth_rejected" : "private_or_auth_required";

export const classifyWclReportFetchError = (
    error: unknown,
    authMode: WclAuthModeKind,
): { category: WclReportFetchFailureCategory; status?: number } => {
    if (error instanceof WclReportFetchError) {
        return {
            category: error.category,
            ...(typeof error.status === "number" ? { status: error.status } : {}),
        };
    }

    const status = readStatus(error);
    if (status === 401 || status === 403) {
        return { category: categoryForAuthStatus(authMode), status };
    }
    if (status === 404) return { category: "public_report_not_found", status };
    if (status === 429) return { category: "wcl_rate_limit", status };
    if (typeof status === "number" && status >= 500) {
        return { category: "network_failure", status };
    }

    const message = readMessages(error).join(" ").toLowerCase();
    if (message.includes("rate limit") || message.includes("too many requests")) {
        return { category: "wcl_rate_limit", ...(status ? { status } : {}) };
    }
    if (message.includes("not found") || message.includes("does not exist")) {
        return { category: "public_report_not_found", ...(status ? { status } : {}) };
    }
    if (
        message.includes("private") ||
        message.includes("permission") ||
        message.includes("not authorized") ||
        message.includes("unauthorized") ||
        message.includes("forbidden") ||
        message.includes("access denied") ||
        message.includes("inaccessible")
    ) {
        return { category: categoryForAuthStatus(authMode), ...(status ? { status } : {}) };
    }
    if (
        error instanceof TypeError ||
        message.includes("network") ||
        message.includes("fetch failed") ||
        message.includes("econn") ||
        message.includes("enotfound")
    ) {
        return { category: "network_failure", ...(status ? { status } : {}) };
    }

    return { category: "unknown", ...(status ? { status } : {}) };
};

export const toWclReportFetchError = (
    error: unknown,
    input: {
        reportCode: string;
        authMode: WclAuthModeKind;
        fallbackCategory?: WclReportFetchFailureCategory;
    },
): WclReportFetchError => {
    if (error instanceof WclReportFetchError) return error;
    const classified = classifyWclReportFetchError(error, input.authMode);
    return new WclReportFetchError({
        category: input.fallbackCategory ?? classified.category,
        reportCode: input.reportCode,
        authMode: input.authMode,
        ...(typeof classified.status === "number" ? { status: classified.status } : {}),
        cause: error,
    });
};

export const shouldRetryWithUserLinkedAuth = (
    error: WclReportFetchError,
): boolean => error.category === "private_or_auth_required";
