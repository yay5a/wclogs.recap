import { GraphQLClient } from "graphql-request";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    resolveWclAccessToken,
} from "../src/oauth.js";
import {
    KILL_TYPES,
    REPORT_TABLE_DATA_TYPES,
} from "../src/schema-enums.js";
import {
    deriveEncounterPhaseTimes,
    summarizeRankingsPayload,
    type EncounterFightForTimings,
    type EncounterPhaseMetadata,
} from "../src/probes/phase-timings.js";

const DEFAULT_ALLOW_UNLISTED_REPORTS = true;

interface ProbeManifestEntry {
    probeFamily: string;
    fixturePath: string;
    debugPath: string;
    logsPath?: string;
    errorPath?: string;
    summary?: string;
}

const BASE_REPORT_QUERY = `
  query BaseReportSummary(
    $code: String!
    $allowUnlisted: Boolean!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        archiveStatus {
          isArchived
          isAccessible
          archiveDate
        }
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
            region { compactName }
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
        fights(killType: ${KILL_TYPES[1]}) {
          id
          encounterID
          difficulty
          averageItemLevel
          name
          startTime
          endTime
          kill
          bossPercentage
          fightPercentage
          size
          lastPhase
          lastPhaseAsAbsoluteIndex
          lastPhaseIsIntermission
          inProgress
          originalEncounterID
          wipeCalledTime
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
        }
      }
    }
  }
`;

const REPORT_RANKINGS_QUERY = `
  query ReportRankings($code: String!, $allowUnlisted: Boolean!) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default)
      }
    }
  }
`;

const BOSS_RANKINGS_QUERY = `
  query BossRankings(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int]
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        rankings(playerMetric: default, fightIDs: $fightIDs)
      }
    }
  }
`;

const PLAYER_DETAILS_QUERY = `
  query PlayerDetails(
    $code: String!
    $allowUnlisted: Boolean!
    $startTime: Float!
    $endTime: Float!
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        playerDetails(
          includeCombatantInfo: true
          startTime: $startTime
          endTime: $endTime
        )
      }
    }
  }
`;

const TABLE_QUERY = `
  query ReportTable($code: String!, $allowUnlisted: Boolean!, $fightIDs: [Int]) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        damageDone: table(dataType: ${REPORT_TABLE_DATA_TYPES[0]}, fightIDs: $fightIDs)
        damageTaken: table(dataType: ${REPORT_TABLE_DATA_TYPES[1]}, fightIDs: $fightIDs)
        healing: table(dataType: ${REPORT_TABLE_DATA_TYPES[2]}, fightIDs: $fightIDs)
        deaths: table(dataType: ${REPORT_TABLE_DATA_TYPES[3]}, fightIDs: $fightIDs)
        dispels: table(dataType: ${REPORT_TABLE_DATA_TYPES[4]}, fightIDs: $fightIDs)
        interrupts: table(dataType: ${REPORT_TABLE_DATA_TYPES[5]}, fightIDs: $fightIDs)
        survivability: table(dataType: ${REPORT_TABLE_DATA_TYPES[6]}, fightIDs: $fightIDs)
      }
    }
  }
`;

