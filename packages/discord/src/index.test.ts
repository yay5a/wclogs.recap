import { describe, expect, it, vi, afterEach } from "vitest";
import { InteractionType } from "discord-interactions";
import type {
    GuildConfigStore,
    NormalizedPlayer,
    NormalizedReport,
} from "@wcl/domain";
import {
    buildRecapPreviewBody,
    buildPublicRecapEmbed,
    buildDiscordCommandPayload,
    buildDiscordCommandPayloads,
    DiscordCommandRegistrationError,
    handleInteraction,
    registerGlobalCommands,
    registerGuildCommands,
} from "./index.js";

const makeReport = (): NormalizedReport => ({
    reportCode: "ABC123",
    title: "Raid Night",
    startTime: Date.now(),
    endTime: Date.now(),
    gameFamily: "retail",
    zoneName: "Vault",
    fights: [{ id: 1, name: "Boss", startTime: 0, endTime: 1, kill: true }],
    players: [
        {
            id: "1",
            actorId: 1,
            name: "Alyra",
            bestParse: 90,
            avgParse: 85,
            executionScore: 88,
        },
    ],
    leaderboards: [
        {
            scope: "report",
            playerId: 1,
            playerName: "Alyra",
            metric: "bestPerformanceAverage",
            value: 90,
        },
        {
            scope: "boss",
            bossName: "Boss",
            fightId: 1,
            playerId: 1,
            playerName: "Alyra",
            metric: "bestPercent",
            value: 95,
        },
    ],
    bossPerformances: [
        {
            bossName: "Boss",
            fightId: 1,
            topDamage: { playerName: "Alyra", value: 12345 },
            mostDeaths: { playerName: "Alyra", value: 1 },
        },
    ],
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("command payload builder", () => {
    it("builds valid chat-input command payload", () => {
        const payload = buildDiscordCommandPayload({
            type: 1,
            name: "health",
            description: "Health command",
            options: [
                {
                    type: 3,
                    name: "scope",
                    description: "scope",
                    required: true,
                    choices: [{ name: "guild", value: "guild" }],
                },
            ],
        });

        expect(payload).toEqual({
            type: 1,
            name: "health",
            description: "Health command",
            integration_types: undefined,
            contexts: undefined,
            default_member_permissions: undefined,
            nsfw: undefined,
            options: [
                {
                    type: 3,
                    name: "scope",
                    description: "scope",
                    required: true,
                    choices: [{ name: "guild", value: "guild" }],
                },
            ],
        });
    });

    it("builds valid user command payload", () => {
        const payload = buildDiscordCommandPayload({
            type: 2,
            name: "Inspect User",
        });

        expect(payload).toEqual({
            type: 2,
            name: "Inspect User",
            integration_types: undefined,
            contexts: undefined,
            default_member_permissions: undefined,
            nsfw: undefined,
        });
    });

    it("builds valid message command payload", () => {
        const payload = buildDiscordCommandPayload({
            type: 3,
            name: "Analyze Log",
        });

        expect(payload).toEqual({
            type: 3,
            name: "Analyze Log",
            integration_types: undefined,
            contexts: undefined,
            default_member_permissions: undefined,
            nsfw: undefined,
        });
    });

    it("rejects options on message commands", () => {
        expect(() =>
            buildDiscordCommandPayload({
                type: 3,
                name: "Analyze Log",
                options: [] as never,
            } as never),
        ).toThrow(/options are not allowed/i);
    });

    it("rejects missing description on chat-input commands", () => {
        expect(() =>
            buildDiscordCommandPayload({
                type: 1,
                name: "health",
                description: "",
            }),
        ).toThrow(/description is required/i);
    });

    it("rejects uppercase slash-command names", () => {
        expect(() =>
            buildDiscordCommandPayload({
                type: 1,
                name: "Health",
                description: "Health",
            }),
        ).toThrow(/slash command names must be lowercase/i);
    });

    it("rejects required option after optional option", () => {
        expect(() =>
            buildDiscordCommandPayload({
                type: 1,
                name: "config",
                description: "Configure",
                options: [
                    {
                        type: 3,
                        name: "optional",
                        description: "optional",
                        required: false,
                    },
                    {
                        type: 3,
                        name: "required",
                        description: "required",
                        required: true,
                    },
                ],
            }),
        ).toThrow(/required options must appear before optional/i);
    });

    it("rejects incompatible choices", () => {
        expect(() =>
            buildDiscordCommandPayload({
                type: 1,
                name: "config",
                description: "Configure",
                options: [
                    {
                        type: 5,
                        name: "flag",
                        description: "flag",
                        required: true,
                        choices: [{ name: "yes", value: "yes" }],
                    },
                ],
            }),
        ).toThrow(/choices are only valid/i);
    });

    it("rejects duplicate command names for same type", () => {
        expect(() =>
            buildDiscordCommandPayloads([
                { type: 1, name: "health", description: "Health" },
                { type: 1, name: "health", description: "Health 2" },
            ]),
        ).toThrow(/duplicate command name/i);
    });
});

describe("command registration endpoints", () => {
    it("registers global commands to the global endpoint", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue("ok"),
        });
        vi.stubGlobal("fetch", fetchMock);

        await registerGlobalCommands("app123", "token123");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://discord.com/api/v10/applications/app123/commands",
            expect.objectContaining({ method: "PUT" }),
        );
    });

    it("registers guild commands when guildId is provided", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue("ok"),
        });
        vi.stubGlobal("fetch", fetchMock);

        await registerGuildCommands("app123", "token123", "guild456");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://discord.com/api/v10/applications/app123/guilds/guild456/commands",
            expect.objectContaining({ method: "PUT" }),
        );
    });

    it("rejects blank guild id for guild registration", async () => {
        await expect(
            registerGuildCommands("app123", "token123", "   "),
        ).rejects.toThrow(/guildId is required/i);
    });

    it("surfaces Discord error details", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            statusText: "Bad Request",
            text: vi.fn().mockResolvedValue('{"message":"Invalid Form Body"}'),
        });
        vi.stubGlobal("fetch", fetchMock);
        await expect(
            registerGlobalCommands("app123", "token123"),
        ).rejects.toMatchObject({
            name: "DiscordCommandRegistrationError",
            details: expect.objectContaining({
                status: 400,
                statusText: "Bad Request",
                responseBody: '{"message":"Invalid Form Body"}',
            }),
        } satisfies Partial<DiscordCommandRegistrationError>);
    });
});

