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

const TABLE_DATA_TYPES = [
    "Summary",
    "DamageDone",
    "DamageTaken",
    "Healing",
    "Deaths",
    "Dispels",
    "Interrupts",
    "Survivability",
] as const;

type ProbeFamily =
    | "base-report"
    | "master-data"
    | "encounter-phases"
    | "encounter-phase-times"
    | "player-details"
    | "rankings"
    | "table";

type ScopeType = "report-wide" | "encounter" | "fight";
type ScopePartition = "combined" | "kills" | "wipes";
type RankingCompareValue = "Rankings" | "Parses";
type RankingTimeframeValue = "Today" | "Historical";
type KillTypeValue = "All" | "Encounters" | "Kills" | "Trash" | "Wipes";

/**
 * NOTE:
 * API docs confirm RankingCompareType and RankingTimeframeType,
 * but they do not show the enum members for ReportRankingMetricType.
 *
 * We preserve the existing probe's metric spellings rather than inventing new ones.
 */
type RankingMetricValue = "dps" | "hps";

type TableDataTypeValue = (typeof TABLE_DATA_TYPES)[number];

interface ProbeArgs {
    reportCode: string;
    fightId?: number;
    encounterId?: number;
    filterExpression?: string;
    phase?: number;
    verbose: boolean;
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

interface ProbeScope {
    scopeKey: string;
    scopeType: ScopeType;
    partition: ScopePartition;
    fightIDs: number[];
    killType: KillTypeValue;
    encounterID?: number;
    anchorFightId?: number;
}

interface ProbeMetadata {
    scopeKey?: string;
    scopeType?: ScopeType;
    partition?: ScopePartition;
    fightIDs?: number[];
    fightId?: number;
    encounterId?: number;
    filterExpression?: string;
    [key: string]: unknown;
}

interface ManifestEntry {
    probeFamily: ProbeFamily;
    success: boolean;
    scopeKey?: string;
    scopeType?: ScopeType;
    partition?: ScopePartition;
    fixturePath?: string;
    debugPath?: string;
    logsPath?: string;
    errorPath?: string;
    summary?: string;
    errorMessage?: string;
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
  $encounterID: Int
  $playerMetric: ReportRankingMetricType
  $timeframe: RankingTimeframeType
  $compare: RankingCompareType
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      rankings(
        fightIDs: $fightIDs
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
  $encounterID: Int
  $killType: KillType
  $includeCombatantInfo: Boolean!
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      playerDetails(
        fightIDs: $fightIDs
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
  $encounterID: Int
  $killType: KillType
  $dataType: TableDataType!
  $filterExpression: String
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      table(
        fightIDs: $fightIDs
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

const normalizeOptionalString = (
    value: string | undefined,
): string | undefined => {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
};

const joinExpressionClauses = (
    clauses: Array<string | undefined>,
): string | undefined => {
    const normalizedClauses = clauses.flatMap((clause) => {
        const normalized = normalizeOptionalString(clause);
        return normalized ? [normalized] : [];
    });

    if (normalizedClauses.length === 0) {
        return undefined;
    }

    return normalizedClauses.map((clause) => `(${clause})`).join(" AND ");
};

const buildBaseFilterExpression = (
    args: Pick<ProbeArgs, "filterExpression" | "phase">,
): string | undefined => {
    return joinExpressionClauses([
        args.filterExpression,
        typeof args.phase === "number"
            ? `encounterPhase = ${args.phase}`
            : undefined,
    ]);
};

const getPartitionExpression = (scope: ProbeScope): string | undefined => {
    const encounterScopeExpression =
        typeof scope.encounterID === "number"
            ? `encounterID = ${scope.encounterID}`
            : scope.scopeType === "report-wide"
              ? "encounterID != 0"
              : undefined;

    const outcomeExpression =
        scope.partition === "kills"
            ? 'encounterEnd = "kill"'
            : scope.partition === "wipes"
              ? 'encounterEnd = "wipe"'
              : undefined;

    return joinExpressionClauses([encounterScopeExpression, outcomeExpression]);
};

const buildTableFilterExpression = (args: {
    scope: ProbeScope;
    dataType: TableDataTypeValue;
    filterExpression?: string;
    phase?: number;
}): string | undefined => {
    const baseFilterExpression = buildBaseFilterExpression(args);
    const partitionExpression = getPartitionExpression(args.scope);

    switch (args.dataType) {
        case "Summary":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
            ]);
        case "DamageDone":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
                'source.disposition = "friendly"',
                'target.disposition = "enemy"',
            ]);
        case "DamageTaken":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
                'target.disposition = "friendly"',
            ]);
        case "Healing":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
                'inCategory("healing") = true',
                'source.disposition = "friendly"',
                'target.disposition = "friendly"',
            ]);
        case "Deaths":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
                'type = "death"',
                'target.disposition = "friendly"',
                "feign = false",
            ]);
        case "Dispels":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
                'source.disposition = "friendly"',
            ]);
        case "Interrupts":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
                'type = "interrupt"',
                'source.disposition = "friendly"',
                'target.disposition = "enemy"',
            ]);
        case "Survivability":
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
                'target.disposition = "friendly"',
            ]);
        default:
            return joinExpressionClauses([
                baseFilterExpression,
                partitionExpression,
            ]);
    }
};

