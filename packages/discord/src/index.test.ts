import { describe, expect, it, vi } from "vitest";
import { InteractionType } from "discord-interactions";
import type {
    GuildConfigStore,
    NormalizedPlayer,
    NormalizedReport,
} from "@wcl/domain";
import { handleInteraction } from "./index.js";

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
