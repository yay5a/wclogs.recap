import mongoose from "mongoose";
import type { NormalizedReport, TrendTrackingService } from "@wcl/domain";
import {
    PlayerRaidSummaryModel,
    RaidSnapshotModel,
    TrendSnapshotModel,
} from "../index.js";

export class MongoTrendTrackingService implements TrendTrackingService {
    public async ingestRaidHistory(
        guildId: string,
        report: NormalizedReport,
    ): Promise<void> {
        await RaidSnapshotModel.findOneAndUpdate(
            { guildId, reportCode: report.reportCode },
            {
                $set: {
                    guildId,
                    reportCode: report.reportCode,
                    title: report.title,
                    zoneName: report.zoneName,
                    gameFamily: report.gameFamily,
                    startedAt: new Date(report.startTime),
                    endedAt: new Date(report.endTime),
                },
            },
            {
                upsert: true,
                setDefaultsOnInsert: true,
            },
        );

        const captures = report.players.map((player) => {
            const setPayload: Record<string, unknown> = {
                guildId,
                reportCode: report.reportCode,
                characterName: player.name,
                capturedAt: new Date(report.endTime),
            };
            if (typeof player.bestParse === "number") {
                setPayload.bestParse = player.bestParse;
            }
            if (typeof player.avgParse === "number") {
                setPayload.averageParse = player.avgParse;
            }
            if (typeof player.executionScore === "number") {
                setPayload.executionScore = player.executionScore;
            }

            return {
                updateOne: {
                    filter: {
                        guildId,
                        reportCode: report.reportCode,
                        characterName: player.name,
                    },
                    update: {
                        $set: setPayload,
                    },
                    upsert: true,
                },
            };
        });

        if (captures.length > 0) {
            await PlayerRaidSummaryModel.bulkWrite(captures);
        }
    }

    public async recomputeTrendsForGuild(guildId: string): Promise<void> {
        const capturedAt = new Date();
        console.info("trend recomputation started", { guildId });

        const summaries = await PlayerRaidSummaryModel.find({ guildId })
            .sort({
                capturedAt: 1,
                reportCode: 1,
                characterName: 1,
            })
            .lean();

        type PlayerSummary = {
            reportCode?: string;
            averageParse?: number;
            executionScore?: number;
            capturedAt?: Date;
        };

        type PlayerIdentity = {
            key: string;
            guildId: string;
            snapshots: PlayerSummary[];
            playerProfileId?: mongoose.Types.ObjectId;
            playerName?: string;
        };

        const players = new Map<string, PlayerIdentity>();
        for (const summary of summaries) {
            const rawProfileId = summary.playerProfileId;
            const profileId =
                rawProfileId instanceof mongoose.Types.ObjectId
                    ? rawProfileId
                    : undefined;

            const name =
                typeof summary.characterName === "string" &&
                summary.characterName.trim().length > 0
                    ? summary.characterName.trim()
                    : undefined;

            const key = profileId
                ? `profile:${String(profileId)}`
                : `name:${name ?? "unknown"}`;

            const existing = players.get(key);
            if (existing) {
                existing.snapshots.push(summary as PlayerSummary);
                continue;
            }

            const playerIdentity: PlayerIdentity = {
                key,
                guildId,
                snapshots: [summary as PlayerSummary],
                ...(profileId ? { playerProfileId: profileId } : {}),
                ...(!profileId && name ? { playerName: name } : {}),
            };

            players.set(key, playerIdentity);
        }

        const windows = [
            { size: 3, label: "last_3_raids" },
            { size: 5, label: "last_5_raids" },
        ] as const;

        const average = (values: number[]): number | undefined => {
            if (values.length === 0) return undefined;
            return values.reduce((acc, value) => acc + value, 0) / values.length;
        };

        type TrendBulkWriteOperations = NonNullable<
            Parameters<typeof TrendSnapshotModel.bulkWrite>[0]
        >;
        const operations: TrendBulkWriteOperations = [];

        for (const player of players.values()) {
            for (const window of windows) {
                if (player.snapshots.length < window.size) {
                    continue;
                }

                const samples = player.snapshots.slice(-window.size);
                const parseValues = samples
                    .map((sample) => sample.averageParse)
                    .filter(
                        (value): value is number => typeof value === "number",
                    );
                const executionValues = samples
                    .map((sample) => sample.executionScore)
                    .filter(
                        (value): value is number => typeof value === "number",
                    );

                const parseAverage = average(parseValues);
                const executionAverage = average(executionValues);

                const identityFilter = player.playerProfileId
                    ? { playerProfileId: player.playerProfileId }
                    : player.playerName
                      ? { playerName: player.playerName }
                      : undefined;

                if (!identityFilter) {
                    continue;
                }

                const enqueueMetric = (metric: string, value: number) => {
                    const filter = {
                        guildId,
                        metric,
                        window: window.label,
                        ...identityFilter,
                    };

                    operations.push({
                        updateOne: {
                            filter,
                            update: {
                                $set: {
                                    ...filter,
                                    value,
                                    capturedAt,
                                },
                            },
                            upsert: true,
                        },
                    });
                };

                if (typeof parseAverage === "number") {
                    enqueueMetric("parse_average", parseAverage);
                }
                if (typeof executionAverage === "number") {
                    enqueueMetric("execution_average", executionAverage);
                }
                enqueueMetric("attendance_count", samples.length);
            }
        }

        if (operations.length === 0) {
            console.info("trend recomputation skipped; no trend windows derived", {
                guildId,
                players: players.size,
            });
            return;
        }

        try {
            await TrendSnapshotModel.bulkWrite(operations);
            console.info("trend recomputation completed", {
                guildId,
                players: players.size,
                snapshotsUpserted: operations.length,
            });
        } catch (error) {
            console.error("trend recomputation failed", {
                guildId,
                error,
            });
            throw error;
        }
    }
}
