import { beforeAll, describe, expect, it, vi } from "vitest";
import { NORMALIZED_PAYLOAD_VERSION, RAW_PAYLOAD_VERSION } from "./cache-policy.js";

describe("index contract", () => {
    vi.mock(
        "@wcl/shared",
        () => ({
            createLogger: () => ({
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        }),
    );

    let createWclClient: typeof import("./index.js").createWclClient;
    let WclClient: typeof import("./index.js").WclClient;
    let WclReportFetchError: typeof import("./index.js").WclReportFetchError;

    beforeAll(async () => {
        ({
            createWclClient,
            WclClient,
            WclReportFetchError,
        } = await import("./index.js"));
    });

    it("exports a WclClient factory facade", () => {
        expect(
            createWclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://example.com",
            }),
        ).toBeInstanceOf(WclClient);
    });

    describe("fetch cache behavior", () => {
        const jsonResponse = (payload: unknown, status = 200): Response =>
            new Response(JSON.stringify(payload), {
                status,
                headers: { "content-type": "application/json" },
            });
        const minimalReportPayload = {
            data: {
                reportData: {
                    report: {
                        title: "Linked Private Report",
                        startTime: 1,
                        endTime: 2,
                        zone: { frozen: true },
                        fights: [],
                        masterData: { actors: [] },
                    },
                },
            },
        };

        it("re-normalizes cached raw payload when normalized payload version is stale", async () => {
            const cachedBase = {
                reportData: {
                    report: {
                        title: "Cache Fresh Title",
                        startTime: 1,
                        endTime: 2,
                        zone: { frozen: true },
                        fights: [],
                        masterData: { actors: [] },
                    },
                },
            };
            const store = {
                getByReportCode: vi.fn().mockResolvedValue({
                    reportCode: "abc123xyz4567890",
                    sourceUrl: "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                    gameFamily: "retail",
                    rawPayload: {
                        rawPayloadVersion: RAW_PAYLOAD_VERSION,
                        base: cachedBase,
                        encounterSummaries: [],
                    },
                    normalizedPayload: {
                        reportCode: "abc123xyz4567890",
                        title: "Stale Title",
                        startTime: 1,
                        endTime: 2,
                        gameFamily: "retail",
                        fights: [],
                        players: [],
                        leaderboards: [],
                        bossPerformances: [],
                    },
                    normalizedPayloadVersion: 1,
                    fetchedAt: new Date(),
                }),
                upsert: vi.fn().mockResolvedValue(undefined),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://example.com",
                reportCacheStore: store,
            });

            const normalized = await client.fetchAndNormalizeReport(
                "https://www.warcraftlogs.com/reports/abc123xyz4567890",
            );

            expect(normalized.title).toBe("Cache Fresh Title");
            expect(store.upsert).toHaveBeenCalledTimes(1);
            const upsertArgs = store.upsert.mock.calls[0]?.[0] as
                | { normalizedPayloadVersion?: number }
                | undefined;
            expect(upsertArgs?.normalizedPayloadVersion).toBe(NORMALIZED_PAYLOAD_VERSION);
        });

        it("refetches old raw cache payloads without the current enrichment version", async () => {
            const previousFixtureSetting = process.env.WCL_USE_FIXTURES;
            process.env.WCL_USE_FIXTURES = "true";
            const store = {
                getByReportCode: vi.fn().mockResolvedValue({
                    reportCode: "abc123xyz4567890",
                    sourceUrl: "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                    gameFamily: "retail",
                    rawPayload: { base: { reportData: { report: { title: "Old Raw" } } } },
                    normalizedPayload: {
                        reportCode: "abc123xyz4567890",
                        title: "Old Normalized",
                        startTime: 1,
                        endTime: 2,
                        gameFamily: "retail",
                        fights: [],
                        players: [],
                        leaderboards: [],
                        bossPerformances: [],
                    },
                    normalizedPayloadVersion: NORMALIZED_PAYLOAD_VERSION - 1,
                    fetchedAt: new Date(),
                }),
                upsert: vi.fn().mockResolvedValue(undefined),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://example.com",
                reportCacheStore: store,
            });

            try {
                await client.fetchAndNormalizeReport(
                    "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                );
            } finally {
                if (previousFixtureSetting === undefined) {
                    delete process.env.WCL_USE_FIXTURES;
                } else {
                    process.env.WCL_USE_FIXTURES = previousFixtureSetting;
                }
            }

            expect(store.upsert).toHaveBeenCalledTimes(1);
            const upsertArgs = store.upsert.mock.calls[0]?.[0] as
                | { rawPayload?: { rawPayloadVersion?: number } }
                | undefined;
            expect(upsertArgs?.rawPayload?.rawPayloadVersion).toBe(RAW_PAYLOAD_VERSION);
        });

        it("retries auth-required public failures with the invoking user's linked WCL auth", async () => {
            const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url.endsWith("/oauth/token")) {
                    return jsonResponse({ access_token: "public-token" });
                }
                if (url.endsWith("/api/v2/client")) {
                    return jsonResponse(
                        { errors: [{ message: "not authorized for this private report" }] },
                        403,
                    );
                }
                if (url.endsWith("/api/v2/user")) {
                    return jsonResponse(minimalReportPayload);
                }
                return jsonResponse({ errors: [{ message: "unexpected endpoint" }] }, 500);
            });
            const reportCacheStore = {
                getByReportCode: vi.fn().mockResolvedValue(null),
                upsert: vi.fn().mockResolvedValue(undefined),
            };
            const wclUserAuthStore = {
                getByDiscordUserId: vi.fn().mockResolvedValue({
                    discordUserId: "discord-user-1",
                    accessToken: "linked-user-token",
                    expiresAt: new Date(Date.now() + 60_000),
                }),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
                fetchImpl,
                reportCacheStore,
                wclUserAuthStore,
            });

            const normalized = await client.fetchAndNormalizeReport(
                "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                { discordUserId: "discord-user-1" },
            );

            expect(normalized.title).toBe("Linked Private Report");
            expect(wclUserAuthStore.getByDiscordUserId).toHaveBeenCalledWith(
                "discord-user-1",
            );
            expect(
                fetchImpl.mock.calls.some(([input]) =>
                    String(input).endsWith("/api/v2/client"),
                ),
            ).toBe(true);
            expect(
                fetchImpl.mock.calls.some(([input]) =>
                    String(input).endsWith("/api/v2/user"),
                ),
            ).toBe(true);
            expect(reportCacheStore.upsert).not.toHaveBeenCalled();
        });

        it("requires reauthorization instead of using expired linked WCL auth", async () => {
            const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url.endsWith("/oauth/token")) {
                    return jsonResponse({ access_token: "public-token" });
                }
                if (url.endsWith("/api/v2/client")) {
                    return jsonResponse(
                        { errors: [{ message: "not authorized for this private report" }] },
                        403,
                    );
                }
                return jsonResponse(minimalReportPayload);
            });
            const wclUserAuthStore = {
                getByDiscordUserId: vi.fn().mockResolvedValue({
                    discordUserId: "discord-user-1",
                    accessToken: "expired-linked-token",
                    expiresAt: new Date(Date.now() - 60_000),
                }),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
                fetchImpl,
                wclUserAuthStore,
            });

            await expect(
                client.fetchAndNormalizeReport(
                    "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                    { discordUserId: "discord-user-1" },
                ),
            ).rejects.toMatchObject({
                category: "expired_linked_auth",
                authMode: "userLinked",
            });
            expect(
                fetchImpl.mock.calls.some(([input]) =>
                    String(input).endsWith("/api/v2/user"),
                ),
            ).toBe(false);
        });

        it("requires reauthorization when linked WCL auth cannot be decrypted", async () => {
            const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url.endsWith("/oauth/token")) {
                    return jsonResponse({ access_token: "public-token" });
                }
                if (url.endsWith("/api/v2/client")) {
                    return jsonResponse(
                        { errors: [{ message: "not authorized for this private report" }] },
                        403,
                    );
                }
                return jsonResponse(minimalReportPayload);
            });
            const wclUserAuthStore = {
                getByDiscordUserId: vi.fn().mockRejectedValue(
                    new Error("WCL token decryption failed"),
                ),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
                fetchImpl,
                wclUserAuthStore,
            });

            await expect(
                client.fetchAndNormalizeReport(
                    "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                    { discordUserId: "discord-user-1" },
                ),
            ).rejects.toMatchObject({
                category: "linked_auth_unreadable",
                authMode: "userLinked",
            });
            expect(
                fetchImpl.mock.calls.some(([input]) =>
                    String(input).endsWith("/api/v2/user"),
                ),
            ).toBe(false);
        });

        it("does not use another user's linked WCL auth when no invoking user is provided", async () => {
            const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url.endsWith("/oauth/token")) {
                    return jsonResponse({ access_token: "public-token" });
                }
                return jsonResponse(
                    { errors: [{ message: "not authorized for this private report" }] },
                    403,
                );
            });
            const wclUserAuthStore = {
                getByDiscordUserId: vi.fn(),
            };
            const client = new WclClient({
                clientId: "id",
                clientSecret: "secret",
                apiBaseUrl: "https://www.warcraftlogs.com/api/v2/client",
                fetchImpl,
                wclUserAuthStore,
            });

            await expect(
                client.fetchAndNormalizeReport(
                    "https://www.warcraftlogs.com/reports/abc123xyz4567890",
                ),
            ).rejects.toBeInstanceOf(WclReportFetchError);
            expect(wclUserAuthStore.getByDiscordUserId).not.toHaveBeenCalled();
        });
    });
});