describe("handleInteraction", () => {
    it("saves guild config values", async () => {
        const saveGuildConfig = vi.fn().mockResolvedValue({
            guildId: "guild-1",
            defaultGameFamily: "mop_classic",
            compareModeDefault: "mixed",
            accountabilityVisibility: "shareable",
            coachingShareabilityDefault: "shareable",
            recapPostModeDefault: "preview-only",
        });
        const guildConfigStore: GuildConfigStore = {
            getGuildConfig: vi.fn(),
            saveGuildConfig,
        };
        const wclClient = {
            fetchAndNormalizeReport: vi.fn(),
            findPreviousRaidSummaries: vi.fn(),
        } as never;
        const recapPreviewStateService = {
            savePreviewState: vi.fn(),
            getValidPreviewState: vi.fn(),
            consumeValidPreviewState: vi.fn(),
            deletePreviewState: vi.fn(),
        };

        const response = await handleInteraction(
            {
                type: InteractionType.APPLICATION_COMMAND,
                guild_id: "guild-1",
                data: {
                    name: "config",
                    options: [
                        { name: "game_family", value: "mop_classic" },
                        { name: "compare_mode", value: "mixed" },
                    ],
                },
            },
            { wclClient, guildConfigStore, recapPreviewStateService },
        );

        expect(saveGuildConfig).toHaveBeenCalledWith("guild-1", {
            defaultGameFamily: "mop_classic",
            compareModeDefault: "mixed",
        });
        expect((response as { type?: number }).type).toBeDefined();
    });

    it("creates report recap preview and post flow", async () => {
        const report = makeReport();
        const previous: NormalizedPlayer[] = [];
        const coachingViewService = {
            buildShareableCoachingView: vi.fn().mockResolvedValue({}),
        };
        const accountabilityViewService = {
            buildAccountabilityView: vi.fn().mockResolvedValue({}),
        };
        const trendTrackingService = {
            ingestRaidHistory: vi.fn(),
            recomputeTrendsForGuild: vi.fn().mockResolvedValue(undefined),
        };
        const wclClient = {
            fetchAndNormalizeReport: vi.fn().mockResolvedValue(report),
            findPreviousRaidSummaries: vi.fn().mockResolvedValue(previous),
        } as never;
        const recapPreviewStateService = {
            savePreviewState: vi.fn().mockResolvedValue(undefined),
            getValidPreviewState: vi.fn().mockResolvedValue({
                guildId: "guild-1",
                channelId: "channel-1",
                reportCode: "ABC123",
                sourceUrl: "https://www.warcraftlogs.com/reports/ABC123",
                summaryPayload: {
                    reportTitle: "Raid Night",
                    reportDateISO: new Date(0).toISOString(),
                    gameFamily: "retail",
                    bossesKilled: 1,
                    compareModeUsed: "mixed",
                    accountabilityVisibility: "officers-only",
                    coachingShareability: "shareable",
                    recapPostMode: "preview-and-post",
                    topOverallParsers: [],
                    bossHighlights: [],
                    raidSuperlatives: [],
                    teamNote: "Team note",
                },
                createdByUserId: "user-1",
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
            }),
            consumeValidPreviewState: vi.fn().mockResolvedValue({
                guildId: "guild-1",
                channelId: "channel-1",
                reportCode: "ABC123",
                sourceUrl: "https://www.warcraftlogs.com/reports/ABC123",
                summaryPayload: {
                    reportTitle: "Raid Night",
                    reportDateISO: new Date(0).toISOString(),
                    gameFamily: "retail",
                    bossesKilled: 1,
                    compareModeUsed: "mixed",
                    accountabilityVisibility: "officers-only",
                    coachingShareability: "shareable",
                    recapPostMode: "preview-and-post",
                    topOverallParsers: [],
                    bossHighlights: [],
                    raidSuperlatives: [],
                    teamNote: "Team note",
                },
                createdByUserId: "user-1",
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
            }),
            deletePreviewState: vi.fn().mockResolvedValue(undefined),
        };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: "OK",
            text: vi.fn().mockResolvedValue("ok"),
        });
        vi.stubGlobal("fetch", fetchMock);
        const guildConfigStore: GuildConfigStore = {
            getGuildConfig: vi.fn().mockResolvedValue({
                guildId: "guild-1",
                defaultGameFamily: "retail",
                compareModeDefault: "mixed",
                accountabilityVisibility: "officers-only",
                coachingShareabilityDefault: "shareable",
                recapPostModeDefault: "preview-and-post",
            }),
            saveGuildConfig: vi.fn(),
        };
        const editFetch = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue("ok"),
        });
        vi.stubGlobal("fetch", editFetch);

        await handleInteraction(
            {
                type: InteractionType.APPLICATION_COMMAND,
                id: "interaction-1",
                application_id: "app-1",
                token: "token-1",
                guild_id: "guild-1",
                channel_id: "channel-1",
                member: { user: { id: "user-1" } },
                data: {
                    name: "report",
                    options: [
                        {
                            name: "recap",
                            options: [
                                {
                                    name: "url",
                                    value: "https://www.warcraftlogs.com/reports/ABC123",
                                },
                            ],
                        },
                    ],
                },
            },
            {
                wclClient,
                guildConfigStore,
                recapPreviewStateService,
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            },
        );

        await vi.waitFor(() => {
            expect(
                recapPreviewStateService.savePreviewState,
            ).toHaveBeenCalledOnce();
        });
        const patchCall = editFetch.mock.calls.find(
            ([url]) =>
                typeof url === "string" &&
                url.includes("/webhooks/") &&
                url.includes("/messages/@original"),
        );
        const body =
            patchCall?.[1] &&
            typeof patchCall[1] === "object" &&
            "body" in (patchCall[1] as Record<string, unknown>)
                ? (patchCall[1] as { body: string }).body
                : "{}";
        const previewBody = JSON.parse(body) as {
            components?: Array<{ components?: Array<{ custom_id?: string }> }>;
        };
        const customId =
            previewBody.components?.[0]?.components?.[0]?.custom_id ?? "";
        expect(customId).toContain("recap:v1:post:ABC123:guild-1");

        const posted = await handleInteraction(
            {
                type: InteractionType.MESSAGE_COMPONENT,
                guild_id: "guild-1",
                data: { custom_id: "recap:v1:post:ABC123:guild-1" },
            },
            {
                wclClient,
                guildConfigStore,
                recapPreviewStateService,
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            },
        );

        expect(
            (posted as { data?: { embeds?: unknown[] } }).data?.embeds?.length,
        ).toBe(1);
        expect(
            (posted as { data?: { components?: unknown[] } }).data?.components
                ?.length,
        ).toBe(1);
        expect(
            coachingViewService.buildShareableCoachingView,
        ).toHaveBeenCalledWith("ABC123");
        expect(
            accountabilityViewService.buildAccountabilityView,
        ).toHaveBeenCalledWith("ABC123", "officers-only");
        expect(
            recapPreviewStateService.consumeValidPreviewState,
        ).toHaveBeenCalledWith({ reportCode: "ABC123", guildId: "guild-1" });
    });

    it("returns an ephemeral error when preview state is missing or expired", async () => {
        const recapPreviewStateService = {
            savePreviewState: vi.fn(),
            getValidPreviewState: vi.fn().mockResolvedValue(null),
            consumeValidPreviewState: vi.fn().mockResolvedValue(null),
            deletePreviewState: vi.fn(),
        };
        const guildConfigStore: GuildConfigStore = {
            getGuildConfig: vi.fn(),
            saveGuildConfig: vi.fn(),
        };
        const wclClient = {
            fetchAndNormalizeReport: vi.fn(),
            findPreviousRaidSummaries: vi.fn(),
        } as never;

        const response = await handleInteraction(
            {
                type: InteractionType.MESSAGE_COMPONENT,
                guild_id: "guild-1",
                data: { custom_id: "recap:v1:post:ABC123:guild-1" },
            },
            { wclClient, guildConfigStore, recapPreviewStateService },
        );

        expect(response).toMatchObject({
            type: expect.any(Number),
            data: {
                content:
                    "This recap preview has already been posted or expired. Please run /report recap again.",
                flags: 64,
            },
        });
    });

    it("treats duplicate post attempts as idempotent and skips side effects on replay", async () => {
        const recapPreviewStateService = {
            savePreviewState: vi.fn(),
            getValidPreviewState: vi.fn(),
            consumeValidPreviewState: vi
                .fn()
                .mockResolvedValueOnce({
                    guildId: "guild-1",
                    channelId: "channel-1",
                    reportCode: "ABC123",
                    sourceUrl: "https://www.warcraftlogs.com/reports/ABC123",
                    summaryPayload: {
                        reportTitle: "Raid Night",
                        reportDateISO: new Date(0).toISOString(),
                        gameFamily: "retail",
                        bossesKilled: 1,
                        compareModeUsed: "mixed",
                        accountabilityVisibility: "officers-only",
                        coachingShareability: "private",
                        recapPostMode: "preview-and-post",
                        topOverallParsers: [],
                        bossHighlights: [],
                        raidSuperlatives: [],
                        teamNote: "Good work!",
                    },
                    createdByUserId: "user-1",
                    createdAt: new Date(0),
                    expiresAt: new Date(Date.now() + 60_000),
                    interactionId: "preview-interaction-1",
                    messageId: "preview-message-1",
                })
                .mockResolvedValueOnce(null),
            deletePreviewState: vi.fn(),
        };
        const guildConfigStore: GuildConfigStore = {
            getGuildConfig: vi.fn(),
            saveGuildConfig: vi.fn(),
        };
        const wclClient = {
            fetchAndNormalizeReport: vi.fn(),
            findPreviousRaidSummaries: vi.fn(),
        } as never;
        const coachingViewService = {
            buildShareableCoachingView: vi.fn().mockResolvedValue(undefined),
        };
        const accountabilityViewService = {
            buildAccountabilityView: vi.fn().mockResolvedValue(undefined),
        };
        const trendTrackingService = {
            recomputeTrendsForGuild: vi.fn().mockResolvedValue(undefined),
            ingestRaidHistory: vi.fn().mockResolvedValue(undefined),
        };

        const firstResponse = await handleInteraction(
            {
                id: "post-interaction-1",
                type: InteractionType.MESSAGE_COMPONENT,
                guild_id: "guild-1",
                data: { custom_id: "recap:v1:post:ABC123:guild-1" },
            },
            {
                wclClient,
                guildConfigStore,
                recapPreviewStateService,
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            },
        );

        const secondResponse = await handleInteraction(
            {
                id: "post-interaction-2",
                type: InteractionType.MESSAGE_COMPONENT,
                guild_id: "guild-1",
                data: { custom_id: "recap:v1:post:ABC123:guild-1" },
            },
            {
                wclClient,
                guildConfigStore,
                recapPreviewStateService,
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            },
        );

        expect((firstResponse as { data?: { embeds?: unknown[] } }).data?.embeds)
            .toHaveLength(1);
        expect(secondResponse).toMatchObject({
            type: expect.any(Number),
            data: {
                content:
                    "This recap preview has already been posted or expired. Please run /report recap again.",
                flags: 64,
            },
        });
        expect(
            recapPreviewStateService.consumeValidPreviewState,
        ).toHaveBeenNthCalledWith(1, { reportCode: "ABC123", guildId: "guild-1" });
        expect(
            recapPreviewStateService.consumeValidPreviewState,
        ).toHaveBeenNthCalledWith(2, { reportCode: "ABC123", guildId: "guild-1" });
        expect(
            coachingViewService.buildShareableCoachingView,
        ).toHaveBeenCalledTimes(1);
        expect(
            coachingViewService.buildShareableCoachingView,
        ).toHaveBeenCalledWith("ABC123");
        expect(
            accountabilityViewService.buildAccountabilityView,
        ).toHaveBeenCalledTimes(1);
        expect(
            accountabilityViewService.buildAccountabilityView,
        ).toHaveBeenCalledWith("ABC123", "officers-only");
        expect(
            trendTrackingService.recomputeTrendsForGuild,
        ).toHaveBeenCalledTimes(1);
        expect(trendTrackingService.recomputeTrendsForGuild).toHaveBeenCalledWith(
            "guild-1",
        );
    });

    it("rejects officers-only details component when recap is unrestricted", async () => {
        const wclClient = {
            fetchAndNormalizeReport: vi.fn(),
            findPreviousRaidSummaries: vi.fn(),
        } as never;

        const guildConfigStore: GuildConfigStore = {
            getGuildConfig: vi.fn(),
            saveGuildConfig: vi.fn(),
        };

        const recapPreviewStateService = {
            savePreviewState: vi.fn(),
            getValidPreviewState: vi.fn().mockResolvedValue({
                guildId: "guild-1",
                channelId: "channel-1",
                reportCode: "ABC123",
                sourceUrl: "https://www.warcraftlogs.com/reports/ABC123",
                summaryPayload: {
                    reportTitle: "Raid Night",
                    reportDateISO: new Date(0).toISOString(),
                    gameFamily: "retail",
                    bossesKilled: 1,
                    compareModeUsed: "mixed",
                    accountabilityVisibility: "off",
                    coachingShareability: "shareable",
                    recapPostMode: "preview-and-post",
                    topOverallParsers: [],
                    bossHighlights: [],
                    raidSuperlatives: [],
                    teamNote: "Team note",
                },
                createdByUserId: "user-1",
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60_000),
            }),
            consumeValidPreviewState: vi.fn(),
            deletePreviewState: vi.fn(),
        };

        const restricted = await handleInteraction(
            {
                type: InteractionType.MESSAGE_COMPONENT,
                guild_id: "guild-1",
                data: { custom_id: "recap:v1:officers:ABC123:guild-1" },
            },
            { wclClient, guildConfigStore, recapPreviewStateService },
        );

        expect(
            (restricted as { data?: { content?: string } }).data?.content,
        ).toMatch(/not enabled/i);
    });
});

