import { describe, expect, it, vi } from "vitest";
import {
    buildReportWideTableQuery,
    createWclQueries,
    REPORT_WIDE_KILL_TABLE_FILTERS,
} from "./index.js";

describe("wcl query layer", () => {
    it("calls executor with base report query + variables", async () => {
        const calls: Array<{
            query: string;
            variables: Record<string, unknown>;
        }> = [];
        const executeSpy = vi.fn(
            async (query: string, variables: Record<string, unknown>) => {
                calls.push({ query, variables });
                return { data: {} };
            },
        );
        const execute = async <TPayload>(
            query: string,
            variables: Record<string, unknown>,
        ): Promise<TPayload> =>
            executeSpy(query, variables) as Promise<TPayload>;
        const queries = createWclQueries(execute);

        await queries.baseReportSummary({
            code: "abc",
            allowUnlisted: true,
            includeRateLimitData: true,
        });

        expect(executeSpy).toHaveBeenCalledTimes(1);
        expect(calls[0]?.variables).toEqual({
            code: "abc",
            allowUnlisted: true,
            includeRateLimitData: true,
        });
    });

    it("returns raw typed payloads without normalization", async () => {
        const payload = {
            data: {
                reportData: {
                    report: {
                        rankings: "raw-json",
                    },
                },
            },
        };
        const execute = async <TPayload>(): Promise<TPayload> =>
            payload as TPayload;
        const queries = createWclQueries(execute);

        const result = await queries.reportRankings({
            code: "abc",
            allowUnlisted: true,
        });

        expect(result).toBe(payload);
        expect(result.data?.reportData?.report?.rankings).toBe("raw-json");
    });

    it("requests metric-specific report-wide combined rankings", async () => {
        const calls: Array<{
            query: string;
            variables: Record<string, unknown>;
        }> = [];
        const execute = async <TPayload>(
            query: string,
            variables: Record<string, unknown>,
        ): Promise<TPayload> => {
            calls.push({ query, variables });
            return { data: {} } as TPayload;
        };
        const queries = createWclQueries(execute);

        await queries.reportRankingsDpsCombined({
            code: "abc",
            allowUnlisted: true,
        });
        await queries.reportRankingsHpsCombined({
            code: "abc",
            allowUnlisted: true,
        });

        expect(calls[0]?.query).toContain(
            "rankings(playerMetric: dps, timeframe: Today, compare: Rankings)",
        );
        expect(calls[1]?.query).toContain(
            "rankings(playerMetric: hps, timeframe: Today, compare: Rankings)",
        );
    });

    it("builds report-wide table calls as one filtered data type", async () => {
        const calls: Array<{
            query: string;
            variables: Record<string, unknown>;
        }> = [];
        const execute = async <TPayload>(
            query: string,
            variables: Record<string, unknown>,
        ): Promise<TPayload> => {
            calls.push({ query, variables });
            return { data: {} } as TPayload;
        };
        const queries = createWclQueries(execute);

        await queries.reportWideTable({
            code: "abc",
            allowUnlisted: true,
            dataType: "DamageDone",
            fightIDs: [2, 4],
            filterExpression: REPORT_WIDE_KILL_TABLE_FILTERS.DamageDone,
        });

        expect(calls[0]?.query).toContain("dataType: DamageDone");
        expect(calls[0]?.query).toContain(
            "filterExpression: $filterExpression",
        );
        expect(calls[0]?.query).not.toContain("Survivability");
        expect(calls[0]?.variables).toEqual({
            code: "abc",
            allowUnlisted: true,
            fightIDs: [2, 4],
            filterExpression: REPORT_WIDE_KILL_TABLE_FILTERS.DamageDone,
        });
    });

    it("keeps probed kill table filters exact", () => {
        expect(REPORT_WIDE_KILL_TABLE_FILTERS.Deaths).toBe(
            '((encounterID != 0) AND (encounterEnd = "kill")) AND (type = "death") AND (target.disposition = "friendly") AND (feign = false)',
        );
        expect(REPORT_WIDE_KILL_TABLE_FILTERS.Healing).toBe(
            '((encounterID != 0) AND (encounterEnd = "kill")) AND (inCategory("healing") = true) AND (source.disposition = "friendly") AND (target.disposition = "friendly")',
        );
    });

    it("inlines the requested table data type", () => {
        expect(buildReportWideTableQuery("Interrupts")).toContain(
            "dataType: Interrupts",
        );
    });
});
