import { describe, expect, it, vi, afterEach } from "vitest";
import { InteractionType } from "discord-interactions";
import type {
    GuildConfigStore,
    NormalizedPlayer,
    NormalizedReport,
} from "@wcl/domain";
import {
    buildDiscordCommandPayload,
    buildDiscordCommandPayloads,
    DiscordCommandRegistrationError,
    handleInteraction,
    registerCommands,
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
            name: "Alyra",
            bestParse: 90,
            avgParse: 85,
            executionScore: 88,
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

describe("registerCommands", () => {
    it("registers guild commands when guildId is provided", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue("ok"),
        });
        vi.stubGlobal("fetch", fetchMock);

        await registerCommands("app123", "token123", { guildId: "guild456" });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://discord.com/api/v10/applications/app123/guilds/guild456/commands",
            expect.objectContaining({ method: "PUT" }),
        );
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
            registerCommands("app123", "token123"),
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
            { wclClient, guildConfigStore },
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
        const preview = await handleInteraction(
            {
                type: InteractionType.APPLICATION_COMMAND,
                guild_id: "guild-1",
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
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            },
        );

        const rawData = preview as {
            data?: {
                components?: Array<{
                    components: Array<{ custom_id: string }>;
                }>;
            };
        };
        const customId =
            rawData.data?.components?.[0]?.components?.[0]?.custom_id;
        expect(customId).toContain("post_recap:ABC123:guild-1");

        const posted = await handleInteraction(
            {
                type: InteractionType.MESSAGE_COMPONENT,
                guild_id: "guild-1",
                data: { custom_id: customId ?? "" },
            },
            {
                wclClient,
                guildConfigStore,
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            },
        );

        expect(
            (posted as { data?: { embeds?: unknown[] } }).data?.embeds?.length,
        ).toBe(1);
        expect(
            coachingViewService.buildShareableCoachingView,
        ).toHaveBeenCalledWith("ABC123");
        expect(
            accountabilityViewService.buildAccountabilityView,
        ).toHaveBeenCalledWith("ABC123", "officers-only");
    });
});