describe("embed rendering", () => {
    it("renders richer public recap fields when available", () => {
        const embed = buildPublicRecapEmbed({
            reportTitle: "Raid Night",
            reportDateISO: new Date(0).toISOString(),
            gameFamily: "mop_classic",
            bossesKilled: 3,
            compareModeUsed: "mixed",
            accountabilityVisibility: "officers-only",
            coachingShareability: "shareable",
            recapPostMode: "preview-and-post",
            bestAverageParse: {
                playerName: "Alyra",
                value: 95,
                metric: "bestPerformanceAverage",
            },
            bestSingleBossParse: {
                playerName: "Alyra",
                value: 99,
                bossName: "Boss",
                fightId: 1,
                metric: "bestPercent",
            },
            bestExecution: { playerName: "Alyra", value: 90 },
            topOverallParsers: [],
            bossHighlights: [
                { bossName: "Boss", fightId: 1, text: "DPS Alyra (12345)" },
                {
                    bossName: "Boss 2",
                    fightId: 2,
                    text: "Execution win on mechanics",
                },
            ],
            raidSuperlatives: [
                { label: "Most deaths", text: "Alyra (1) on Boss" },
            ],
            teamNote: "Team note",
        });

        expect(embed).toMatchInlineSnapshot(`
          {
            "fields": [
              {
                "name": "Raid Facts",
                "value": "Date: 1970-01-01T00:00:00.000Z
          Game: MoP Classic
          Bosses Killed: 3
          Compare Mode: Mixed",
              },
              {
                "name": "Best Single-Boss Parse",
                "value": "Alyra on Boss (99.0 best Percent)",
              },
              {
                "name": "Best Average Parse",
                "value": "Alyra (95.0 best Performance Average)",
              },
              {
                "name": "Best Execution",
                "value": "Alyra (90.0)",
              },
              {
                "name": "Boss Highlights",
                "value": "Boss: DPS Alyra (12345)
          Boss 2: Execution win on mechanics",
              },
              {
                "name": "Superlatives",
                "value": "Most deaths: Alyra (1) on Boss",
              },
              {
                "name": "Team Note",
                "value": "Team note",
              },
            ],
            "title": "Raid Night",
          }
        `);
    });

    it("degrades cleanly when optional fields are missing", () => {
        const embed = buildPublicRecapEmbed({
            reportTitle: "Raid Night",
            reportDateISO: new Date(0).toISOString(),
            gameFamily: "retail",
            bossesKilled: 0,
            compareModeUsed: "character",
            accountabilityVisibility: "off",
            coachingShareability: "private",
            recapPostMode: "preview-only",
            topOverallParsers: [],
            bossHighlights: [
                { bossName: "Boss", fightId: 1, text: "Only one" },
            ],
            raidSuperlatives: [],
            teamNote: "Team note",
        });

        expect(embed).toMatchInlineSnapshot(`
          {
            "fields": [
              {
                "name": "Raid Facts",
                "value": "Date: 1970-01-01T00:00:00.000Z
          Game: Retail
          Bosses Killed: 0
          Compare Mode: Character",
              },
              {
                "name": "Team Note",
                "value": "Team note",
              },
            ],
            "title": "Raid Night",
          }
        `);
    });
});

