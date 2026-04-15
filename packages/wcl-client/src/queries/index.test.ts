import { describe, expect, it, vi } from "vitest";
import { createWclQueries } from "./index.js";

describe("wcl query layer", () => {
    it("calls executor with base report query + variables", async () => {
        const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
        const executeSpy = vi.fn(
            async (query: string, variables: Record<string, unknown>) => {
                calls.push({ query, variables });
                return { data: {} };
            },
        );
        const execute = async <TPayload>(
            query: string,
            variables: Record<string, unknown>,
        ): Promise<TPayload> => executeSpy(query, variables) as Promise<TPayload>;
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
});
