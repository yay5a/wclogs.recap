
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
import { publicClientAuthMode, userLinkedAuthMode, type WclAuthMode } from "./auth-mode.js";
import {
    shouldRetryWithUserLinkedAuth,
    toWclReportFetchError,
    WclReportFetchError,
} from "./report-errors.js";

export interface WclLinkedUserAuthRecord {
    discordUserId: string;
    accessToken?: string;
    expiresAt?: Date | string;
}

export interface WclLinkedUserAuthStore {
    getByDiscordUserId(discordUserId: string): Promise<WclLinkedUserAuthRecord | null>;
}

export interface WclClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    userApiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    reportCacheStore?: ReportCacheStore;
    wclUserAuthStore?: WclLinkedUserAuthStore;
}

export interface FetchAndNormalizeReportOptions {
    discordUserId?: string;
}

export class WclClient {
    public constructor(private readonly options: WclClientOptions) {
    }

    public async fetchAndNormalizeReport(
        url: string,
        options: FetchAndNormalizeReportOptions = {},
    ): Promise<NormalizedReport> {
        const parsed = parseReportUrl(url);
        try {
            return await this.fetchAndNormalizeReportWithAuth(
                url,
                parsed,
                publicClientAuthMode(),
            );
        } catch (error) {
            const publicError = toWclReportFetchError(error, {
                reportCode: parsed.reportCode,
                authMode: "publicClient",
            });

            if (!options.discordUserId || !shouldRetryWithUserLinkedAuth(publicError)) {
                throw publicError;
            }

            let linkedAuth: WclLinkedUserAuthRecord | null | undefined;
            try {
                linkedAuth = await this.options.wclUserAuthStore?.getByDiscordUserId(
                    options.discordUserId,
                );
            } catch (linkedAuthError) {
                throw new WclReportFetchError({
                    category: "linked_auth_unreadable",
                    reportCode: parsed.reportCode,
                    authMode: "userLinked",
                    cause: linkedAuthError,
                });
            }
            if (!linkedAuth?.accessToken) {
                throw new WclReportFetchError({
                    category: "missing_linked_auth",
                    reportCode: parsed.reportCode,
                    authMode: "userLinked",
                });
            }

            if (isExpired(linkedAuth.expiresAt)) {
                throw new WclReportFetchError({
                    category: "expired_linked_auth",
                    reportCode: parsed.reportCode,
                    authMode: "userLinked",
                });
            }

            try {
                return await this.fetchAndNormalizeReportWithAuth(
                    url,
                    parsed,
                    userLinkedAuthMode(options.discordUserId, linkedAuth.accessToken),
                );
            } catch (userError) {
                throw toWclReportFetchError(userError, {
                    reportCode: parsed.reportCode,
                    authMode: "userLinked",
                });
            }
        }
    }

    private async fetchAndNormalizeReportWithAuth(
        url: string,
        parsed: ReturnType<typeof parseReportUrl>,
        authMode: WclAuthMode,
    ): Promise<NormalizedReport> {
        const shouldUseSharedCache = authMode.kind === "publicClient";
        const cached = shouldUseSharedCache
            ? await this.options.reportCacheStore?.getByReportCode(parsed.reportCode)
            : undefined;

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
            rawPayload = await this.createFetcher(authMode).fetchEnrichedRawReport(parsed.reportCode);
        }

        const normalized = normalizeEnrichedReport(rawPayload, parsed);

        if (shouldUseSharedCache && this.options.reportCacheStore) {
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

    private createFetcher(authMode: WclAuthMode): ReportFetcher {
        const graphqlClient = new WclGraphqlClient({
            clientId: this.options.clientId,
            clientSecret: this.options.clientSecret,
            apiBaseUrl: this.options.apiBaseUrl,
            ...(this.options.userApiBaseUrl ? { userApiBaseUrl: this.options.userApiBaseUrl } : {}),
            ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
            authMode,
        });
        return new ReportFetcher(graphqlClient);
    }
}

export const createWclClient = (options: WclClientOptions): WclClient =>
    new WclClient(options);

const isExpired = (expiresAt: Date | string | undefined): boolean => {
    if (!expiresAt) return false;
    const expiresAtMs =
        expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
};
