
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { GraphQLClient } from "graphql-request";
import { resolveWclAccessToken } from "../src/oauth.js";
import {
    deriveEncounterPhaseTimes,
    summarizeRankingsPayload,
    type EncounterFightForTimings,
    type EncounterPhaseMetadata,
} from "../src/probes/phase-timings.js";
import {
    asArray,
    asNumber,
    asObject,
    asString,
} from "../src/parsers/common.js";

const DEFAULT_API_BASE_URL = "https://www.warcraftlogs.com/api/v2/client";

type ProbeFamily =
    | "base-report"
    | "master-data"
    | "player-details-report-wide"
    | "player-details-fight"
    | "report-rankings"
    | "report-rankings-dps-today"
    | "report-rankings-hps-today"
    | "boss-rankings"
    | "table-damage-done-report-wide"
    | "table-healing-report-wide"
    | "table-deaths-report-wide"
    | "table-dispels-report-wide"
    | "table-interrupts-report-wide"
    | "table-survivability-report-wide"
    | "table-damage-done"
    | "table-damage-taken"
    | "table-healing"
    | "table-deaths"
    | "table-dispels"
    | "table-interrupts"
    | "table-survivability"
    | "encounter-phases"
    | "encounter-phase-times";

type RankingCompareValue = "Rankings" | "Parses";
type RankingTimeframeValue = "Today" | "Historical";
type KillTypeValue = "All" | "Encounters" | "Kills" | "Trash" | "Wipes";

/**
 * NOTE:
 * The Report docs provided in-chat verify RankingCompareType and RankingTimeframeType,
 * but not the enum members for ReportRankingMetricType.
 *
 * We keep the metric spellings already used by the existing probe ("dps" / "hps")
 * rather than inventing new ones.
 */
type RankingMetricValue = "dps" | "hps";

interface ProbeArgs {
    reportCode: string;
    fightId: number;
    encounterId?: number;
    filterExpression?: string;
    verbose: boolean;
}

interface ManifestEntry {
    probeFamily: ProbeFamily;
    success: boolean;
    fixturePath?: string;
    debugPath?: string;
    logsPath?: string;
    errorPath?: string;
    summary?: string;
    errorMessage?: string;
}

interface ProbeFight {
    id: number;
    encounterID: number;
    startTime: number;
    endTime: number;
    kill: boolean;
    phaseTransitions: Array<{ id: number; startTime: number }>;
    difficulty?: number;
    name?: string;
    inProgress?: boolean;
}

const BASE_REPORT_QUERY = `
query ProbeReportIndex($reportCode: String!) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      title
      startTime
      endTime
      zone {
        name
        frozen
        difficulties {
          id
          name
        }
      }
      phases {
        encounterID
        phases {
          id
          name
          isIntermission
        }
      }
      fights(killType: All, translate: false) {
        id
        encounterID
        difficulty
        name
        startTime
        endTime
        kill
        inProgress
        originalEncounterID
        phaseTransitions {
          id
          startTime
        }
      }
    }
  }
}
`;

const MASTER_DATA_QUERY = `
query ProbeMasterData($reportCode: String!) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      masterData(translate: false) {
        actors(type: "Player") {
          id
          name
          subType
          server
        }
        abilities {
          gameID
          name
          type
        }
      }
    }
  }
}
`;

const REPORT_RANKINGS_QUERY = `
query ProbeScopedRankings(
  $reportCode: String!
  $fightIDs: [Int!]
  $difficulty: Int
  $encounterID: Int
  $playerMetric: ReportRankingMetricType
  $timeframe: RankingTimeframeType
  $compare: RankingCompareType
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      rankings(
        fightIDs: $fightIDs
        difficulty: $difficulty
        encounterID: $encounterID
        playerMetric: $playerMetric
        timeframe: $timeframe
        compare: $compare
      )
    }
  }
}
`;

const PLAYER_DETAILS_QUERY = `
query ProbePlayerDetails(
  $reportCode: String!
  $fightIDs: [Int!]
  $difficulty: Int
  $encounterID: Int
  $killType: KillType
  $includeCombatantInfo: Boolean!
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      playerDetails(
        fightIDs: $fightIDs
        difficulty: $difficulty
        encounterID: $encounterID
        killType: $killType
        includeCombatantInfo: $includeCombatantInfo
        translate: false
      )
    }
  }
}
`;

