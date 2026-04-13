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
    | "report-rankings"
    | "boss-rankings"
    | "table-damage-taken"
    | "table-healing"
    | "table-deaths"
    | "table-dispels"
    | "table-interrupts"
    | "table-survivability"
    | "fight-resurrect-events"
    | "encounter-phases"
    | "encounter-phase-times";

interface ProbeArgs {
    reportCode: string;
    fightId: number;
    encounterId?: number;
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

const BASE_REPORT_QUERY = `
query ProbeBaseReport($reportCode: String!) {
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
      guild {
        name
        server {
          name
          region {
            compactName
          }
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
      fights(killType: All) {
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
      masterData {
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
query ProbeReportRankings($reportCode: String!) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      rankings(playerMetric: default)
    }
  }
}
`;

const BOSS_RANKINGS_QUERY = `
query ProbeBossRankings($reportCode: String!, $fightIDs: [Int]) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      rankings(playerMetric: default, fightIDs: $fightIDs)
    }
  }
}
`;

const TABLE_QUERY = `
query ProbeTableByType($reportCode: String!, $fightIDs: [Int], $dataType: TableDataType!) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      table(dataType: $dataType, fightIDs: $fightIDs)
    }
  }
}
`;

const RESURRECT_EVENTS_QUERY = `
query ProbeResurrectEvents(
  $reportCode: String!
  $fightIDs: [Int]
  $startTime: Float
  $filterExpression: String
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      events(
        dataType: All
        fightIDs: $fightIDs
        startTime: $startTime
        filterExpression: $filterExpression
      ) {
        data
        nextPageTimestamp
      }
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

const getArgs = (): ProbeArgs => {
    const args = process.argv.slice(2);
    const reportCode = args[0]?.trim();
    const fightId = Number(args[1]);

    if (!reportCode) {
        throw new Error(
            "Usage: pnpm --filter @wcl/wcl-client probe:public-graphql <reportCode> <fightId> [--encounter <encounterId>] [--verbose]",
        );
    }

    if (!Number.isInteger(fightId) || fightId <= 0) {
        throw new Error("fightId must be a positive integer");
    }

    let encounterId: number | undefined;
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

const normalizeEncounterFights = (
    report: unknown,
): EncounterFightForTimings[] => {
    return (asArray(asObject(report)?.fights) ?? []).flatMap(
        (value): EncounterFightForTimings[] => {
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

const resolveEncounterId = (
    fights: EncounterFightForTimings[],
    fightId: number,
    requestedEncounterId?: number,
): number => {
    if (typeof requestedEncounterId === "number") {
        return requestedEncounterId;
    }

    const selectedFight = fights.find((fight) => fight.id === fightId);
    if (!selectedFight) {
        throw new Error(
            `Could not infer encounter id from selected fight ${fightId}; pass --encounter explicitly.`,
        );
    }

    return selectedFight.encounterID;
};

const getRankingsSummary = (payload: unknown): string =>
    summarizeRankingsPayload(payload).logLine;

const writeProbeArtifacts = async (args: {
    outputDir: string;
    fixtureName: string;
    probeFamily: ProbeFamily;
    reportCode: string;
    fightId?: number;
    encounterId?: number;
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
    summary: string;
}): void => {
    const segments = [
        `[${args.probeFamily}]`,
        `report=${args.reportCode}`,
        ...(typeof args.fightId === "number" ? [`fight=${args.fightId}`] : []),
        ...(typeof args.encounterId === "number"
            ? [`encounter=${args.encounterId}`]
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
    let fights: EncounterFightForTimings[] = [];

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
        const masterDataEntry = await writeProbeArtifacts({
            outputDir,
            fixtureName: `master-data.${args.reportCode}`,
            probeFamily: "master-data",
            reportCode: args.reportCode,
            payload: asObject(reportNode)?.masterData ?? null,
        });
        masterDataEntry.summary = summarizeShape(
            asObject(reportNode)?.masterData,
        );
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
        encounterId = resolveEncounterId(
            fights,
            args.fightId,
            args.encounterId,
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
            ...(encounterPhasesEntry.fixturePath
                ? { outputPath: encounterPhasesEntry.fixturePath }
                : {}),
            summary: `phases=${encounterPhases.length}`,
        });

        const phaseTimes = deriveEncounterPhaseTimes({
            encounterId,
            fights,
            metadata: encounterPhases,
        });
        const encounterPhaseTimesEntry = await writeProbeArtifacts({
            outputDir,
            fixtureName: `encounter-phase-times.${args.reportCode}.encounter-${encounterId}`,
            probeFamily: "encounter-phase-times",
            reportCode: args.reportCode,
            encounterId,
            payload: phaseTimes,
        });
        encounterPhaseTimesEntry.summary = `attempts=${phaseTimes.summary.totalAttempts} kills=${phaseTimes.summary.killCount} wipes=${phaseTimes.summary.wipeCount}`;
        manifestEntries.push(encounterPhaseTimesEntry);
        logProbe({
            probeFamily: "encounter-phase-times",
            reportCode: args.reportCode,
            encounterId,
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
                payload,
            });
            entry.summary = summarize(payload);
            manifestEntries.push(entry);
            logProbe({
                probeFamily,
                reportCode: args.reportCode,
                fightId: args.fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
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
                error,
            });
            manifestEntries.push(entry);
            logProbe({
                probeFamily,
                reportCode: args.reportCode,
                fightId: args.fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
                ...(entry.errorPath ? { outputPath: entry.errorPath } : {}),
                summary: entry.errorMessage ?? "request failed",
            });
        }
    };

    await queryFamilies(
        "report-rankings",
        `report-rankings.${args.reportCode}`,
        async () => {
            const result = await client.request<unknown>(
                REPORT_RANKINGS_QUERY,
                {
                    reportCode: args.reportCode,
                },
            );
            return (
                asObject(asObject(asObject(result)?.reportData)?.report)
                    ?.rankings ?? null
            );
        },
        getRankingsSummary,
    );

    await queryFamilies(
        "boss-rankings",
        `boss-rankings.${args.reportCode}.fight-${args.fightId}`,
        async () => {
            const result = await client.request<unknown>(BOSS_RANKINGS_QUERY, {
                reportCode: args.reportCode,
                fightIDs: [args.fightId],
            });
            return (
                asObject(asObject(asObject(result)?.reportData)?.report)
                    ?.rankings ?? null
            );
        },
        getRankingsSummary,
    );

    const tableFamilies: Array<{
        probeFamily: ProbeFamily;
        dataType: string;
        filePrefix: string;
    }> = [
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
                const result = await client.request<unknown>(TABLE_QUERY, {
                    reportCode: args.reportCode,
                    fightIDs: [args.fightId],
                    dataType: tableFamily.dataType,
                });
                return (
                    asObject(asObject(asObject(result)?.reportData)?.report)
                        ?.table ?? null
                );
            },
            summarizeShape,
        );
    }

    await queryFamilies(
        "fight-resurrect-events",
        `resurrect-events.${args.reportCode}.fight-${args.fightId}`,
        async () => {
            const pages: unknown[] = [];
            let startTime: number | undefined;

            for (;;) {
                const result = await client.request<unknown>(
                    RESURRECT_EVENTS_QUERY,
                    {
                        reportCode: args.reportCode,
                        fightIDs: [args.fightId],
                        startTime,
                        filterExpression: 'type = "resurrect"',
                    },
                );

                const events = asObject(
                    asObject(asObject(result)?.reportData)?.report,
                )?.events;
                const eventNode = asObject(events);
                pages.push(eventNode ?? null);

                const nextPageTimestamp = asNumber(
                    eventNode?.nextPageTimestamp,
                );
                if (typeof nextPageTimestamp !== "number") {
                    break;
                }

                startTime = nextPageTimestamp;
            }

            return {
                pages,
                pageCount: pages.length,
            };
        },
        (payload) => {
            const node = asObject(payload);
            return `pages=${asNumber(node?.pageCount) ?? 0}`;
        },
    );

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
