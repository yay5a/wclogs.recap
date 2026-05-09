import { describe, expect, it } from "vitest";
import { parseReportUrl } from "./report-code.js";

describe("parseReportUrl", () => {
    it("parses report code from path", () => {
        const parsed = parseReportUrl(
            "https://www.warcraftlogs.com/reports/abc123xyz4567890",
        );
        expect(parsed.reportCode).toBe("abc123xyz4567890");
    });

    it("detects retail by default", () => {
        const parsed = parseReportUrl(
            "https://www.warcraftlogs.com/reports/abc123?report=abc123",
        );
        expect(parsed.gameFamily).toBe("retail");
    });

    it("parses a valid URL wrapped in angle brackets", () => {
        const parsed = parseReportUrl(
            "<https://www.warcraftlogs.com/reports/abc123?fight=last>",
        );
        expect(parsed.reportCode).toBe("abc123");
    });

    it("ignores leading and trailing whitespace", () => {
        const parsed = parseReportUrl(
            "   https://www.warcraftlogs.com/reports/abc123?fight=last   ",
        );
        expect(parsed.reportCode).toBe("abc123");
    });

    it("detects mop classic from path", () => {
        const parsed = parseReportUrl(
            "https://classic.warcraftlogs.com/reports/abc123?code=abc123",
        );
        expect(parsed.gameFamily).toBe("mop_classic");
    });

    it("fails with a clear error for invalid URL", () => {
        expect(() => parseReportUrl("not-a-url")).toThrow(
            "Invalid Warcraft Logs report URL",
        );
    });

    it("fails with a clear error when report code is missing", () => {
        expect(() =>
            parseReportUrl("https://www.warcraftlogs.com/reports/?fight=last"),
        ).toThrow("Could not find a Warcraft Logs report code in the URL");
    });

    it("fails with a clear error for empty input", () => {
        expect(() => parseReportUrl("   ")).toThrow("Report URL is empty");
    });
});