const TABLE_QUERY = `
query ProbeScopedTable(
  $reportCode: String!
  $fightIDs: [Int!]
  $difficulty: Int
  $encounterID: Int
  $killType: KillType
  $dataType: TableDataType!
  $filterExpression: String
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      table(
        fightIDs: $fightIDs
        difficulty: $difficulty
        encounterID: $encounterID
        killType: $killType
        dataType: $dataType
        filterExpression: $filterExpression
        translate: false
      )
    }
  }
}
`;

const getRequiredEnv = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};

const normalizeOptionalString = (value: string | undefined): string | undefined => {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
};

const getArgs = (): ProbeArgs => {
    const args = process.argv.slice(2);
    const reportCode = args[0]?.trim();
    const fightId = Number(args[1]);

    if (!reportCode) {
        throw new Error(
            'Usage: pnpm --filter @wcl/wcl-client probe:public-graphql <reportCode> <fightId> [--encounter <encounterId>] [--filter-expression "<expr>"] [--verbose]',
        );
    }

    if (!Number.isInteger(fightId) || fightId <= 0) {
        throw new Error("fightId must be a positive integer");
    }

    let encounterId: number | undefined;
    let filterExpression: string | undefined;
    let verbose = false;

    for (let index = 2; index < args.length; index += 1) {
        const token = args[index];
        if (token === "--encounter") {
            const value = Number(args[index + 1]);
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error(
                    "--encounter expects a positive integer encounter id",
                );
            }
            encounterId = value;
            index += 1;
            continue;
        }

        if (token === "--filter-expression") {
            const value = normalizeOptionalString(args[index + 1]);
            if (!value) {
                throw new Error(
                    '--filter-expression expects a non-empty string, e.g. --filter-expression \'source.disposition = "friendly"\'',
                );
            }
            filterExpression = value;
            index += 1;
            continue;
        }

        if (token === "--verbose") {
            verbose = true;
            continue;
        }

        throw new Error(`Unknown argument: ${token}`);
    }

    return {
        reportCode,
        fightId,
        verbose,
        ...(typeof encounterId === "number" ? { encounterId } : {}),
        ...(typeof filterExpression === "string" ? { filterExpression } : {}),
    };
};

const summarizeShape = (value: unknown): string => {
    const rootType = Array.isArray(value)
        ? "array"
        : value === null
          ? "null"
          : typeof value;
    const root = asObject(value);
    const keys = root ? Object.keys(root) : [];
    const data = asArray(root?.data);
    const dataLength = data?.length;
    const dataSegment =
        typeof dataLength === "number" ? ` dataLength=${dataLength}` : "";
    return `type=${rootType} keys=[${keys.join(",")}]${dataSegment}`;
};

const normalizeEncounterFights = (report: unknown): ProbeFight[] => {
    return (asArray(asObject(report)?.fights) ?? []).flatMap(
        (value): ProbeFight[] => {
            const row = asObject(value);
            const id = asNumber(row?.id);
            const encounterID =
                asNumber(row?.encounterID) ??
                asNumber(row?.originalEncounterID);
            const startTime = asNumber(row?.startTime);
            const endTime = asNumber(row?.endTime);
            if (
                typeof id !== "number" ||
                typeof encounterID !== "number" ||
                typeof startTime !== "number" ||
                typeof endTime !== "number"
            ) {
                return [];
            }

            const phaseTransitions = (
                asArray(row?.phaseTransitions) ?? []
            ).flatMap((entry) => {
                const transition = asObject(entry);
                const phaseId = asNumber(transition?.id);
                const transitionStart = asNumber(transition?.startTime);
                if (
                    typeof phaseId !== "number" ||
                    typeof transitionStart !== "number"
                ) {
                    return [];
                }
                return [{ id: phaseId, startTime: transitionStart }];
            });

            return [
                {
                    id,
                    encounterID,
                    startTime,
                    endTime,
                    kill: row?.kill === true,
                    phaseTransitions,
                    ...(typeof asNumber(row?.difficulty) === "number"
                        ? { difficulty: asNumber(row?.difficulty) }
                        : {}),
                    ...(typeof asString(row?.name) === "string"
                        ? { name: asString(row?.name) }
                        : {}),
                    ...(row && "inProgress" in row
                        ? { inProgress: row.inProgress === true }
                        : {}),
                },
            ];
        },
    );
};

