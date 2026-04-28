
import type { FightSummaryRow } from "@wcl/domain";
import {
    getBossEncounterId,
    parseFightSummaries,
    pickEncounterSummaryFight,
} from "@wcl/domain";
import { createLogger } from "@wcl/shared";
import { asNumber } from "./parsers/index.js";
import {
    createWclQueries,
    REPORT_WIDE_KILL_TABLE_FILTERS,
    type WclQueries,
} from "./queries/index.js";
import {
    REPORT_RECAP_TABLE_DATA_TYPES,
    type TableDataType,
} from "./schema-enums.js";
import { RAW_PAYLOAD_VERSION } from "./cache-policy.js";
import type { WclGraphqlClient } from "./graphql-client.js";
import {
    getArchiveStatus,
    getRateLimitData,
    getReportNode,
    type EncounterSummaryRow,
    type EnrichedRawReport,
    type RateLimitDataSnapshot,
} from "./raw-report.js";

// Reports are fetched from user-submitted URLs/codes, so we intentionally allow unlisted reports.
const DEFAULT_ALLOW_UNLISTED_REPORTS = true;
const BOSS_RANKINGS_CONCURRENCY = 4;
const logger = createLogger("wcl-client");

const getKillEncounterFightIds = (
    report: Record<string, unknown> | undefined,
): number[] => {
    if (!report) return [];

    return parseFightSummaries(report).flatMap((fight) => {
        const encounterID = getBossEncounterId(fight);
        if (typeof encounterID !== "number" || !fight.kill) return [];
        return [fight.id];
    });
};

const mapWithConcurrency = async <TInput, TOutput>(
    inputs: readonly TInput[],
    concurrency: number,
    mapper: (input: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> => {
    const results = new Array<TOutput>(inputs.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), inputs.length);

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (nextIndex < inputs.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                results[currentIndex] = await mapper(
                    inputs[currentIndex] as TInput,
                    currentIndex,
                );
            }
        }),
    );

    return results;
};

type RatePressureLevel = "normal" | "high" | "critical";

const getRatePressure = (
    rateLimitData?: RateLimitDataSnapshot,
): { level: RatePressureLevel; usage: number } => {
    if (!rateLimitData || rateLimitData.limitPerHour <= 0) {
        return { level: "normal", usage: 0 };
    }

    const usage =
        rateLimitData.pointsSpentThisHour / rateLimitData.limitPerHour;
    const remainingPoints =
        rateLimitData.limitPerHour - rateLimitData.pointsSpentThisHour;
    const nearReset = rateLimitData.pointsResetIn <= 90;

    if (
        usage >= 0.97 ||
        (usage >= 0.9 && remainingPoints <= 25 && !nearReset)
    ) {
        return { level: "critical", usage };
    }

    if (usage >= 0.85 || (usage >= 0.8 && !nearReset)) {
        return { level: "high", usage };
    }

    return { level: "normal", usage };
};

const toFightIDs = (
    fightIDs?: number | number[] | null,
): number[] | undefined => {
    if (fightIDs == null) return undefined;
    return Array.isArray(fightIDs) ? fightIDs : [fightIDs];
};

export class ReportFetcher {
    private readonly queries: WclQueries;

    public constructor(private readonly client: WclGraphqlClient) {
        this.queries = createWclQueries(this.client.request.bind(this.client));
    }

