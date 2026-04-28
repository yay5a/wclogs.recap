
import fixture from "./fixtures/report-fixture.json" with { type: "json" };
import type { NormalizedReport } from "@wcl/domain";
import type { ReportCacheStore } from "./report-cache-store.js";
import {
    NORMALIZED_PAYLOAD_VERSION,
    RAW_PAYLOAD_VERSION,
    shouldUseCachedNormalizedPayload,
    shouldUseCachedReport,
} from "./cache-policy.js";
import { WclGraphqlClient } from "./graphql-client.js";
import { normalizeEnrichedReport } from "./normalize-report.js";
import { parseReportUrl } from "./report-code.js";
import { ReportFetcher } from "./report-fetcher.js";
import { getReportNode, type EnrichedRawReport } from "./raw-report.js";

export interface WclClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
    reportCacheStore?: ReportCacheStore;
}

export class WclClient {
    private readonly fetcher: ReportFetcher;

    public constructor(private readonly options: WclClientOptions) {
        const graphqlClient = new WclGraphqlClient(options);
        this.fetcher = new ReportFetcher(graphqlClient);
    }

    public async fetchAndNormalizeReport(
        url: string,
    ): Promise<NormalizedReport> {
        const parsed = parseReportUrl(url);
        const cached = await this.options.reportCacheStore?.getByReportCode(
            parsed.reportCode,
        );

        if (
            cached &&
            shouldUseCachedReport({
                rawPayload: cached.rawPayload,
                fetchedAt: cached.fetchedAt,
            })
        ) {
            if (shouldUseCachedNormalizedPayload(cached)) {
                return cached.normalizedPayload;
            }

            const reNormalized = normalizeEnrichedReport(
                cached.rawPayload,
                parsed,
            );
            await this.options.reportCacheStore?.upsert({
                reportCode: parsed.reportCode,
                sourceUrl: url,
                gameFamily: parsed.gameFamily,
                rawPayload: cached.rawPayload,
                normalizedPayload: reNormalized,
                normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION,
                fetchedAt: new Date(),
            });
            return reNormalized;
        }

        let rawPayload: unknown;
        if (process.env.WCL_USE_FIXTURES === "true") {
            rawPayload = {
                rawPayloadVersion: RAW_PAYLOAD_VERSION,
                base: fixture,
                reportRankings: getReportNode(fixture)?.rankings,
                playerDetails: undefined,
                reportTables: {},
                encounterSummaries: [],
            } satisfies EnrichedRawReport;
        } else {
            rawPayload = await this.fetcher.fetchEnrichedRawReport(parsed.reportCode);
        }

        const normalized = normalizeEnrichedReport(rawPayload, parsed);

        if (this.options.reportCacheStore) {
            await this.options.reportCacheStore.upsert({
                reportCode: parsed.reportCode,
                sourceUrl: url,
                gameFamily: parsed.gameFamily,
                rawPayload,
                normalizedPayload: normalized,
                normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION,
                fetchedAt: new Date(),
            });
        }

        return normalized;
    }
}

export const createWclClient = (options: WclClientOptions): WclClient =>
    new WclClient(options);