const normalizeEncounterMetadata = (
    report: unknown,
): Array<{ encounterID: number; phases: EncounterPhaseMetadata[] }> => {
    return (asArray(asObject(report)?.phases) ?? []).flatMap((value) => {
        const row = asObject(value);
        const encounterID = asNumber(row?.encounterID);
        if (typeof encounterID !== "number") {
            return [];
        }

        const phases = (asArray(row?.phases) ?? []).flatMap((phaseValue) => {
            const phase = asObject(phaseValue);
            const id = asNumber(phase?.id);
            const name = asString(phase?.name);
            if (typeof id !== "number" || typeof name !== "string") {
                return [];
            }

            return [
                {
                    id,
                    name,
                    ...(phase && "isIntermission" in phase
                        ? { isIntermission: phase.isIntermission === true }
                        : {}),
                } satisfies EncounterPhaseMetadata,
            ];
        });

        return [{ encounterID, phases }];
    });
};

const resolveSelectedFight = (
    fights: ProbeFight[],
    fightId: number,
): ProbeFight => {
    const selectedFight = fights.find((fight) => fight.id === fightId);
    if (!selectedFight) {
        throw new Error(
            `Could not find selected fight ${fightId} in the base report payload.`,
        );
    }
    return selectedFight;
};

const resolveEncounterId = (
    fights: ProbeFight[],
    fightId: number,
    requestedEncounterId?: number,
): number => {
    if (typeof requestedEncounterId === "number") {
        return requestedEncounterId;
    }

    return resolveSelectedFight(fights, fightId).encounterID;
};

const getRankingsSummary = (payload: unknown): string =>
    summarizeRankingsPayload(payload).logLine;

const fightMatchesDifficulty = (
    fight: ProbeFight,
    difficulty?: number,
): boolean => {
    if (typeof difficulty !== "number") {
        return true;
    }

    return (
        typeof fight.difficulty !== "number" || fight.difficulty === difficulty
    );
};

const collectEncounterFightIds = (
    fights: ProbeFight[],
    encounterId: number,
    difficulty?: number,
): number[] => {
    const exact = fights
        .filter(
            (fight) =>
                fight.encounterID === encounterId &&
                fightMatchesDifficulty(fight, difficulty),
        )
        .map((fight) => fight.id);

    if (exact.length > 0) {
        return exact;
    }

    return fights
        .filter((fight) => fight.encounterID === encounterId)
        .map((fight) => fight.id);
};

const collectReportEncounterFightIds = (
    fights: ProbeFight[],
    difficulty?: number,
): number[] => {
    const exact = fights
        .filter(
            (fight) =>
                fight.encounterID > 0 &&
                !fight.inProgress &&
                fightMatchesDifficulty(fight, difficulty),
        )
        .map((fight) => fight.id);

    if (exact.length > 0) {
        return exact;
    }

    return fights
        .filter((fight) => fight.encounterID > 0 && !fight.inProgress)
        .map((fight) => fight.id);
};

const ensureFightIds = (fightIds: number[], fallbackFightId: number): number[] =>
    fightIds.length > 0 ? fightIds : [fallbackFightId];

const withOptionalFilterExpression = <T extends Record<string, unknown>>(
    variables: T,
    filterExpression?: string,
): T & { filterExpression?: string } => {
    return typeof filterExpression === "string"
        ? { ...variables, filterExpression }
        : variables;
};

const writeProbeArtifacts = async (args: {
    outputDir: string;
    fixtureName: string;
    probeFamily: ProbeFamily;
    reportCode: string;
    fightId?: number;
    encounterId?: number;
    filterExpression?: string;
    payload?: unknown;
    error?: unknown;
    logs?: unknown;
}): Promise<ManifestEntry> => {
    const { outputDir, fixtureName, probeFamily } = args;
    const envelope = {
        probeFamily,
        reportCode: args.reportCode,
        ...(typeof args.fightId === "number" ? { fightId: args.fightId } : {}),
        ...(typeof args.encounterId === "number"
            ? { encounterId: args.encounterId }
            : {}),
        ...(typeof args.filterExpression === "string"
            ? { filterExpression: args.filterExpression }
            : {}),
        generatedAt: new Date().toISOString(),
        payload: args.payload ?? null,
        ...(typeof args.error !== "undefined" ? { error: args.error } : {}),
        ...(typeof args.logs !== "undefined" ? { logs: args.logs } : {}),
    };

    const debugPath = join(outputDir, `${fixtureName}.debug.json`);
    await writeFile(debugPath, JSON.stringify(envelope, null, 2), "utf8");

    const entry: ManifestEntry = {
        probeFamily,
        success: typeof args.error === "undefined",
        debugPath,
    };

    if (typeof args.payload !== "undefined") {
        const fixturePath = join(outputDir, `${fixtureName}.json`);
        await writeFile(
            fixturePath,
            JSON.stringify(args.payload, null, 2),
            "utf8",
        );
        entry.fixturePath = fixturePath;
    }

    if (typeof args.logs !== "undefined") {
        const logsPath = join(outputDir, `${fixtureName}.logs.json`);
        await writeFile(logsPath, JSON.stringify(args.logs, null, 2), "utf8");
        entry.logsPath = logsPath;
    }

    if (typeof args.error !== "undefined") {
        const errorPath = join(outputDir, `${fixtureName}.error.json`);
        await writeFile(errorPath, JSON.stringify(args.error, null, 2), "utf8");
        entry.errorPath = errorPath;
        entry.errorMessage =
            args.error instanceof Error
                ? args.error.message
                : `Probe failed for ${probeFamily}`;
    }

    return entry;
};