    public async fetchEnrichedRawReport(
        code: string,
    ): Promise<EnrichedRawReport> {
        await this.client.authorize();
        const now = (): number => Date.now();
        const logTiming = (
            step: string,
            startedAt: number,
            counts?: Record<string, number>,
        ): void => {
            logger.info(
                {
                    reportCode: code,
                    step,
                    durationMs: now() - startedAt,
                    ...(counts ? { counts } : {}),
                },
                "wcl-client timing",
            );
        };
        const skippedEnrichments: string[] = [];
        const noteSkippedEnrichment = (message: string): void => {
            skippedEnrichments.push(message);
            logger.warn({ reportCode: code }, message);
        };

        logger.info(
            {
                operation: "BaseReportSummary",
                variables: {
                    code,
                    allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                    includeRateLimitData: true,
                },
            },
            "sending graphql query",
        );

        const baseFetchStartedAt = now();
        const base = await this.queries.baseReportSummary({
            code,
            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
            includeRateLimitData: true,
        });
        logTiming("fetch base", baseFetchStartedAt);
        const rateLimitData = getRateLimitData(base);
        const ratePressure = getRatePressure(rateLimitData);
        const baseReport = getReportNode(base);
        const archiveStatus = baseReport
            ? getArchiveStatus(baseReport)
            : undefined;
        const isArchiveAccessLimited =
            archiveStatus?.isArchived && !archiveStatus.isAccessible;

        if (isArchiveAccessLimited) {
            return {
                rawPayloadVersion: RAW_PAYLOAD_VERSION,
                base,
                archiveAccessLimited: true,
                ...(rateLimitData ? { rateLimitData } : {}),
                ...(skippedEnrichments.length > 0
                    ? { skippedEnrichments }
                    : {}),
                encounterSummaries: [],
            };
        }

        let reportRankingsRaw: unknown;
        const reportRankingsStartedAt = now();
        try {
            reportRankingsRaw = await this.queries.reportRankings({
                code,
                allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
            });
        } catch (error) {
            noteSkippedEnrichment(
                `Failed report rankings enrichment; continuing without report rankings (${error instanceof Error ? error.message : "unknown error"}).`,
            );
        }
        logTiming("fetch report rankings", reportRankingsStartedAt, {
            requested: 1,
            succeeded: reportRankingsRaw ? 1 : 0,
        });
        let playerDetailsRaw: unknown;
        let reportTablesRaw:
            | Partial<Record<TableDataType, unknown>>
            | undefined;
        const reportStartTime = asNumber(baseReport?.startTime);
        const reportEndTime = asNumber(baseReport?.endTime);
        const playerDetailsStartedAt = now();
        if (
            typeof reportStartTime === "number" &&
            typeof reportEndTime === "number"
        ) {
            try {
                playerDetailsRaw = await this.queries.playerDetails({
                    code,
                    allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                    startTime: reportStartTime,
                    endTime: reportEndTime,
                });
            } catch (error) {
                noteSkippedEnrichment(
                    `Failed playerDetails enrichment; continuing without player details (${error instanceof Error ? error.message : "unknown error"}).`,
                );
            }
        } else {
            noteSkippedEnrichment(
                "Skipped playerDetails enrichment due to missing report start/end time bounds.",
            );
        }
        logTiming("fetch player details", playerDetailsStartedAt, {
            requested:
                typeof reportStartTime === "number" &&
                typeof reportEndTime === "number"
                    ? 1
                    : 0,
            succeeded: playerDetailsRaw ? 1 : 0,
        });
        const reportWideTablesStartedAt = now();
        const reportWideKillFightIds = getKillEncounterFightIds(baseReport);
        let reportWideTablesRequested = 0;
        let reportWideTablesSucceeded = 0;
        if (ratePressure.level !== "critical") {
            if (reportWideKillFightIds.length > 0) {
                reportTablesRaw = {};
                for (const dataType of REPORT_RECAP_TABLE_DATA_TYPES) {
                    reportWideTablesRequested += 1;
                    try {
                        const tablePayload = await this.queries.reportWideTable(
                            {
                                code,
                                allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                                dataType,
                                fightIDs: reportWideKillFightIds,
                                filterExpression:
                                    REPORT_WIDE_KILL_TABLE_FILTERS[dataType],
                            },
                        );
                        const tableNode = getReportNode(tablePayload)?.table;
                        if (tableNode !== undefined && tableNode !== null) {
                            reportTablesRaw[dataType] = tableNode;
                        }
                        reportWideTablesSucceeded += 1;
                    } catch (error) {
                        noteSkippedEnrichment(
                            `Failed report-wide ${dataType} table enrichment; continuing without this table (${error instanceof Error ? error.message : "unknown error"}).`,
                        );
                    }
                }
            } else {
                noteSkippedEnrichment(
                    "Skipped report-wide tables enrichment due to missing kill fight IDs.",
                );
            }
        } else {
            noteSkippedEnrichment(
                `Skipped report-wide tables enrichment due to critical rate pressure (${Math.round(ratePressure.usage * 100)}% used).`,
            );
        }
        logTiming("fetch report-wide tables", reportWideTablesStartedAt, {
            requested: reportWideTablesRequested,
            succeeded: reportWideTablesSucceeded,
        });
        const rawFights = baseReport ? parseFightSummaries(baseReport) : [];
        const fightsByEncounterId = new Map<number, FightSummaryRow[]>();
        for (const fight of rawFights) {
            const encounterID = getBossEncounterId(fight);
            if (typeof encounterID !== "number") continue;
            const existing = fightsByEncounterId.get(encounterID) ?? [];
            existing.push(fight);
            fightsByEncounterId.set(encounterID, existing);
        }

        if (ratePressure.level === "critical" && fightsByEncounterId.size > 0) {
            noteSkippedEnrichment(
                `Skipped encounter enrichments for ${fightsByEncounterId.size} encounters due to critical rate pressure (${Math.round(ratePressure.usage * 100)}% used).`,
            );
        }

        const perEncounterFetchStartedAt = now();
        const encounterSummaryInputs = Array.from(
            fightsByEncounterId.entries(),
        ).flatMap(([encounterID, encounterFights]) => {
            const summaryFight = pickEncounterSummaryFight(encounterFights);
            if (!summaryFight) return [];
            return [{ encounterID, summaryFight }];
        });
        const encounterSummaryResults = await mapWithConcurrency(
            encounterSummaryInputs,
            BOSS_RANKINGS_CONCURRENCY,
            async ({ encounterID, summaryFight }) => {
                const fightIDs = toFightIDs(summaryFight.id);
                let rankingsPayload: unknown;
                let rankingsSucceeded = false;

                if (ratePressure.level !== "critical") {
                    try {
                        rankingsPayload = await this.queries.bossRankings({
                            code,
                            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
                            ...(fightIDs ? { fightIDs } : {}),
                        });
                        rankingsSucceeded = true;
                    } catch (error) {
                        noteSkippedEnrichment(
                            `Failed boss rankings enrichment for fight ${summaryFight.id} (${summaryFight.name}); continuing without boss rankings (${error instanceof Error ? error.message : "unknown error"}).`,
                        );
                    }
                }

                return {
                    summary: {
                        encounterID,
                        bossName: summaryFight.name,
                        fightId: summaryFight.id,
                        kill: summaryFight.kill,
                        rankings: getReportNode(rankingsPayload)?.rankings,
                        tables: {},
                        ...(typeof summaryFight.difficulty === "number"
                            ? { difficulty: summaryFight.difficulty }
                            : {}),
                    } satisfies EncounterSummaryRow,
                    rankingsSucceeded,
                };
            },
        );
        const encounterSummaries = encounterSummaryResults.map(
            (result) => result.summary,
        );
        const perEncounterRankingsSucceeded = encounterSummaryResults.filter(
            (result) => result.rankingsSucceeded,
        ).length;
        logTiming(
            "per-encounter fetch rankings",
            perEncounterFetchStartedAt,
            {
                requested: encounterSummaryInputs.length,
                summaries: encounterSummaries.length,
                rankingsSucceeded: perEncounterRankingsSucceeded,
                concurrency: BOSS_RANKINGS_CONCURRENCY,
            },
        );

        return {
            rawPayloadVersion: RAW_PAYLOAD_VERSION,
            base,
            ...(rateLimitData ? { rateLimitData } : {}),
            ...(skippedEnrichments.length > 0 ? { skippedEnrichments } : {}),
            reportRankings: getReportNode(reportRankingsRaw)?.rankings,
            playerDetails: getReportNode(playerDetailsRaw)?.playerDetails,
            ...(reportTablesRaw ? { reportTables: reportTablesRaw } : {}),
            encounterSummaries,
        };
    }
}
