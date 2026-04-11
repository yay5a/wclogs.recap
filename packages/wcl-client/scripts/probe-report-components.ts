import { GraphQLClient } from "graphql-request";
import { connectMongo, MongoWclUserAuthStore } from "@wcl/db";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    deriveEncounterPhaseTimes,
    summarizeRankingsPayload,
    type EncounterFightForTimings,
    type EncounterPhaseMetadata,
} from "../src/probes/phase-timings.js";

const getEnv = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};

const userApiBaseUrl =
    process.env.WCL_API_BASE_URL?.trim() ||
    "https://www.warcraftlogs.com/api/v2/user";

await connectMongo(getEnv("MONGODB_URI"));

const wclUserAuthStore = new MongoWclUserAuthStore();
const storedAuth = await wclUserAuthStore.get();

if (!storedAuth?.accessToken) {
    throw new Error(
        "No stored WCL user access token found. Complete /api/auth/wcl/login first.",
    );
}

const client = new GraphQLClient(userApiBaseUrl, {
    headers: {
        Authorization: `Bearer ${storedAuth.accessToken}`,
    },
});

interface EvaluateScriptResponse {
    output?: unknown;
    logs?: unknown;
    error?: unknown;
}

interface ScriptProbeDefinition {
    name: "deaths" | "dispels" | "interrupts" | "survivability";
    contents: string;
    filterFightIds: boolean;
}

interface ProbeManifestEntry {
    probeFamily: string;
    fixturePath: string;
    debugPath: string;
    logsPath?: string;
    errorPath?: string;
    summary?: string;
}

interface MasterDataActorRow {
    id: number;
    name: string;
}

const SCRIPT_PROBES: ScriptProbeDefinition[] = [
    {
        name: "deaths",
        contents:
            'return report.table({ dataType: "Deaths", fightIDs: filter.fightIDs });',
        filterFightIds: true,
    },
    {
        name: "dispels",
        contents:
            'return report.table({ dataType: "Dispels", fightIDs: filter.fightIDs });',
        filterFightIds: true,
    },
    {
        name: "interrupts",
        contents:
            'return report.table({ dataType: "Interrupts", fightIDs: filter.fightIDs });',
        filterFightIds: true,
    },
    {
        name: "survivability",
        contents:
            'return report.table({ dataType: "Survivability", fightIDs: filter.fightIDs });',
        filterFightIds: true,
    },
];

const EVALUATE_QUERY = `
query ProbeReportComponent(
  $reportCode: String!
  $contents: String!
  $filter: ReportComponentFilter
  $debug: Boolean!
) {
  reportComponentData {
    evaluateScript(
      reportCode: $reportCode
      contents: $contents
      filter: $filter
      debug: $debug
    ) {
      output
      logs
      error
    }
  }
}
`;