const RESURRECT_EVENTS_QUERY = `
  query FightResurrectionEvents(
    $code: String!
    $allowUnlisted: Boolean!
    $fightIDs: [Int]
    $startTime: Float
    $filterExpression: String
  ) {
    reportData {
      report(code: $code, allowUnlisted: $allowUnlisted) {
        events(
          dataType: ${KILL_TYPES[0]}
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

const asObject = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;

const asArray = (value: unknown): unknown[] | undefined =>
    Array.isArray(value) ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

interface ProbeArgs {
    reportCode: string;
    fightId: number;
    encounterId?: number;
}

const getArgs = (): ProbeArgs => {
    const args = process.argv.slice(2);
    const reportCode = args[0]?.trim();
    const fightId = Number(args[1]);

    if (!reportCode) {
        throw new Error(
            "Usage: pnpm --filter @wcl/wcl-client probe:report-components <reportCode> <fightId> [--encounter <encounterId>]",
        );
    }

    if (!Number.isInteger(fightId) || fightId <= 0) {
        throw new Error("fightId must be a positive integer");
    }

    let encounterId: number | undefined;

    for (let index = 2; index < args.length; index += 1) {
        const flag = args[index];
        if (flag === "--encounter") {
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
        throw new Error(`Unknown argument: ${flag}`);
    }

    return {
        reportCode,
        fightId,
        ...(typeof encounterId === "number" ? { encounterId } : {}),
    };
};

const writeProbeFiles = async (
    outputDir: string,
    fixtureName: string,
    envelope: {
        reportCode: string;
        fightId?: number;
        encounterId?: number;
        probe: string;
        output: unknown;
        logs?: unknown;
        error?: unknown;
    },
): Promise<ProbeManifestEntry> => {
    const fixturePath = join(outputDir, `${fixtureName}.json`);
    const debugPath = join(outputDir, `${fixtureName}.debug.json`);
    await writeFile(
        fixturePath,
        JSON.stringify(envelope.output ?? null, null, 2),
        "utf8",
    );
    await writeFile(debugPath, JSON.stringify(envelope, null, 2), "utf8");

    const entry: ProbeManifestEntry = {
        probeFamily: envelope.probe,
        fixturePath,
        debugPath,
    };

    if (typeof envelope.logs !== "undefined") {
        const logsPath = join(outputDir, `${fixtureName}.logs.json`);
        await writeFile(
            logsPath,
            JSON.stringify(envelope.logs, null, 2),
            "utf8",
        );
        entry.logsPath = logsPath;
    }

    if (typeof envelope.error !== "undefined") {
        const errorPath = join(outputDir, `${fixtureName}.error.json`);
        await writeFile(
            errorPath,
            JSON.stringify(envelope.error, null, 2),
            "utf8",
        );
        entry.errorPath = errorPath;
    }

    return entry;
};

const resolveEncounterId = (
    fights: EncounterFightForTimings[],
    selectedFightId: number,
    requestedEncounterId?: number,
): number => {
    if (typeof requestedEncounterId === "number") return requestedEncounterId;

    const selectedFight = fights.find((fight) => fight.id === selectedFightId);
    if (!selectedFight) {
        throw new Error(
            `Could not find selected fight ${selectedFightId} while deriving encounter id. Pass --encounter explicitly.`,
        );
    }

    return selectedFight.encounterID;
};

const getReportNode = (payload: unknown): Record<string, unknown> | undefined =>
    asObject(asObject(payload)?.reportData)?.report;

const summarizeTopLevelKeys = (value: unknown): string => {
    const node = asObject(value);
    const keys = node ? Object.keys(node) : [];
    return keys.length > 0 ? keys.join(", ") : "<none>";
};

const run = async (): Promise<void> => {
    const { reportCode, fightId, encounterId: requestedEncounterId } = getArgs();

    const token = await resolveWclAccessToken({
        ...(process.env.WCL_OAUTH_TOKEN?.trim()
            ? { explicitToken: process.env.WCL_OAUTH_TOKEN.trim() }
            : {}),
        ...(process.env.WCL_CLIENT_ID?.trim()
            ? { clientId: process.env.WCL_CLIENT_ID.trim() }
            : {}),
        ...(process.env.WCL_CLIENT_SECRET?.trim()
            ? { clientSecret: process.env.WCL_CLIENT_SECRET.trim() }
            : {}),
    });

    const apiBaseUrl =
        process.env.WCL_API_BASE_URL?.trim() ||
        "https://www.warcraftlogs.com/api/v2/client";

    const client = new GraphQLClient(apiBaseUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    const outputDir = join(
        process.cwd(),
        "packages/wcl-client/src/fixtures/probes",
    );
    await mkdir(outputDir, { recursive: true });

    const manifest: ProbeManifestEntry[] = [];

    const baseReportResult = await client.request<unknown>(BASE_REPORT_QUERY, {
        code: reportCode,
        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
    });
    const baseReport = getReportNode(baseReportResult) ?? null;
    const baseReportEntry = await writeProbeFiles(
        outputDir,
        `base-report.${reportCode}`,
        {
            reportCode,
            probe: "base-report",
            output: baseReport,
        },
    );
    const fightsForSummary = asArray(asObject(baseReport)?.fights) ?? [];
    baseReportEntry.summary = `keys=[${summarizeTopLevelKeys(baseReport)}] fights=${fightsForSummary.length}`;
    manifest.push(baseReportEntry);

    const reportRankingsResult = await client.request<unknown>(
        REPORT_RANKINGS_QUERY,
        {
            code: reportCode,
            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
        },
    );
    const reportRankings = getReportNode(reportRankingsResult)?.rankings;
    const reportRankingsSummary = summarizeRankingsPayload(reportRankings);
    const reportRankingsEntry = await writeProbeFiles(
        outputDir,
        `report-rankings.${reportCode}`,
        {
            reportCode,
            probe: "report-rankings",
            output: reportRankings ?? null,
        },
    );
    reportRankingsEntry.summary = reportRankingsSummary.logLine;
    manifest.push(reportRankingsEntry);

    const bossRankingsResult = await client.request<unknown>(BOSS_RANKINGS_QUERY, {
        code: reportCode,
        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
        fightIDs: [fightId],
    });
    const bossRankings = getReportNode(bossRankingsResult)?.rankings;
    const bossRankingsSummary = summarizeRankingsPayload(bossRankings);
    const bossRankingsEntry = await writeProbeFiles(
        outputDir,
        `boss-rankings.${reportCode}.fight-${fightId}`,
        {
            reportCode,
            fightId,
            probe: "boss-rankings",
            output: bossRankings ?? null,
        },
    );
    bossRankingsEntry.summary = bossRankingsSummary.logLine;
    manifest.push(bossRankingsEntry);

    const baseReportNode = asObject(baseReport);
    const reportStartTime = asNumber(baseReportNode?.startTime);
    const reportEndTime = asNumber(baseReportNode?.endTime);
    if (typeof reportStartTime !== "number" || typeof reportEndTime !== "number") {
        throw new Error("Base report payload is missing startTime/endTime for player-details probing");
    }

    const playerDetailsResult = await client.request<unknown>(PLAYER_DETAILS_QUERY, {
        code: reportCode,
        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
        startTime: reportStartTime,
        endTime: reportEndTime,
    });
    const playerDetails = getReportNode(playerDetailsResult)?.playerDetails;
    const playerDetailsNode = asObject(playerDetails);
    const playerDetailsKeys = summarizeTopLevelKeys(playerDetails);
    const playerEntryCount = Object.values(playerDetailsNode ?? {}).reduce(
        (count, value) => count + (Array.isArray(value) ? value.length : 0),
        0,
    );
    const playerDetailsEntry = await writeProbeFiles(
        outputDir,
        `player-details.${reportCode}`,
        {
            reportCode,
            probe: "player-details",
            output: playerDetails ?? null,
        },
    );
    playerDetailsEntry.summary = `keys=[${playerDetailsKeys}] entries=${playerEntryCount}`;
    manifest.push(playerDetailsEntry);

    const tableResult = await client.request<unknown>(TABLE_QUERY, {
        code: reportCode,
        allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
        fightIDs: [fightId],
    });
    const fightTables = getReportNode(tableResult) ?? null;
    const fightTableKeys = summarizeTopLevelKeys(fightTables);
    const fightTablesEntry = await writeProbeFiles(
        outputDir,
        `fight-tables.${reportCode}.fight-${fightId}`,
        {
            reportCode,
            fightId,
            probe: "fight-tables",
            output: fightTables,
        },
    );
    fightTablesEntry.summary = `tableKeys=[${fightTableKeys}]`;
    manifest.push(fightTablesEntry);

    let startTime: number | undefined;
    const resurrectPages: unknown[] = [];
    const combinedEvents: unknown[] = [];

    for (;;) {
        const resurrectResult = await client.request<unknown>(RESURRECT_EVENTS_QUERY, {
            code: reportCode,
            allowUnlisted: DEFAULT_ALLOW_UNLISTED_REPORTS,
            fightIDs: [fightId],
            ...(typeof startTime === "number" ? { startTime } : {}),
            filterExpression: 'type = "resurrect"',
        });

        const eventsNode = asObject(getReportNode(resurrectResult)?.events);
        const rows = asArray(eventsNode?.data) ?? [];
        resurrectPages.push(eventsNode ?? null);
        combinedEvents.push(...rows);

        const nextPageTimestamp = asNumber(eventsNode?.nextPageTimestamp);
        if (typeof nextPageTimestamp !== "number") {
            const resurrectEventsEntry = await writeProbeFiles(
                outputDir,
                `resurrect-events.${reportCode}.fight-${fightId}`,
                {
                    reportCode,
                    fightId,
                    probe: "resurrect-events",
                    output: {
                        pages: resurrectPages,
                        events: combinedEvents,
                        nextPageTimestamp: null,
                    },
                },
            );
            resurrectEventsEntry.summary = `events=${combinedEvents.length} nextPageTimestamp=false`;
            manifest.push(resurrectEventsEntry);
            break;
        }

        startTime = nextPageTimestamp;
    }

    const masterData = asObject(baseReportNode?.masterData) ?? null;
    manifest.push(
        await writeProbeFiles(outputDir, `master-data.${reportCode}`, {
            reportCode,
            probe: "master-data",
            output: masterData,
        }),
    );

    const fights = (asArray(baseReportNode?.fights) ?? [])
        .map((value): EncounterFightForTimings | undefined => {
            const row = asObject(value);
            const id = asNumber(row?.id);
            const encounterID =
                asNumber(row?.encounterID) ?? asNumber(row?.originalEncounterID);
            const start = asNumber(row?.startTime);
            const end = asNumber(row?.endTime);

            if (
                typeof id !== "number" ||
                typeof encounterID !== "number" ||
                typeof start !== "number" ||
                typeof end !== "number"
            ) {
                return undefined;
            }

            const phaseTransitions = (asArray(row?.phaseTransitions) ?? []).flatMap(
                (transition) => {
                    const normalized = asObject(transition);
                    const transitionId = asNumber(normalized?.id);
                    const transitionStart = asNumber(normalized?.startTime);
                    if (
                        typeof transitionId !== "number" ||
                        typeof transitionStart !== "number"
                    ) {
                        return [];
                    }
                    return [{ id: transitionId, startTime: transitionStart }];
                },
            );

            return {
                id,
                encounterID,
                startTime: start,
                endTime: end,
                kill: row?.kill === true,
                phaseTransitions,
            };
        })
        .flatMap((fight): EncounterFightForTimings[] => (fight ? [fight] : []));

    const encounterId = resolveEncounterId(
        fights,
        fightId,
        requestedEncounterId,
    );

    const encounterPhases = (asArray(baseReportNode?.phases) ?? [])
        .map(
            (
                value,
            ):
                | { encounterID: number; phases: EncounterPhaseMetadata[] }
                | undefined => {
                const row = asObject(value);
                const currentEncounterId = asNumber(row?.encounterID);
                if (typeof currentEncounterId !== "number") {
                    return undefined;
                }

                const phases = (asArray(row?.phases) ?? []).flatMap((phaseValue) => {
                    const phase = asObject(phaseValue);
                    const id = asNumber(phase?.id);
                    const name = typeof phase?.name === "string" ? phase.name : undefined;
                    if (typeof id !== "number" || typeof name !== "string") {
                        return [];
                    }

                    const metadata: EncounterPhaseMetadata = {
                        id,
                        name,
                        ...(phase && "isIntermission" in phase
                            ? { isIntermission: phase.isIntermission === true }
                            : {}),
                    };
                    return [metadata];
                });

                return { encounterID: currentEncounterId, phases };
            },
        )
        .flatMap((row) => (row ? [row] : []));

    const selectedEncounterPhases =
        encounterPhases.find((row) => row.encounterID === encounterId)?.phases ?? [];

    manifest.push(
        await writeProbeFiles(
            outputDir,
            `encounter-phases.${reportCode}.encounter-${encounterId}`,
            {
                reportCode,
                encounterId,
                probe: "encounter-phases",
                output: {
                    encounterID: encounterId,
                    phases: selectedEncounterPhases,
                },
            },
        ),
    );

    manifest.push(
        await writeProbeFiles(
            outputDir,
            `encounter-phase-times.${reportCode}.encounter-${encounterId}`,
            {
                reportCode,
                encounterId,
                probe: "encounter-phase-times",
                output: deriveEncounterPhaseTimes({
                    encounterId,
                    fights,
                    metadata: selectedEncounterPhases,
                }),
            },
        ),
    );

    const manifestPath = join(
        outputDir,
        `probe-manifest.${reportCode}.fight-${fightId}.json`,
    );
    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                reportCode,
                fightId,
                encounterId,
                generatedAt: new Date().toISOString(),
                entries: manifest,
            },
            null,
            2,
        ),
        "utf8",
    );

    console.log(
        `Saved probe fixtures for report ${reportCode} fight ${fightId} to ${outputDir}`,
    );
    console.log(`base-report summary: ${baseReportEntry.summary ?? "n/a"}`);
    console.log(`report-rankings summary: ${reportRankingsSummary.logLine}`);
    console.log(`boss-rankings summary: ${bossRankingsSummary.logLine}`);
    console.log(`player-details summary: ${playerDetailsEntry.summary ?? "n/a"}`);
    console.log(`fight-tables summary: ${fightTablesEntry.summary ?? "n/a"}`);
    const resurrectSummary = manifest.find(
        (entry) => entry.probeFamily === "resurrect-events",
    )?.summary;
    console.log(`resurrect-events summary: ${resurrectSummary ?? "n/a"}`);
};

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Probe run failed: ${message}`);
    process.exitCode = 1;
});