const getArgs = (): ProbeArgs => {
    const args = process.argv.slice(2);
    const reportCode = args[0]?.trim();

    if (!reportCode) {
        throw new Error(
            'Usage: pnpm --filter @wcl/wcl-client probe:public-graphql <reportCode> [fightId] [--encounter <encounterId>] [--phase <phaseNumber>] [--filter-expression "<expr>"] [--verbose]',
        );
    }

    let index = 1;
    let fightId: number | undefined;
    const positionalFightId = args[index];
    if (
        typeof positionalFightId === "string" &&
        !positionalFightId.startsWith("--")
    ) {
        const value = Number(positionalFightId);
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error("fightId must be a positive integer when provided");
        }
        fightId = value;
        index += 1;
    }

    let encounterId: number | undefined;
    let filterExpression: string | undefined;
    let phase: number | undefined;
    let verbose = false;

    for (; index < args.length; index += 1) {
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

        if (token === "--phase") {
            const value = Number(args[index + 1]);
            if (!Number.isInteger(value) || value <= 0) {
                throw new Error(
                    "--phase expects a positive integer phase number",
                );
            }
            phase = value;
            index += 1;
            continue;
        }

        if (token === "--filter-expression") {
            const value = normalizeOptionalString(args[index + 1]);
            if (!value) {
                throw new Error(
                    "--filter-expression expects a non-empty string, e.g. --filter-expression 'source.spec = \"frost\"'",
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
        verbose,
        ...(typeof fightId === "number" ? { fightId } : {}),
        ...(typeof encounterId === "number" ? { encounterId } : {}),
        ...(typeof filterExpression === "string" ? { filterExpression } : {}),
        ...(typeof phase === "number" ? { phase } : {}),
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

            const difficulty = asNumber(row?.difficulty);
            const name = asString(row?.name);

            return [
                {
                    id,
                    encounterID,
                    startTime,
                    endTime,
                    kill: row?.kill === true,
                    phaseTransitions,
                    ...(typeof difficulty === "number" ? { difficulty } : {}),
                    ...(typeof name === "string" ? { name } : {}),
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

const uniqueSortedNumbers = (values: number[]): number[] =>
    [...new Set(values)].sort((left, right) => left - right);

const resolveSelectedFight = (
    fights: ProbeFight[],
    fightId?: number,
): ProbeFight | undefined => {
    if (typeof fightId !== "number") {
        return undefined;
    }

    const selectedFight = fights.find((fight) => fight.id === fightId);
    if (!selectedFight) {
        throw new Error(
            `Could not find selected fight ${fightId} in the base report payload.`,
        );
    }
    return selectedFight;
};

const collectEncounterCandidateFights = (
    fights: ProbeFight[],
    encounterId?: number,
): ProbeFight[] => {
    return fights.filter(
        (fight) =>
            fight.encounterID > 0 &&
            !fight.inProgress &&
            (typeof encounterId !== "number" ||
                fight.encounterID === encounterId),
    );
};

const buildScopeKey = (
    scopeType: ScopeType,
    partition: ScopePartition,
    args: {
        encounterID?: number;
        fightId?: number;
    } = {},
): string => {
    if (scopeType === "report-wide") {
        return `${scopeType}.${partition}`;
    }
    if (scopeType === "encounter") {
        return `encounter-${args.encounterID}.${partition}`;
    }
    return `fight-${args.fightId}.${partition}`;
};

const buildDiscoveryScopes = (args: {
    fights: ProbeFight[];
    selectedFight?: ProbeFight;
    encounterId?: number;
}): ProbeScope[] => {
    const encounterFights = collectEncounterCandidateFights(
        args.fights,
        args.encounterId,
    );
    if (encounterFights.length === 0) {
        throw new Error(
            "No completed encounter pulls were found in the report for discovery probing.",
        );
    }

    const scopes: ProbeScope[] = [];

    const addPartitionedScopes = (scopeArgs: {
        scopeType: ScopeType;
        encounterID?: number;
        anchorFightId?: number;
        fights: ProbeFight[];
    }): void => {
        const combinedFightIDs = scopeArgs.fights.map((fight) => fight.id);
        if (combinedFightIDs.length > 0) {
            scopes.push({
                scopeKey: buildScopeKey(scopeArgs.scopeType, "combined", {
                    ...(typeof scopeArgs.encounterID === "number"
                        ? { encounterID: scopeArgs.encounterID }
                        : {}),
                    ...(typeof scopeArgs.anchorFightId === "number"
                        ? { fightId: scopeArgs.anchorFightId }
                        : {}),
                }),
                scopeType: scopeArgs.scopeType,
                partition: "combined",
                fightIDs: combinedFightIDs,
                killType: "Encounters",
                ...(typeof scopeArgs.encounterID === "number"
                    ? { encounterID: scopeArgs.encounterID }
                    : {}),
                ...(typeof scopeArgs.anchorFightId === "number"
                    ? { anchorFightId: scopeArgs.anchorFightId }
                    : {}),
            });
        }

        const killFightIDs = scopeArgs.fights
            .filter((fight) => fight.kill)
            .map((fight) => fight.id);
        if (killFightIDs.length > 0) {
            scopes.push({
                scopeKey: buildScopeKey(scopeArgs.scopeType, "kills", {
                    ...(typeof scopeArgs.encounterID === "number"
                        ? { encounterID: scopeArgs.encounterID }
                        : {}),
                    ...(typeof scopeArgs.anchorFightId === "number"
                        ? { fightId: scopeArgs.anchorFightId }
                        : {}),
                }),
                scopeType: scopeArgs.scopeType,
                partition: "kills",
                fightIDs: killFightIDs,
                killType: "Kills",
                ...(typeof scopeArgs.encounterID === "number"
                    ? { encounterID: scopeArgs.encounterID }
                    : {}),
                ...(typeof scopeArgs.anchorFightId === "number"
                    ? { anchorFightId: scopeArgs.anchorFightId }
                    : {}),
            });
        }

        const wipeFightIDs = scopeArgs.fights
            .filter((fight) => !fight.kill)
            .map((fight) => fight.id);
        if (wipeFightIDs.length > 0) {
            scopes.push({
                scopeKey: buildScopeKey(scopeArgs.scopeType, "wipes", {
                    ...(typeof scopeArgs.encounterID === "number"
                        ? { encounterID: scopeArgs.encounterID }
                        : {}),
                    ...(typeof scopeArgs.anchorFightId === "number"
                        ? { fightId: scopeArgs.anchorFightId }
                        : {}),
                }),
                scopeType: scopeArgs.scopeType,
                partition: "wipes",
                fightIDs: wipeFightIDs,
                killType: "Wipes",
                ...(typeof scopeArgs.encounterID === "number"
                    ? { encounterID: scopeArgs.encounterID }
                    : {}),
                ...(typeof scopeArgs.anchorFightId === "number"
                    ? { anchorFightId: scopeArgs.anchorFightId }
                    : {}),
            });
        }
    };

    addPartitionedScopes({
        scopeType: "report-wide",
        fights: encounterFights,
    });

    const encounterIds = uniqueSortedNumbers(
        encounterFights.map((fight) => fight.encounterID),
    );
    for (const encounterID of encounterIds) {
        addPartitionedScopes({
            scopeType: "encounter",
            encounterID,
            fights: encounterFights.filter(
                (fight) => fight.encounterID === encounterID,
            ),
        });
    }

    if (args.selectedFight) {
        addPartitionedScopes({
            scopeType: "fight",
            encounterID: args.selectedFight.encounterID,
            anchorFightId: args.selectedFight.id,
            fights: [args.selectedFight],
        });
    }

    return scopes;
};

const getRankingsSummary = (payload: unknown): string =>
    summarizeRankingsPayload(payload).logLine;

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
    metadata?: ProbeMetadata;
    payload?: unknown;
    error?: unknown;
    logs?: unknown;
}): Promise<ManifestEntry> => {
    const { outputDir, fixtureName, probeFamily } = args;
    const envelope = {
        probeFamily,
        reportCode: args.reportCode,
        ...(args.metadata ?? {}),
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
        ...(typeof args.metadata?.scopeKey === "string"
            ? { scopeKey: args.metadata.scopeKey }
            : {}),
        ...(args.metadata?.scopeType
            ? { scopeType: args.metadata.scopeType }
            : {}),
        ...(args.metadata?.partition
            ? { partition: args.metadata.partition }
            : {}),
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
    scopeKey?: string;
    outputPath?: string;
    filterExpression?: string;
    summary: string;
}): void => {
    const segments = [
        `[${args.probeFamily}]`,
        `report=${args.reportCode}`,
        ...(typeof args.scopeKey === "string"
            ? [`scope=${args.scopeKey}`]
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
    const requestedFilterExpression = normalizeOptionalString(
        args.filterExpression,
    );
    const baseFilterExpression = buildBaseFilterExpression({
        ...(typeof requestedFilterExpression === "string"
            ? { filterExpression: requestedFilterExpression }
            : {}),
        ...(typeof args.phase === "number" ? { phase: args.phase } : {}),
    });

    let reportNode: Record<string, unknown> | undefined;
    let fights: ProbeFight[] = [];
    let selectedFight: ProbeFight | undefined;
    let scopes: ProbeScope[] = [];
    let discoveryEncounterIds: number[] = [];

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
            payload: reportNode ?? null,
        });
        baseEntry.summary = summarizeShape(reportNode);
        manifestEntries.push(baseEntry);
        logProbe({
            probeFamily: "base-report",
            reportCode: args.reportCode,
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
            payload: masterDataNode,
        });
        masterDataEntry.summary = summarizeShape(masterDataNode);
        manifestEntries.push(masterDataEntry);
        logProbe({
            probeFamily: "master-data",
            reportCode: args.reportCode,
            ...(masterDataEntry.fixturePath
                ? { outputPath: masterDataEntry.fixturePath }
                : {}),
            summary: masterDataEntry.summary,
        });

        fights = normalizeEncounterFights(reportNode);
        selectedFight = resolveSelectedFight(fights, args.fightId);
        scopes = buildDiscoveryScopes({
            fights,
            ...(selectedFight ? { selectedFight } : {}),
            ...(typeof args.encounterId === "number"
                ? { encounterId: args.encounterId }
                : {}),
        });
        discoveryEncounterIds = uniqueSortedNumbers(
            scopes.flatMap((scope) =>
                scope.scopeType === "encounter" &&
                typeof scope.encounterID === "number"
                    ? [scope.encounterID]
                    : [],
            ),
        );

        const metadataByEncounter = normalizeEncounterMetadata(reportNode);
        for (const encounterID of discoveryEncounterIds) {
            const encounterPhases =
                metadataByEncounter.find(
                    (entry) => entry.encounterID === encounterID,
                )?.phases ?? [];
            const encounterFights = collectEncounterCandidateFights(
                fights,
                encounterID,
            );

            const encounterPhasesEntry = await writeProbeArtifacts({
                outputDir,
                fixtureName: `encounter-phases.${args.reportCode}.encounter-${encounterID}`,
                probeFamily: "encounter-phases",
                reportCode: args.reportCode,
                metadata: {
                    scopeKey: `encounter-${encounterID}.combined`,
                    scopeType: "encounter",
                    partition: "combined",
                    encounterId: encounterID,
                    fightIDs: encounterFights.map((fight) => fight.id),
                },
                payload: {
                    encounterID,
                    phases: encounterPhases,
                },
            });
            encounterPhasesEntry.summary = `phases=${encounterPhases.length}`;
            manifestEntries.push(encounterPhasesEntry);
            logProbe({
                probeFamily: "encounter-phases",
                reportCode: args.reportCode,
                scopeKey: `encounter-${encounterID}.combined`,
                ...(encounterPhasesEntry.fixturePath
                    ? { outputPath: encounterPhasesEntry.fixturePath }
                    : {}),
                summary: encounterPhasesEntry.summary,
            });

            const phaseTimes = deriveEncounterPhaseTimes({
                encounterId: encounterID,
                fights: encounterFights as EncounterFightForTimings[],
                metadata: encounterPhases,
            });
            const encounterPhaseTimesEntry = await writeProbeArtifacts({
                outputDir,
                fixtureName: `encounter-phase-times.${args.reportCode}.encounter-${encounterID}`,
                probeFamily: "encounter-phase-times",
                reportCode: args.reportCode,
                metadata: {
                    scopeKey: `encounter-${encounterID}.combined`,
                    scopeType: "encounter",
                    partition: "combined",
                    encounterId: encounterID,
                    fightIDs: encounterFights.map((fight) => fight.id),
                },
                payload: phaseTimes,
            });
            encounterPhaseTimesEntry.summary =
                `attempts=${phaseTimes.summary.totalAttempts} ` +
                `kills=${phaseTimes.summary.killCount} wipes=${phaseTimes.summary.wipeCount}`;
            manifestEntries.push(encounterPhaseTimesEntry);
            logProbe({
                probeFamily: "encounter-phase-times",
                reportCode: args.reportCode,
                scopeKey: `encounter-${encounterID}.combined`,
                ...(encounterPhaseTimesEntry.fixturePath
                    ? { outputPath: encounterPhaseTimesEntry.fixturePath }
                    : {}),
                summary: encounterPhaseTimesEntry.summary,
            });
        }
    } catch (error) {
        manifestEntries.push(
            await writeProbeArtifacts({
                outputDir,
                fixtureName: `base-report.${args.reportCode}`,
                probeFamily: "base-report",
                reportCode: args.reportCode,
                error,
            }),
        );
        throw error;
    }

    const runScopedProbe = async (config: {
        probeFamily: ProbeFamily;
        fixtureName: string;
        request: () => Promise<unknown>;
        summarize: (payload: unknown) => string;
        metadata: ProbeMetadata;
        logs?: Record<string, unknown>;
    }): Promise<void> => {
        const effectiveFilterExpression = normalizeOptionalString(
            typeof config.metadata.filterExpression === "string"
                ? config.metadata.filterExpression
                : typeof config.logs?.effectiveFilterExpression === "string"
                  ? config.logs.effectiveFilterExpression
                  : undefined,
        );

        try {
            const payload = await config.request();
            const entry = await writeProbeArtifacts({
                outputDir,
                fixtureName: config.fixtureName,
                probeFamily: config.probeFamily,
                reportCode: args.reportCode,
                metadata: {
                    ...config.metadata,
                    ...(effectiveFilterExpression
                        ? { filterExpression: effectiveFilterExpression }
                        : {}),
                },
                payload,
                ...(config.logs ? { logs: config.logs } : {}),
            });
            entry.summary = config.summarize(payload);
            manifestEntries.push(entry);
            logProbe({
                probeFamily: config.probeFamily,
                reportCode: args.reportCode,
                ...(typeof config.metadata.scopeKey === "string"
                    ? { scopeKey: config.metadata.scopeKey }
                    : {}),
                ...(effectiveFilterExpression
                    ? { filterExpression: effectiveFilterExpression }
                    : {}),
                ...(entry.fixturePath ? { outputPath: entry.fixturePath } : {}),
                summary: entry.summary,
            });
        } catch (error) {
            const entry = await writeProbeArtifacts({
                outputDir,
                fixtureName: config.fixtureName,
                probeFamily: config.probeFamily,
                reportCode: args.reportCode,
                metadata: {
                    ...config.metadata,
                    ...(effectiveFilterExpression
                        ? { filterExpression: effectiveFilterExpression }
                        : {}),
                },
                error,
                ...(config.logs ? { logs: config.logs } : {}),
            });
            manifestEntries.push(entry);
            logProbe({
                probeFamily: config.probeFamily,
                reportCode: args.reportCode,
                ...(typeof config.metadata.scopeKey === "string"
                    ? { scopeKey: config.metadata.scopeKey }
                    : {}),
                ...(effectiveFilterExpression
                    ? { filterExpression: effectiveFilterExpression }
                    : {}),
                ...(entry.errorPath ? { outputPath: entry.errorPath } : {}),
                summary: entry.errorMessage ?? "request failed",
            });
        }
    };

    for (const scope of scopes) {
        const scopeMetadata: ProbeMetadata = {
            scopeKey: scope.scopeKey,
            scopeType: scope.scopeType,
            partition: scope.partition,
            fightIDs: scope.fightIDs,
            ...(typeof scope.encounterID === "number"
                ? { encounterId: scope.encounterID }
                : {}),
            ...(typeof scope.anchorFightId === "number"
                ? { fightId: scope.anchorFightId }
                : {}),
        };

        for (const includeCombatantInfo of [false, true]) {
            await runScopedProbe({
                probeFamily: "player-details",
                fixtureName:
                    `player-details.${args.reportCode}.${scope.scopeKey}.` +
                    `${includeCombatantInfo ? "combatant" : "basic"}`,
                request: async () => {
                    const variables = {
                        reportCode: args.reportCode,
                        fightIDs: scope.fightIDs,
                        ...(typeof scope.encounterID === "number"
                            ? { encounterID: scope.encounterID }
                            : {}),
                        killType: scope.killType,
                        includeCombatantInfo,
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
                summarize: summarizeShape,
                metadata: {
                    ...scopeMetadata,
                    includeCombatantInfo,
                },
                logs: {
                    ...scopeMetadata,
                    killType: scope.killType,
                    includeCombatantInfo,
                },
            });
        }

        const rankingVariants: Array<{
            suffix: string;
            playerMetric?: RankingMetricValue;
            timeframe: RankingTimeframeValue;
            compare: RankingCompareValue;
        }> = [
            {
                suffix: "default.historical.parses",
                timeframe: "Historical",
                compare: "Parses",
            },
            {
                suffix: "dps.today.rankings",
                playerMetric: "dps",
                timeframe: "Today",
                compare: "Rankings",
            },
            {
                suffix: "hps.today.rankings",
                playerMetric: "hps",
                timeframe: "Today",
                compare: "Rankings",
            },
        ];

        for (const rankingVariant of rankingVariants) {
            await runScopedProbe({
                probeFamily: "rankings",
                fixtureName:
                    `rankings.${args.reportCode}.${scope.scopeKey}.` +
                    `${rankingVariant.suffix}`,
                request: async () => {
                    const variables = {
                        reportCode: args.reportCode,
                        fightIDs: scope.fightIDs,
                        ...(typeof scope.encounterID === "number"
                            ? { encounterID: scope.encounterID }
                            : {}),
                        ...(rankingVariant.playerMetric
                            ? { playerMetric: rankingVariant.playerMetric }
                            : {}),
                        timeframe: rankingVariant.timeframe,
                        compare: rankingVariant.compare,
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
                summarize: (payload) =>
                    `${rankingVariant.suffix} ${getRankingsSummary(payload)}`,
                metadata: {
                    ...scopeMetadata,
                    ...(rankingVariant.playerMetric
                        ? { playerMetric: rankingVariant.playerMetric }
                        : {}),
                    timeframe: rankingVariant.timeframe,
                    compare: rankingVariant.compare,
                },
                logs: {
                    ...scopeMetadata,
                    killType: scope.killType,
                    ...(rankingVariant.playerMetric
                        ? { playerMetric: rankingVariant.playerMetric }
                        : {}),
                    timeframe: rankingVariant.timeframe,
                    compare: rankingVariant.compare,
                },
            });
        }

        for (const dataType of TABLE_DATA_TYPES) {
            const effectiveFilterExpression = buildTableFilterExpression({
                scope,
                dataType,
                ...(typeof requestedFilterExpression === "string"
                    ? { filterExpression: requestedFilterExpression }
                    : {}),
                ...(typeof args.phase === "number"
                    ? { phase: args.phase }
                    : {}),
            });

            await runScopedProbe({
                probeFamily: "table",
                fixtureName: `table.${args.reportCode}.${scope.scopeKey}.${dataType}`,
                request: async () => {
                    const variables = withOptionalFilterExpression(
                        {
                            reportCode: args.reportCode,
                            fightIDs: scope.fightIDs,
                            ...(typeof scope.encounterID === "number"
                                ? { encounterID: scope.encounterID }
                                : {}),
                            killType: scope.killType,
                            dataType,
                        },
                        effectiveFilterExpression,
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
                summarize: summarizeShape,
                metadata: {
                    ...scopeMetadata,
                    dataType,
                    ...(effectiveFilterExpression
                        ? { filterExpression: effectiveFilterExpression }
                        : {}),
                },
                logs: {
                    ...scopeMetadata,
                    killType: scope.killType,
                    dataType,
                    ...(typeof requestedFilterExpression === "string"
                        ? { requestedFilterExpression }
                        : {}),
                    ...(typeof baseFilterExpression === "string"
                        ? { baseFilterExpression }
                        : {}),
                    partitionExpression: getPartitionExpression(scope),
                    effectiveFilterExpression,
                },
            });
        }
    }

    const manifestPath = join(
        outputDir,
        `public-probe-manifest.${args.reportCode}.discovery.json`,
    );
    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                reportCode: args.reportCode,
                ...(typeof args.fightId === "number"
                    ? { fightId: args.fightId }
                    : {}),
                ...(typeof args.encounterId === "number"
                    ? { encounterId: args.encounterId }
                    : {}),
                ...(typeof requestedFilterExpression === "string"
                    ? { requestedFilterExpression }
                    : {}),
                ...(typeof args.phase === "number"
                    ? { phase: args.phase }
                    : {}),
                ...(typeof baseFilterExpression === "string"
                    ? { baseFilterExpression }
                    : {}),
                generatedAt: new Date().toISOString(),
                discoveryScopes: scopes.map((scope) => ({
                    scopeKey: scope.scopeKey,
                    scopeType: scope.scopeType,
                    partition: scope.partition,
                    fightIDs: scope.fightIDs,
                    killType: scope.killType,
                    ...(typeof scope.encounterID === "number"
                        ? { encounterId: scope.encounterID }
                        : {}),
                    ...(typeof scope.anchorFightId === "number"
                        ? { fightId: scope.anchorFightId }
                        : {}),
                })),
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
        `[manifest] report=${args.reportCode} output=${relative(process.cwd(), manifestPath)} ` +
            `scopes=${scopes.length} entries=${manifestEntries.length}`,
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