const logProbe = (args: {
    probeFamily: ProbeFamily;
    reportCode: string;
    outputPath?: string;
    fightId?: number;
    encounterId?: number;
    filterExpression?: string;
    summary: string;
}): void => {
    const segments = [
        `[${args.probeFamily}]`,
        `report=${args.reportCode}`,
        ...(typeof args.fightId === "number" ? [`fight=${args.fightId}`] : []),
        ...(typeof args.encounterId === "number"
            ? [`encounter=${args.encounterId}`]
            : []),
        ...(typeof args.filterExpression === "string"
            ? [`filter=${JSON.stringify(args.filterExpression)}`]
            : []),
        ...(args.outputPath ? [`output=${args.outputPath}`] : []),
        args.summary,
    ];

    console.log(segments.join(" "));
};

const run = async (): Promise<void> => {
    const args = getArgs();

    const apiBaseUrl =
        process.env.WCL_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
    const explicitToken = process.env.WCL_OAUTH_TOKEN?.trim();
    const clientId = process.env.WCL_CLIENT_ID?.trim();
    const clientSecret = process.env.WCL_CLIENT_SECRET?.trim();

    const tokenOptions = {
        ...(explicitToken ? { explicitToken } : {}),
        ...(explicitToken
            ? {}
            : {
                  clientId: clientId || getRequiredEnv("WCL_CLIENT_ID"),
                  clientSecret:
                      clientSecret || getRequiredEnv("WCL_CLIENT_SECRET"),
              }),
    };

    const token = await resolveWclAccessToken(tokenOptions);

    const client = new GraphQLClient(apiBaseUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    const outputDir = join(process.cwd(), "src/fixtures/probes");
    await mkdir(outputDir, { recursive: true });

    const manifestEntries: ManifestEntry[] = [];

    let encounterId = args.encounterId;
    let reportNode: Record<string, unknown> | undefined;
    let fights: ProbeFight[] = [];
    let selectedFight: ProbeFight | undefined;
    let selectedDifficulty: number | undefined;
    let reportEncounterFightIds: number[] = [];
    let encounterFightIds: number[] = [];

    try {
        const base = await client.request<unknown>(BASE_REPORT_QUERY, {
            reportCode: args.reportCode,
        });

        reportNode = asObject(asObject(asObject(base)?.reportData)?.report);

        const baseEntry = await writeProbeArtifacts({
            outputDir,
            fixtureName: `base-report.${args.reportCode}`,
            probeFamily: "base-report",
            reportCode: args.reportCode,
            filterExpression: args.filterExpression,
            payload: reportNode ?? null,
        });
        baseEntry.summary = summarizeShape(reportNode);
        manifestEntries.push(baseEntry);
        logProbe({
            probeFamily: "base-report",
            reportCode: args.reportCode,
            filterExpression: args.filterExpression,
            ...(baseEntry.fixturePath
                ? { outputPath: baseEntry.fixturePath }
                : {}),
            summary: baseEntry.summary,
        });

        const masterDataResult = await client.request<unknown>(
            MASTER_DATA_QUERY,
            {
                reportCode: args.reportCode,
            },
        );
        const masterDataNode =
            asObject(asObject(asObject(masterDataResult)?.reportData)?.report)
                ?.masterData ?? null;
        const masterDataEntry = await writeProbeArtifacts({
            outputDir,
            fixtureName: `master-data.${args.reportCode}`,
            probeFamily: "master-data",
            reportCode: args.reportCode,
            filterExpression: args.filterExpression,
            payload: masterDataNode,
        });
        masterDataEntry.summary = summarizeShape(masterDataNode);
        manifestEntries.push(masterDataEntry);
        logProbe({
            probeFamily: "master-data",
            reportCode: args.reportCode,
            filterExpression: args.filterExpression,
            ...(masterDataEntry.fixturePath
                ? { outputPath: masterDataEntry.fixturePath }
                : {}),
            summary: masterDataEntry.summary,
        });

        fights = normalizeEncounterFights(reportNode);
        selectedFight = resolveSelectedFight(fights, args.fightId);
        selectedDifficulty = selectedFight.difficulty;
        encounterId = resolveEncounterId(
            fights,
            args.fightId,
            args.encounterId,
        );
        reportEncounterFightIds = ensureFightIds(
            collectReportEncounterFightIds(fights, selectedDifficulty),
            args.fightId,
        );
        encounterFightIds = ensureFightIds(
            collectEncounterFightIds(fights, encounterId, selectedDifficulty),
            args.fightId,
        );

        const metadataByEncounter = normalizeEncounterMetadata(reportNode);
        const encounterPhases =
            metadataByEncounter.find(
                (entry) => entry.encounterID === encounterId,
            )?.phases ?? [];

        const encounterPhasesEntry = await writeProbeArtifacts({
            outputDir,
            fixtureName: `encounter-phases.${args.reportCode}.encounter-${encounterId}`,
            probeFamily: "encounter-phases",
            reportCode: args.reportCode,
            encounterId,
            filterExpression: args.filterExpression,
            payload: {
                encounterID: encounterId,
                phases: encounterPhases,
            },
        });

        encounterPhasesEntry.summary = `phases=${encounterPhases.length}`;
        manifestEntries.push(encounterPhasesEntry);
        logProbe({
            probeFamily: "encounter-phases",
            reportCode: args.reportCode,
            encounterId,
            filterExpression: args.filterExpression,
            ...(encounterPhasesEntry.fixturePath
                ? { outputPath: encounterPhasesEntry.fixturePath }
                : {}),
            summary: encounterPhasesEntry.summary,
        });

        const phaseTimes = deriveEncounterPhaseTimes({
            encounterId,
            fights: fights as EncounterFightForTimings[],
            metadata: encounterPhases,
        });
        const encounterPhaseTimesEntry = await writeProbeArtifacts({
            outputDir,
            fixtureName: `encounter-phase-times.${args.reportCode}.encounter-${encounterId}`,
            probeFamily: "encounter-phase-times",
            reportCode: args.reportCode,
            encounterId,
            filterExpression: args.filterExpression,
            payload: phaseTimes,
        });
        encounterPhaseTimesEntry.summary = `attempts=${phaseTimes.summary.totalAttempts} kills=${phaseTimes.summary.killCount} wipes=${phaseTimes.summary.wipeCount}`;
        manifestEntries.push(encounterPhaseTimesEntry);
        logProbe({
            probeFamily: "encounter-phase-times",
            reportCode: args.reportCode,
            encounterId,
            filterExpression: args.filterExpression,
            ...(encounterPhaseTimesEntry.fixturePath
                ? { outputPath: encounterPhaseTimesEntry.fixturePath }
                : {}),
            summary: encounterPhaseTimesEntry.summary,
        });
    } catch (error) {
        manifestEntries.push(
            await writeProbeArtifacts({
                outputDir,
                fixtureName: `base-report.${args.reportCode}`,
                probeFamily: "base-report",
                reportCode: args.reportCode,
                filterExpression: args.filterExpression,
                error,
            }),
        );
        throw error;
    }

    const queryFamilies = async <T extends ProbeFamily>(
        probeFamily: T,
        fixtureName: string,
        request: () => Promise<unknown>,
        summarize: (payload: unknown) => string,
        logs?: Record<string, unknown>,
    ): Promise<void> => {
        try {
            const payload = await request();
            const entry = await writeProbeArtifacts({
                outputDir,
                fixtureName,
                probeFamily,
                reportCode: args.reportCode,
                fightId: args.fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
                filterExpression: args.filterExpression,
                payload,
                ...(logs ? { logs } : {}),
            });
            entry.summary = summarize(payload);
            manifestEntries.push(entry);
            logProbe({
                probeFamily,
                reportCode: args.reportCode,
                fightId: args.fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
                filterExpression: args.filterExpression,
                ...(entry.fixturePath ? { outputPath: entry.fixturePath } : {}),
                summary: entry.summary,
            });
        } catch (error) {
            const entry = await writeProbeArtifacts({
                outputDir,
                fixtureName,
                probeFamily,
                reportCode: args.reportCode,
                fightId: args.fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
                filterExpression: args.filterExpression,
                error,
                ...(logs ? { logs } : {}),
            });
            manifestEntries.push(entry);
            logProbe({
                probeFamily,
                reportCode: args.reportCode,
                fightId: args.fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
                filterExpression: args.filterExpression,
                ...(entry.errorPath ? { outputPath: entry.errorPath } : {}),
                summary: entry.errorMessage ?? "request failed",
            });
        }
    };

    await queryFamilies(
        "player-details-report-wide",
        `player-details.report-wide.${args.reportCode}`,
        async () => {
            const variables = {
                reportCode: args.reportCode,
                fightIDs: reportEncounterFightIds,
                ...(typeof selectedDifficulty === "number"
                    ? { difficulty: selectedDifficulty }
                    : {}),
                killType: "Encounters" as KillTypeValue,
                includeCombatantInfo: false,
            };
            const result = await client.request<unknown>(
                PLAYER_DETAILS_QUERY,
                variables,
            );
            return (
                asObject(asObject(asObject(result)?.reportData)?.report)
                    ?.playerDetails ?? null
            );
        },
        summarizeShape,
        {
            scope: "report-wide",
            fightIDs: reportEncounterFightIds,
            ...(typeof selectedDifficulty === "number"
                ? { difficulty: selectedDifficulty }
                : {}),
            killType: "Encounters",
            includeCombatantInfo: false,
        },
    );

    await queryFamilies(
        "player-details-fight",
        `player-details.${args.reportCode}.fight-${args.fightId}`,
        async () => {
            const variables = {
                reportCode: args.reportCode,
                fightIDs: [args.fightId],
                ...(typeof selectedDifficulty === "number"
                    ? { difficulty: selectedDifficulty }
                    : {}),
                ...(typeof encounterId === "number" ? { encounterID: encounterId } : {}),
                killType:
                    selectedFight?.kill === true
                        ? ("Kills" as KillTypeValue)
                        : ("Wipes" as KillTypeValue),
                includeCombatantInfo: true,
            };
            const result = await client.request<unknown>(
                PLAYER_DETAILS_QUERY,
                variables,
            );
            return (
                asObject(asObject(asObject(result)?.reportData)?.report)
                    ?.playerDetails ?? null
            );
        },
        summarizeShape,
        {
            scope: "fight",
            fightIDs: [args.fightId],
            ...(typeof selectedDifficulty === "number"
                ? { difficulty: selectedDifficulty }
                : {}),
            ...(typeof encounterId === "number" ? { encounterID: encounterId } : {}),
            killType: selectedFight?.kill === true ? "Kills" : "Wipes",
            includeCombatantInfo: true,
        },
    );

    await queryFamilies(
        "report-rankings",
        `report-rankings.${args.reportCode}`,
        async () => {
            const variables = {
                reportCode: args.reportCode,
                fightIDs: reportEncounterFightIds,
                ...(typeof selectedDifficulty === "number"
                    ? { difficulty: selectedDifficulty }
                    : {}),
                compare: "Parses" as RankingCompareValue,
                timeframe: "Historical" as RankingTimeframeValue,
            };
            const result = await client.request<unknown>(
                REPORT_RANKINGS_QUERY,
                variables,
            );
            return (
                asObject(asObject(asObject(result)?.reportData)?.report)
                    ?.rankings ?? null
            );
        },
        getRankingsSummary,
        {
            scope: "report-wide",
            fightIDs: reportEncounterFightIds,
            ...(typeof selectedDifficulty === "number"
                ? { difficulty: selectedDifficulty }
                : {}),
            compare: "Parses",
            timeframe: "Historical",
        },
    );

    const reportRankingFamilies: Array<{
        probeFamily: ProbeFamily;
        fixtureName: string;
        playerMetric: RankingMetricValue;
        timeframe: RankingTimeframeValue;
        compare: RankingCompareValue;
    }> = [
        {
            probeFamily: "report-rankings-dps-today",
            fixtureName: `report-rankings.dps.today.${args.reportCode}`,
            playerMetric: "dps",
            timeframe: "Today",
            compare: "Rankings",
        },
        {
            probeFamily: "report-rankings-hps-today",
            fixtureName: `report-rankings.hps.today.${args.reportCode}`,
            playerMetric: "hps",
            timeframe: "Today",
            compare: "Rankings",
        },
    ];

    for (const rankingFamily of reportRankingFamilies) {
        await queryFamilies(
            rankingFamily.probeFamily,
            rankingFamily.fixtureName,
            async () => {
                const variables = {
                    reportCode: args.reportCode,
                    fightIDs: reportEncounterFightIds,
                    ...(typeof selectedDifficulty === "number"
                        ? { difficulty: selectedDifficulty }
                        : {}),
                    playerMetric: rankingFamily.playerMetric,
                    timeframe: rankingFamily.timeframe,
                    compare: rankingFamily.compare,
                };
                const result = await client.request<unknown>(
                    REPORT_RANKINGS_QUERY,
                    variables,
                );
                return (
                    asObject(asObject(asObject(result)?.reportData)?.report)
                        ?.rankings ?? null
                );
            },
            (payload) =>
                `metric=${rankingFamily.playerMetric} timeframe=${rankingFamily.timeframe} compare=${rankingFamily.compare} ${getRankingsSummary(payload)}`,
            {
                scope: "report-wide",
                fightIDs: reportEncounterFightIds,
                ...(typeof selectedDifficulty === "number"
                    ? { difficulty: selectedDifficulty }
                    : {}),
                playerMetric: rankingFamily.playerMetric,
                timeframe: rankingFamily.timeframe,
                compare: rankingFamily.compare,
            },
        );
    }

    await queryFamilies(
        "boss-rankings",
        `boss-rankings.${args.reportCode}.encounter-${encounterId}`,
        async () => {
            const variables = {
                reportCode: args.reportCode,
                fightIDs: encounterFightIds,
                ...(typeof selectedDifficulty === "number"
                    ? { difficulty: selectedDifficulty }
                    : {}),
                ...(typeof encounterId === "number" ? { encounterID: encounterId } : {}),
                compare: "Parses" as RankingCompareValue,
                timeframe: "Historical" as RankingTimeframeValue,
            };
            const result = await client.request<unknown>(
                REPORT_RANKINGS_QUERY,
                variables,
            );
            return (
                asObject(asObject(asObject(result)?.reportData)?.report)
                    ?.rankings ?? null
            );
        },
        getRankingsSummary,
        {
            scope: "encounter",
            fightIDs: encounterFightIds,
            ...(typeof selectedDifficulty === "number"
                ? { difficulty: selectedDifficulty }
                : {}),
            ...(typeof encounterId === "number" ? { encounterID: encounterId } : {}),
            compare: "Parses",
            timeframe: "Historical",
        },
    );

    const reportWideTableFamilies: Array<{
        probeFamily: ProbeFamily;
        dataType: string;
        fixtureName: string;
    }> = [
        {
            probeFamily: "table-damage-done-report-wide",
            dataType: "DamageDone",
            fixtureName: `damage-done.report-wide.${args.reportCode}`,
        },
        {
            probeFamily: "table-healing-report-wide",
            dataType: "Healing",
            fixtureName: `healing.report-wide.${args.reportCode}`,
        },
        {
            probeFamily: "table-deaths-report-wide",
            dataType: "Deaths",
            fixtureName: `deaths.report-wide.${args.reportCode}`,
        },
        {
            probeFamily: "table-dispels-report-wide",
            dataType: "Dispels",
            fixtureName: `dispels.report-wide.${args.reportCode}`,
        },
        {
            probeFamily: "table-interrupts-report-wide",
            dataType: "Interrupts",
            fixtureName: `interrupts.report-wide.${args.reportCode}`,
        },
        {
            probeFamily: "table-survivability-report-wide",
            dataType: "Survivability",
            fixtureName: `survivability.report-wide.${args.reportCode}`,
        },
    ];

    for (const tableFamily of reportWideTableFamilies) {
        await queryFamilies(
            tableFamily.probeFamily,
            tableFamily.fixtureName,
            async () => {
                const variables = withOptionalFilterExpression(
                    {
                        reportCode: args.reportCode,
                        fightIDs: reportEncounterFightIds,
                        ...(typeof selectedDifficulty === "number"
                            ? { difficulty: selectedDifficulty }
                            : {}),
                        killType: "Encounters" as KillTypeValue,
                        dataType: tableFamily.dataType,
                    },
                    args.filterExpression,
                );
                const result = await client.request<unknown>(
                    TABLE_QUERY,
                    variables,
                );
                return (
                    asObject(asObject(asObject(result)?.reportData)?.report)
                        ?.table ?? null
                );
            },
            summarizeShape,
            {
                scope: "report-wide",
                fightIDs: reportEncounterFightIds,
                ...(typeof selectedDifficulty === "number"
                    ? { difficulty: selectedDifficulty }
                    : {}),
                killType: "Encounters",
                dataType: tableFamily.dataType,
                ...(typeof args.filterExpression === "string"
                    ? { filterExpression: args.filterExpression }
                    : {}),
            },
        );
    }

    const tableFamilies: Array<{
        probeFamily: ProbeFamily;
        dataType: string;
        filePrefix: string;
    }> = [
        {
            probeFamily: "table-damage-done",
            dataType: "DamageDone",
            filePrefix: "damage-done",
        },
        {
            probeFamily: "table-damage-taken",
            dataType: "DamageTaken",
            filePrefix: "damage-taken",
        },
        {
            probeFamily: "table-healing",
            dataType: "Healing",
            filePrefix: "healing",
        },
        {
            probeFamily: "table-deaths",
            dataType: "Deaths",
            filePrefix: "deaths",
        },
        {
            probeFamily: "table-dispels",
            dataType: "Dispels",
            filePrefix: "dispels",
        },
        {
            probeFamily: "table-interrupts",
            dataType: "Interrupts",
            filePrefix: "interrupts",
        },
        {
            probeFamily: "table-survivability",
            dataType: "Survivability",
            filePrefix: "survivability",
        },
    ];

    for (const tableFamily of tableFamilies) {
        await queryFamilies(
            tableFamily.probeFamily,
            `${tableFamily.filePrefix}.${args.reportCode}.fight-${args.fightId}`,
            async () => {
                const variables = withOptionalFilterExpression(
                    {
                        reportCode: args.reportCode,
                        fightIDs: [args.fightId],
                        ...(typeof selectedDifficulty === "number"
                            ? { difficulty: selectedDifficulty }
                            : {}),
                        ...(typeof encounterId === "number"
                            ? { encounterID: encounterId }
                            : {}),
                        killType:
                            selectedFight?.kill === true
                                ? ("Kills" as KillTypeValue)
                                : ("Wipes" as KillTypeValue),
                        dataType: tableFamily.dataType,
                    },
                    args.filterExpression,
                );
                const result = await client.request<unknown>(
                    TABLE_QUERY,
                    variables,
                );
                return (
                    asObject(asObject(asObject(result)?.reportData)?.report)
                        ?.table ?? null
                );
            },
            summarizeShape,
            {
                scope: "fight",
                fightIDs: [args.fightId],
                ...(typeof selectedDifficulty === "number"
                    ? { difficulty: selectedDifficulty }
                    : {}),
                ...(typeof encounterId === "number" ? { encounterID: encounterId } : {}),
                killType: selectedFight?.kill === true ? "Kills" : "Wipes",
                dataType: tableFamily.dataType,
                ...(typeof args.filterExpression === "string"
                    ? { filterExpression: args.filterExpression }
                    : {}),
            },
        );
    }

    const manifestPath = join(
        outputDir,
        `public-probe-manifest.${args.reportCode}.fight-${args.fightId}.json`,
    );
    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                reportCode: args.reportCode,
                fightId: args.fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
                ...(typeof args.filterExpression === "string"
                    ? { filterExpression: args.filterExpression }
                    : {}),
                generatedAt: new Date().toISOString(),
                probeFamiliesRun: manifestEntries.map(
                    (entry) => entry.probeFamily,
                ),
                entries: manifestEntries.map((entry) => ({
                    ...entry,
                    ...(entry.fixturePath
                        ? {
                              fixturePath: relative(
                                  process.cwd(),
                                  entry.fixturePath,
                              ),
                          }
                        : {}),
                    ...(entry.debugPath
                        ? {
                              debugPath: relative(
                                  process.cwd(),
                                  entry.debugPath,
                              ),
                          }
                        : {}),
                    ...(entry.logsPath
                        ? { logsPath: relative(process.cwd(), entry.logsPath) }
                        : {}),
                    ...(entry.errorPath
                        ? {
                              errorPath: relative(
                                  process.cwd(),
                                  entry.errorPath,
                              ),
                          }
                        : {}),
                })),
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log(
        `[manifest] report=${args.reportCode} fight=${args.fightId} output=${relative(process.cwd(), manifestPath)} entries=${manifestEntries.length}`,
    );

    if (args.verbose && reportNode) {
        console.log(JSON.stringify(reportNode, null, 2));
    }
};

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Public GraphQL probe run failed: ${message}`);
    process.exitCode = 1;
});