describe("preview rendering", () => {
    it("includes required compact preview lines", () => {
        const body = buildRecapPreviewBody(
            {
                reportTitle: "Raid Night",
                reportDateISO: new Date(0).toISOString(),
                gameFamily: "retail",
                bossesKilled: 2,
                compareModeUsed: "mixed",
                accountabilityVisibility: "officers-only",
                coachingShareability: "private",
                recapPostMode: "preview-and-post",
                topOverallParsers: [],
                bossHighlights: [],
                raidSuperlatives: [
                    { label: "Most Deaths", text: "Alyra (2)" },
                    { label: "Top Damage", text: "Borin (12345)" },
                    { label: "Ignored", text: "Will not render" },
                ],
                teamNote: "Team note",
            },
            "ABC123",
            "guild-1",
        );

        const description =
            (body.embeds?.[0] as { description?: string } | undefined)
                ?.description ?? "";
        expect(description).toContain("Bosses killed: 2");
        expect(description).toContain("Best overall: n/a");
        expect(description).toContain("Best single boss: n/a");
        expect(description).toContain("Most Deaths: Alyra (2)");
        expect(description).toContain("Top Damage: Borin (12345)");
        expect(description).not.toContain("Ignored");
    });

    it("uses durable recap component ids for preview buttons", () => {
        const body = buildRecapPreviewBody(
            {
                reportTitle: "Raid Night",
                reportDateISO: new Date(0).toISOString(),
                gameFamily: "retail",
                bossesKilled: 2,
                compareModeUsed: "mixed",
                accountabilityVisibility: "officers-only",
                coachingShareability: "private",
                recapPostMode: "preview-and-post",
                topOverallParsers: [],
                bossHighlights: [],
                raidSuperlatives: [],
                teamNote: "Team note",
            },
            "ABC123",
            "guild-1",
        );

        const customId = body.components?.[0]?.components?.[0]?.custom_id ?? "";
        expect(customId).toBe("recap:v1:post:ABC123:guild-1");
    });
});