const MASTER_DATA_QUERY = `
query ProbeMasterData($reportCode: String!) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      masterData {
        actors(type: "Player") {
          id
          name
          type
          subType
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

const BASE_REPORT_FOR_PHASES_QUERY = `
query ProbeEncounterPhases($reportCode: String!) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
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
        startTime
        endTime
        kill
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
query ProbeBossRankings($reportCode: String!, $fightId: [Int]) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      rankings(playerMetric: default, fightIDs: $fightId)
    }
  }
}
`;

const CHARACTER_RANKINGS_QUERY = `
query ProbeCharacterEncounterRankings(
  $name: String!
  $serverSlug: String!
  $serverRegion: String!
  $encounterId: Int!
) {
  characterData {
    character(
      name: $name
      serverSlug: $serverSlug
      serverRegion: $serverRegion
    ) {
      encounterRankings(encounterID: $encounterId)
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

const asString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

interface ProbeArgs {
    reportCode: string;
    fightId: number;
    encounterId?: number;
    players: string[];
}

const getArgs = (): ProbeArgs => {
    const args = process.argv.slice(2);
    const reportCode = args[0]?.trim();
    const fightId = Number(args[1]);

    if (!reportCode) {
        throw new Error(
            "Usage: pnpm --filter @wcl/wcl-client probe:report-components <reportCode> <fightId> [--encounter <encounterId>] [--player <nameOrId>]...",
        );
    }

    if (!Number.isInteger(fightId) || fightId <= 0) {
        throw new Error("fightId must be a positive integer");
    }

    let encounterId: number | undefined;
    const players: string[] = [];

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
        if (flag === "--player") {
            const value = args[index + 1]?.trim();
            if (!value) {
                throw new Error("--player expects a non-empty player token");
            }
            players.push(value);
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${flag}`);
    }

    return {
        reportCode,
        fightId,
        players,
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

const run = async (): Promise<void> => {
    const {
        reportCode,
        fightId,
        encounterId: requestedEncounterId,
        players,
    } = getArgs();

    const outputDir = join(
        process.cwd(),
        "packages/wcl-client/src/fixtures/probes",
    );
    await mkdir(outputDir, { recursive: true });

    const manifest: ProbeManifestEntry[] = [];

    for (const probe of SCRIPT_PROBES) {
        const result = await client.request<unknown>(EVALUATE_QUERY, {
            reportCode,
            contents: probe.contents,
            filter: probe.filterFightIds ? { fightIDs: [fightId] } : {},
            debug: true,
        });

        const evaluateScript = asObject(
            asObject(asObject(result)?.reportComponentData)?.evaluateScript,
        ) as EvaluateScriptResponse | undefined;

        manifest.push(
            await writeProbeFiles(
                outputDir,
                `${probe.name}.${reportCode}.fight-${fightId}`,
                {
                    reportCode,
                    fightId,
                    probe: probe.name,
                    output: evaluateScript?.output ?? null,
                    logs: evaluateScript?.logs,
                    error: evaluateScript?.error,
                },
            ),
        );
    }

    const masterDataResult = await client.request<unknown>(MASTER_DATA_QUERY, {
        reportCode,
    });
    const masterData = asObject(
        asObject(asObject(asObject(masterDataResult)?.reportData)?.report)
            ?.masterData,
    );
    const masterDataActors = (asArray(masterData?.actors) ?? []).flatMap(
        (value) => {
            const row = asObject(value);
            const id = asNumber(row?.id);
            const name = asString(row?.name);
            if (typeof id !== "number" || typeof name !== "string") return [];
            const actor: MasterDataActorRow = { id, name };
            return [actor];
        },
    );
    manifest.push(
        await writeProbeFiles(outputDir, `master-data.${reportCode}`, {
            reportCode,
            probe: "master-data",
            output: masterData ?? null,
        }),
    );

    const reportRankingsResult = await client.request<unknown>(
        REPORT_RANKINGS_QUERY,
        {
            reportCode,
        },
    );
    const reportRankings = asObject(
        asObject(asObject(reportRankingsResult)?.reportData)?.report,
    )?.rankings;
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

    const bossRankingsResult = await client.request<unknown>(
        BOSS_RANKINGS_QUERY,
        {
            reportCode,
            fightId: [fightId],
        },
    );
    const bossRankings = asObject(
        asObject(asObject(bossRankingsResult)?.reportData)?.report,
    )?.rankings;
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

    const phaseResult = await client.request<unknown>(
        BASE_REPORT_FOR_PHASES_QUERY,
        {
            reportCode,
        },
    );
    const report = asObject(asObject(phaseResult)?.reportData)?.report;

    const fights = (asArray(report && asObject(report)?.fights) ?? [])
        .map((value): EncounterFightForTimings | undefined => {
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
                return undefined;
            }

            const phaseTransitions = (
                asArray(row?.phaseTransitions) ?? []
            ).flatMap((transition) => {
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
            });

            return {
                id,
                encounterID,
                startTime,
                endTime,
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

    const encounterPhases = (asArray(report && asObject(report)?.phases) ?? [])
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

                const phases = (asArray(row?.phases) ?? []).flatMap(
                    (phaseValue) => {
                        const phase = asObject(phaseValue);
                        const id = asNumber(phase?.id);
                        const name = asString(phase?.name);
                        if (
                            typeof id !== "number" ||
                            typeof name !== "string"
                        ) {
                            return [];
                        }

                        const metadata: EncounterPhaseMetadata = {
                            id,
                            name,
                            ...(phase && "isIntermission" in phase
                                ? {
                                      isIntermission:
                                          phase.isIntermission === true,
                                  }
                                : {}),
                        };
                        return [metadata];
                    },
                );

                return { encounterID: currentEncounterId, phases };
            },
        )
        .flatMap((row) => (row ? [row] : []));

    const selectedEncounterPhases =
        encounterPhases.find((row) => row.encounterID === encounterId)
            ?.phases ?? [];

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

    for (const playerToken of players) {
        const asActorId = Number(playerToken);
        const characterName =
            (Number.isInteger(asActorId) && asActorId > 0
                ? masterDataActors.find((actor) => actor.id === asActorId)?.name
                : undefined) ?? playerToken;

        const characterRankingsResult = await client.request<unknown>(
            CHARACTER_RANKINGS_QUERY,
            {
                name: characterName,
                encounterId,
            },
        );
        const rankings = asObject(
            asObject(characterRankingsResult)?.characterData,
        );
        const payload =
            asObject(rankings?.character)?.encounterRankings ?? null;
        manifest.push(
            await writeProbeFiles(
                outputDir,
                `character-encounter-rankings.${reportCode}.fight-${fightId}.${playerToken}`,
                {
                    reportCode,
                    fightId,
                    encounterId,
                    probe: "character-encounter-rankings",
                    output: payload,
                },
            ),
        );
    }

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
    console.log(`report-rankings summary: ${reportRankingsSummary.logLine}`);
    console.log(`boss-rankings summary: ${bossRankingsSummary.logLine}`);
};

run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Probe run failed: ${message}`);
    process.exitCode = 1;
});
