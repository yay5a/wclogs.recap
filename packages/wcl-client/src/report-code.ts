
import type { GameFamily } from "@wcl/domain";

export interface ParsedReportUrl {
    reportCode: string;
    gameFamily: GameFamily;
    rawUrl: string;
}

const REPORT_CODE_PATTERN = /^[A-Za-z0-9]+$/;

export const normalizeReportUrlInput = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("Report URL is empty");
    }

    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
        const unwrapped = trimmed.slice(1, -1).trim();
        if (!unwrapped) {
            throw new Error("Report URL is empty");
        }
        return unwrapped;
    }

    return trimmed;
};

const extractReportCodeFromPath = (pathname: string): string | undefined => {
    const segments = pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

    for (let i = 0; i < segments.length - 1; i += 1) {
        const segment = segments[i]?.toLowerCase();
        if (segment !== "reports" && segment !== "report") continue;

        const candidate = decodeURIComponent(segments[i + 1] ?? "").trim();
        if (candidate && REPORT_CODE_PATTERN.test(candidate)) {
            return candidate;
        }
    }

    return undefined;
};

export const parseReportUrl = (url: string): ParsedReportUrl => {
    const normalizedInput = normalizeReportUrlInput(url);
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(normalizedInput);
    } catch {
        throw new Error("Invalid Warcraft Logs report URL");
    }

    const queryReportCode =
        parsedUrl.searchParams.get("report") ??
        parsedUrl.searchParams.get("code");
    const reportCode =
        queryReportCode?.trim() ||
        extractReportCodeFromPath(parsedUrl.pathname);

    if (!reportCode || !REPORT_CODE_PATTERN.test(reportCode)) {
        throw new Error(
            "Could not find a Warcraft Logs report code in the URL",
        );
    }

    const lowerHost = parsedUrl.hostname.toLowerCase();
    const lowerPath = parsedUrl.pathname.toLowerCase();
    const gameFamily: GameFamily =
        lowerHost.includes("classic") ||
        lowerPath.includes("classic") ||
        lowerPath.includes("mop")
            ? "mop_classic"
            : "retail";

    return { reportCode, gameFamily, rawUrl: normalizedInput };
};
