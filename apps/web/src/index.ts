import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import fastifyCookie from "@fastify/cookie";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { verifyKey } from "discord-interactions";
import {
    connectMongo,
    MongoAccountabilityViewService,
    MongoCoachingViewService,
    MongoGuildConfigStore,
    MongoRecapPreviewStateStore,
    MongoTrendTrackingService,
    MongoWclUserAuthStore,
    ReportCacheModel,
} from "@wcl/db";
import {
    DiscordCommandRegistrationError,
    handleInteraction,
    registerGlobalCommands,
    registerGuildCommands,
} from "@wcl/discord";
import { createLogger } from "@wcl/shared";
import { parseWebEnv } from "./config.js";
import { WclClient, type ReportCacheStore } from "@wcl/wcl-client";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = resolve(__dirname, "../../../.env");

if (existsSync(envPath)) {
    loadEnvFile(envPath);
}

const env = parseWebEnv(process.env);
const logger = createLogger("web");
const app = Fastify({ logger: false });

const reportCacheStore: ReportCacheStore = {
    async getByReportCode(reportCode: string) {
        return ReportCacheModel.findOne({ reportCode }).lean();
    },
    async upsert(entry) {
        await ReportCacheModel.findOneAndUpdate(
            { reportCode: entry.reportCode },
            entry,
            { upsert: true },
        );
    },
};

await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
});

const wclClient = new WclClient({
    clientId: env.WCL_CLIENT_ID,
    clientSecret: env.WCL_CLIENT_SECRET,
    apiBaseUrl: env.WCL_API_BASE_URL,
    reportCacheStore,
});

const guildConfigStore = new MongoGuildConfigStore();
const recapPreviewStateService = new MongoRecapPreviewStateStore();
const coachingViewService = new MongoCoachingViewService();
const accountabilityViewService = new MongoAccountabilityViewService();
const trendTrackingService = new MongoTrendTrackingService();
const wclUserAuthStore = new MongoWclUserAuthStore();

await app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
});

app.get("/health", async () => ({ status: "ok" }));

app.get("/api/auth/wcl/status", async (_request, reply) => {
    const auth = await wclUserAuthStore.get();

    return reply.send({
        ok: true,
        authorized: !!auth,
        provider: auth?.provider ?? null,
        hasAccessToken: typeof auth?.accessToken === "string",
        hasRefreshToken: typeof auth?.refreshToken === "string",
        tokenType: auth?.tokenType ?? null,
        scope: auth?.scope ?? null,
        expiresAt: auth?.expiresAt ?? null,
        updatedAt: auth?.updatedAt ?? null,
    });
});

app.get("/api/auth/wcl/callback", async (request, reply) => {
    const query = request.query as {
        code?: string;
        state?: string;
        error?: string;
    };

    if (query.error) {
        return reply.code(400).send({
            ok: false,
            message: "WCL authorization failed or was denied",
            error: query.error,
        });
    }

    if (!query.code || !query.state) {
        return reply.code(400).send({
            ok: false,
            message: "Missing code or state",
        });
    }

    const cookie = request.unsignCookie(request.cookies.wcl_oauth_state ?? "");

    if (!cookie.valid || cookie.value !== query.state) {
        return reply.code(400).send({
            ok: false,
            message: "Invalid OAuth state",
        });
    }

    const basicAuth = Buffer.from(
        `${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`,
    ).toString("base64");

    const tokenResponse = await fetch(
        "https://www.warcraftlogs.com/oauth/token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${basicAuth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: query.code,
                redirect_uri: env.WCL_REDIRECT_URI,
            }),
        },
    );

    const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
        scope?: string;
        [key: string]: unknown;
    };

    reply.clearCookie("wcl_oauth_state", { path: "/" });

    if (!tokenResponse.ok) {
        logger.error(
            { status: tokenResponse.status, tokenPayload },
            "WCL token exchange failed",
        );

        return reply.code(500).send({
            ok: false,
            message: "WCL token exchange failed",
            status: tokenResponse.status,
        });
    }

    const authRecord = {
        provider: "warcraftlogs" as const,
        accessToken: tokenPayload.access_token!,
        updatedAt: new Date(),
        ...(typeof tokenPayload.refresh_token === "string"
            ? { refreshToken: tokenPayload.refresh_token }
            : {}),
        ...(typeof tokenPayload.token_type === "string"
            ? { tokenType: tokenPayload.token_type }
            : {}),
        ...(typeof tokenPayload.scope === "string"
            ? { scope: tokenPayload.scope }
            : {}),
        ...(typeof tokenPayload.expires_in === "number"
            ? {
                  expiresAt: new Date(
                      Date.now() + tokenPayload.expires_in * 1000,
                  ),
              }
            : {}),
    };

    await wclUserAuthStore.upsert(authRecord);

    return reply.send({
        ok: true,
        message: "WCL authorization completed",
    });
});

app.get("/api/auth/wcl/login", async (_request, reply) => {
    const clientId = env.WCL_CLIENT_ID;
    const redirectUri = env.WCL_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return reply.code(500).send({
            message: "Missing WCL_CLIENT_ID or WCL_REDIRECT_URI",
        });
    }

    const state = crypto.randomUUID();

    reply.setCookie("wcl_oauth_state", state, {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        signed: true,
        maxAge: 60 * 10,
    });
    const authorizeUrl = new URL(
        "https://www.warcraftlogs.com/oauth/authorize",
    );
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", state);

    return reply.redirect(authorizeUrl.toString());
});

type JsonRecord = Record<string, unknown>;
type ProbeManifestEntry = {
    probeFamily: string;
    success: boolean;
    summary: string;
    error?: string;
};

const asObject = (value: unknown): JsonRecord | undefined =>
    typeof value === "object" && value !== null
        ? (value as JsonRecord)
        : undefined;

const asArray = (value: unknown): unknown[] | undefined =>
    Array.isArray(value) ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

const summarizeShape = (value: unknown): string => {
    const rootType = Array.isArray(value)
        ? "array"
        : value === null
          ? "null"
          : typeof value;
    const root = asObject(value);
    const keys = root ? Object.keys(root) : [];
    const data = asArray(root?.data);
    return `type=${rootType} keys=[${keys.join(",")}] dataLength=${data?.length ?? 0}`;
};

const summarizeRankingsPayload = (payload: unknown): string => {
    const root = asObject(payload);
    const dataRows = asArray(root?.data);
    const firstRow = asObject(dataRows?.[0]);
    const firstFightId =
        asNumber(firstRow?.fightID) ?? asNumber(firstRow?.fightId);
    const difficulty = asNumber(firstRow?.difficulty);
    const encounter = asObject(firstRow?.encounter);
    const encounterName =
        asString(encounter?.name) ?? asString(firstRow?.encounter);
    return `dataLength=${dataRows?.length ?? 0} firstFightId=${firstFightId ?? "n/a"} encounter=${encounterName ?? "n/a"} difficulty=${difficulty ?? "n/a"}`;
};

const summarizeError = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "Unknown probe failure";
};

const extractGraphQlErrorMessage = (errors: unknown): string | undefined => {
    const rows = asArray(errors) ?? [];
    const messages = rows.flatMap((value) => {
        const message = asString(asObject(value)?.message);
        return message ? [message] : [];
    });
    if (messages.length === 0) return undefined;
    return messages.slice(0, 3).join("; ");
};

interface EncounterFightForTimings {
    id: number;
    encounterID: number;
    startTime: number;
    endTime: number;
    kill: boolean;
    phaseTransitions: Array<{ id: number; startTime: number }>;
}

interface EncounterPhaseMetadata {
    id: number;
    name: string;
    isIntermission?: boolean;
}

const normalizeEncounterFights = (
    report: unknown,
): EncounterFightForTimings[] => {
    return (asArray(asObject(report)?.fights) ?? []).flatMap((value) => {
        const row = asObject(value);
        const id = asNumber(row?.id);
        const encounterID =
            asNumber(row?.encounterID) ?? asNumber(row?.originalEncounterID);
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

        const phaseTransitions = (asArray(row?.phaseTransitions) ?? []).flatMap(
            (entry) => {
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
            },
        );

        return [
            {
                id,
                encounterID,
                startTime,
                endTime,
                kill: row?.kill === true,
                phaseTransitions,
            } satisfies EncounterFightForTimings,
        ];
    });
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

const deriveEncounterPhaseTimes = (args: {
    encounterId: number;
    fights: EncounterFightForTimings[];
    metadata: EncounterPhaseMetadata[];
}) => {
    const phaseById = new Map<number, EncounterPhaseMetadata>(
        args.metadata.map((row) => [row.id, row]),
    );

    const attempts = args.fights
        .filter((fight) => fight.encounterID === args.encounterId)
        .sort((left, right) => left.startTime - right.startTime)
        .map((fight) => {
            const transitions = [...fight.phaseTransitions]
                .filter(
                    (transition) =>
                        transition.startTime > fight.startTime &&
                        transition.startTime < fight.endTime,
                )
                .sort((left, right) => left.startTime - right.startTime);

            const phaseWindows: Array<{
                phaseId: number;
                phaseName?: string;
                isIntermission?: boolean;
                phaseStartTime: number;
                phaseEndTime: number;
                durationMs: number;
            }> = [];
            let currentPhaseId = 1;
            let currentStart = fight.startTime;

            for (const transition of transitions) {
                const phaseInfo = phaseById.get(currentPhaseId);
                phaseWindows.push({
                    phaseId: currentPhaseId,
                    ...(phaseInfo?.name ? { phaseName: phaseInfo.name } : {}),
                    ...(phaseInfo && "isIntermission" in phaseInfo
                        ? { isIntermission: phaseInfo.isIntermission === true }
                        : {}),
                    phaseStartTime: currentStart,
                    phaseEndTime: transition.startTime,
                    durationMs: transition.startTime - currentStart,
                });
                currentPhaseId = transition.id;
                currentStart = transition.startTime;
            }

            const finalInfo = phaseById.get(currentPhaseId);
            phaseWindows.push({
                phaseId: currentPhaseId,
                ...(finalInfo?.name ? { phaseName: finalInfo.name } : {}),
                ...(finalInfo && "isIntermission" in finalInfo
                    ? { isIntermission: finalInfo.isIntermission === true }
                    : {}),
                phaseStartTime: currentStart,
                phaseEndTime: fight.endTime,
                durationMs: fight.endTime - currentStart,
            });

            return {
                fightId: fight.id,
                kill: fight.kill,
                startTime: fight.startTime,
                endTime: fight.endTime,
                fightDurationMs: fight.endTime - fight.startTime,
                phaseWindows,
            };
        });

    return {
        encounterId: args.encounterId,
        attempts,
        summary: {
            totalAttempts: attempts.length,
            killCount: attempts.filter((attempt) => attempt.kill).length,
            wipeCount: attempts.filter((attempt) => !attempt.kill).length,
        },
    };
};

const BASE_REPORT_QUERY = `
query ProbeBaseReport($reportCode: String!) {
  rateLimitData {
    limitPerHour
    pointsSpentThisHour
    pointsResetIn
  }
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

const REPORT_RANKINGS_BY_METRIC_QUERY = `
query ProbeReportRankingsByMetric(
  $reportCode: String!
  $playerMetric: ReportRankingMetricType!
  $timeframe: RankingTimeframeType!
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      rankings(
        playerMetric: $playerMetric
        timeframe: $timeframe
      )
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

const TABLE_REPORT_WIDE_QUERY = `
query ProbeReportWideTableByType(
  $reportCode: String!
  $dataType: TableDataType!
  $startTime: Float!
  $endTime: Float!
) {
  reportData {
    report(code: $reportCode, allowUnlisted: true) {
      table(
        dataType: $dataType
        startTime: $startTime
        endTime: $endTime
      )
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

app.get("/api/probe/wcl/public", async (request, reply) => {
    const query = request.query as {
        reportCode?: string;
        fightId?: string;
    };

    const reportCode = query.reportCode?.trim();
    const fightId = Number(query.fightId);

    if (!reportCode) {
        return reply.code(400).send({
            ok: false,
            message: "Missing reportCode query parameter",
        });
    }

    if (!Number.isInteger(fightId) || fightId <= 0) {
        return reply.code(400).send({
            ok: false,
            message: "Missing or invalid fightId query parameter",
        });
    }

    const basicAuth = Buffer.from(
        `${env.WCL_CLIENT_ID}:${env.WCL_CLIENT_SECRET}`,
    ).toString("base64");

    const tokenResponse = await fetch(
        "https://www.warcraftlogs.com/oauth/token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${basicAuth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "client_credentials",
            }),
        },
    );

    const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
        [key: string]: unknown;
    };

    if (!tokenResponse.ok || !tokenPayload.access_token) {
        logger.error(
            { status: tokenResponse.status, tokenPayload },
            "WCL client token exchange failed",
        );

        return reply.code(500).send({
            ok: false,
            message: "WCL client token exchange failed",
            status: tokenResponse.status,
        });
    }

    const requestGraphQl = async (
        queryText: string,
        variables: JsonRecord,
    ): Promise<JsonRecord> => {
        const response = await fetch("https://www.warcraftlogs.com/api/v2/client", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${tokenPayload.access_token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query: queryText,
                variables,
            }),
        });

        const payload = (await response.json()) as {
            data?: unknown;
            errors?: unknown;
        };

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const graphQlMessage = extractGraphQlErrorMessage(payload.errors);
        if (graphQlMessage) {
            throw new Error(graphQlMessage);
        }

        const data = asObject(payload.data);
        if (!data) {
            throw new Error("GraphQL response missing data");
        }

        return data;
    };

    let baseData: JsonRecord;
    try {
        baseData = await requestGraphQl(BASE_REPORT_QUERY, { reportCode });
    } catch (error) {
        const message = summarizeError(error);
        logger.error(
            { reportCode, fightId, error: message },
            "WCL base probe failed",
        );
        return reply.code(502).send({
            ok: false,
            message: "WCL base report probe failed",
            error: message,
        });
    }

    const reportNode = asObject(asObject(baseData.reportData)?.report);
    if (!reportNode) {
        return reply.code(502).send({
            ok: false,
            message: "WCL base report probe returned unexpected payload",
        });
    }

    const rateLimitData = asObject(baseData.rateLimitData) ?? null;
    const manifestEntries: ProbeManifestEntry[] = [];
    const fights = normalizeEncounterFights(reportNode);
    const selectedFight = fights.find((fight) => fight.id === fightId);
    const encounterId = selectedFight?.encounterID;

    const metadataByEncounter = normalizeEncounterMetadata(reportNode);
    const encounterPhases =
        typeof encounterId === "number"
            ? (metadataByEncounter.find((entry) => entry.encounterID === encounterId)
                  ?.phases ?? [])
            : [];
    const encounterPhaseTimes =
        typeof encounterId === "number"
            ? deriveEncounterPhaseTimes({
                  encounterId,
                  fights,
                  metadata: encounterPhases,
              })
            : null;

    const probes: {
        baseReport: unknown;
        masterData: unknown;
        encounterPhases: unknown;
        encounterPhaseTimes: unknown;
        reportRankings: unknown;
        reportRankingsDpsToday: unknown;
        reportRankingsHpsToday: unknown;
        bossRankings: unknown;
        reportWideTables: {
            damageDone: unknown;
            healing: unknown;
            deaths: unknown;
            dispels: unknown;
            interrupts: unknown;
        };
        selectedFightTables: {
            damageTaken: unknown;
            healing: unknown;
            deaths: unknown;
            dispels: unknown;
            interrupts: unknown;
            survivability: unknown;
        };
        resurrectEvents: unknown;
    } = {
        baseReport: reportNode,
        masterData: reportNode.masterData ?? null,
        encounterPhases: {
            encounterId: encounterId ?? null,
            phases: encounterPhases,
        },
        encounterPhaseTimes,
        reportRankings: null,
        reportRankingsDpsToday: null,
        reportRankingsHpsToday: null,
        bossRankings: null,
        reportWideTables: {
            damageDone: null,
            healing: null,
            deaths: null,
            dispels: null,
            interrupts: null,
        },
        selectedFightTables: {
            damageTaken: null,
            healing: null,
            deaths: null,
            dispels: null,
            interrupts: null,
            survivability: null,
        },
        resurrectEvents: null,
    };

    const logProbeResult = (entry: ProbeManifestEntry): void => {
        if (entry.success) {
            logger.info(
                {
                    probeFamily: entry.probeFamily,
                    reportCode,
                    fightId,
                    ...(typeof encounterId === "number" ? { encounterId } : {}),
                    summary: entry.summary,
                },
                "WCL public probe family succeeded",
            );
            return;
        }

        logger.warn(
            {
                probeFamily: entry.probeFamily,
                reportCode,
                fightId,
                ...(typeof encounterId === "number" ? { encounterId } : {}),
                summary: entry.summary,
                error: entry.error,
            },
            "WCL public probe family failed",
        );
    };

    const addManifestEntry = (entry: ProbeManifestEntry): void => {
        manifestEntries.push(entry);
        logProbeResult(entry);
    };

    addManifestEntry({
        probeFamily: "base-report",
        success: true,
        summary: summarizeShape(probes.baseReport),
    });
    addManifestEntry({
        probeFamily: "master-data",
        success: true,
        summary: summarizeShape(probes.masterData),
    });
    addManifestEntry({
        probeFamily: "encounter-phases",
        success: true,
        summary: `encounterId=${encounterId ?? "n/a"} phases=${encounterPhases.length}`,
    });
    addManifestEntry({
        probeFamily: "encounter-phase-times",
        success: true,
        summary:
            encounterPhaseTimes === null
                ? "encounterId unavailable"
                : `attempts=${asArray(asObject(encounterPhaseTimes)?.attempts)?.length ?? 0}`,
    });

    const runProbe = async (args: {
        probeFamily: string;
        queryText: string;
        variables: JsonRecord;
        onSuccess: (data: JsonRecord) => unknown | Promise<unknown>;
        summarize: (payload: unknown) => string;
    }): Promise<void> => {
        try {
            const data = await requestGraphQl(args.queryText, args.variables);
            const payload = await args.onSuccess(data);
            addManifestEntry({
                probeFamily: args.probeFamily,
                success: true,
                summary: args.summarize(payload),
            });
        } catch (error) {
            addManifestEntry({
                probeFamily: args.probeFamily,
                success: false,
                summary: "request failed",
                error: summarizeError(error),
            });
        }
    };

    await runProbe({
        probeFamily: "report-rankings",
        queryText: REPORT_RANKINGS_QUERY,
        variables: { reportCode },
        onSuccess: (data) => {
            const rankings = asObject(asObject(data.reportData)?.report)?.rankings ?? null;
            probes.reportRankings = rankings;
            return rankings;
        },
        summarize: summarizeRankingsPayload,
    });

    for (const rankingFamily of [
        {
            probeFamily: "report-rankings-dps-today",
            playerMetric: "dps",
            timeframe: "Today",
            assign: (value: unknown) => {
                probes.reportRankingsDpsToday = value;
            },
        },
        {
            probeFamily: "report-rankings-hps-today",
            playerMetric: "hps",
            timeframe: "Today",
            assign: (value: unknown) => {
                probes.reportRankingsHpsToday = value;
            },
        },
    ]) {
        await runProbe({
            probeFamily: rankingFamily.probeFamily,
            queryText: REPORT_RANKINGS_BY_METRIC_QUERY,
            variables: {
                reportCode,
                playerMetric: rankingFamily.playerMetric,
                timeframe: rankingFamily.timeframe,
            },
            onSuccess: (data) => {
                const rankings =
                    asObject(asObject(data.reportData)?.report)?.rankings ?? null;
                rankingFamily.assign(rankings);
                return rankings;
            },
            summarize: (payload) =>
                `metric=${rankingFamily.playerMetric} timeframe=${rankingFamily.timeframe} ${summarizeRankingsPayload(payload)}`,
        });
    }

    await runProbe({
        probeFamily: "boss-rankings",
        queryText: BOSS_RANKINGS_QUERY,
        variables: { reportCode, fightIDs: [fightId] },
        onSuccess: (data) => {
            const rankings = asObject(asObject(data.reportData)?.report)?.rankings ?? null;
            probes.bossRankings = rankings;
            return rankings;
        },
        summarize: summarizeRankingsPayload,
    });

    const reportStartTime = asNumber(reportNode.startTime);
    const reportEndTime = asNumber(reportNode.endTime);

    for (const tableFamily of [
        {
            probeFamily: "table-damage-done-report-wide",
            dataType: "DamageDone",
            assign: (value: unknown) => {
                probes.reportWideTables.damageDone = value;
            },
        },
        {
            probeFamily: "table-healing-report-wide",
            dataType: "Healing",
            assign: (value: unknown) => {
                probes.reportWideTables.healing = value;
            },
        },
        {
            probeFamily: "table-deaths-report-wide",
            dataType: "Deaths",
            assign: (value: unknown) => {
                probes.reportWideTables.deaths = value;
            },
        },
        {
            probeFamily: "table-dispels-report-wide",
            dataType: "Dispels",
            assign: (value: unknown) => {
                probes.reportWideTables.dispels = value;
            },
        },
        {
            probeFamily: "table-interrupts-report-wide",
            dataType: "Interrupts",
            assign: (value: unknown) => {
                probes.reportWideTables.interrupts = value;
            },
        },
    ]) {
        if (
            typeof reportStartTime !== "number" ||
            typeof reportEndTime !== "number"
        ) {
            addManifestEntry({
                probeFamily: tableFamily.probeFamily,
                success: false,
                summary: "request failed",
                error: "Base report payload missing startTime/endTime",
            });
            continue;
        }

        await runProbe({
            probeFamily: tableFamily.probeFamily,
            queryText: TABLE_REPORT_WIDE_QUERY,
            variables: {
                reportCode,
                dataType: tableFamily.dataType,
                startTime: reportStartTime,
                endTime: reportEndTime,
            },
            onSuccess: (data) => {
                const table = asObject(asObject(data.reportData)?.report)?.table ?? null;
                tableFamily.assign(table);
                return table;
            },
            summarize: summarizeShape,
        });
    }

    for (const tableFamily of [
        {
            probeFamily: "table-damage-taken",
            dataType: "DamageTaken",
            assign: (value: unknown) => {
                probes.selectedFightTables.damageTaken = value;
            },
        },
        {
            probeFamily: "table-healing",
            dataType: "Healing",
            assign: (value: unknown) => {
                probes.selectedFightTables.healing = value;
            },
        },
        {
            probeFamily: "table-deaths",
            dataType: "Deaths",
            assign: (value: unknown) => {
                probes.selectedFightTables.deaths = value;
            },
        },
        {
            probeFamily: "table-dispels",
            dataType: "Dispels",
            assign: (value: unknown) => {
                probes.selectedFightTables.dispels = value;
            },
        },
        {
            probeFamily: "table-interrupts",
            dataType: "Interrupts",
            assign: (value: unknown) => {
                probes.selectedFightTables.interrupts = value;
            },
        },
        {
            probeFamily: "table-survivability",
            dataType: "Survivability",
            assign: (value: unknown) => {
                probes.selectedFightTables.survivability = value;
            },
        },
    ]) {
        await runProbe({
            probeFamily: tableFamily.probeFamily,
            queryText: TABLE_QUERY,
            variables: { reportCode, fightIDs: [fightId], dataType: tableFamily.dataType },
            onSuccess: (data) => {
                const table = asObject(asObject(data.reportData)?.report)?.table ?? null;
                tableFamily.assign(table);
                return table;
            },
            summarize: summarizeShape,
        });
    }

    await runProbe({
        probeFamily: "fight-resurrect-events",
        queryText: RESURRECT_EVENTS_QUERY,
        variables: { reportCode, fightIDs: [fightId], startTime: null, filterExpression: 'type = "resurrect"' },
        onSuccess: async () => {
            const pages: unknown[] = [];
            let startTime: number | undefined;

            for (;;) {
                const data = await requestGraphQl(RESURRECT_EVENTS_QUERY, {
                    reportCode,
                    fightIDs: [fightId],
                    startTime: startTime ?? null,
                    filterExpression: 'type = "resurrect"',
                });

                const eventNode = asObject(asObject(asObject(data.reportData)?.report)?.events) ?? null;
                pages.push(eventNode);

                const next = asNumber(asObject(eventNode)?.nextPageTimestamp);
                if (typeof next !== "number") {
                    break;
                }
                startTime = next;
            }

            const payload = { pages, pageCount: pages.length };
            probes.resurrectEvents = payload;
            return payload;
        },
        summarize: (payload) => `pages=${asNumber(asObject(payload)?.pageCount) ?? 0}`,
    });

    return reply.send({
        ok: true,
        payload: {
            rateLimitData,
            reportCode,
            fightId,
            encounterId: encounterId ?? null,
            probes,
            manifest: {
                entries: manifestEntries,
            },
        },
    });
});

app.post(
    "/discord/interactions",
    {
        config: {
            rawBody: true,
        },
    },
    async (req, reply) => {
        try {
            const signature = req.headers["x-signature-ed25519"];
            const timestamp = req.headers["x-signature-timestamp"];
            if (
                typeof signature !== "string" ||
                typeof timestamp !== "string"
            ) {
                return reply
                    .code(401)
                    .send({ error: "Missing Discord headers" });
            }
            const rawBody =
                typeof (req as { rawBody?: unknown }).rawBody === "string"
                    ? (req as { rawBody: string }).rawBody
                    : "";

            const isValid = await verifyKey(
                rawBody,
                signature,
                timestamp,
                env.DISCORD_PUBLIC_KEY,
            );

            logger.info({ isValid }, "discord signature result");

            if (!isValid)
                return reply.code(401).send({ error: "Invalid signature" });

            const body = req.body as Record<string, unknown>;

            if (body?.type === 1) {
                return reply.code(200).send({ type: 1 });
            }

            const response = await handleInteraction(body, {
                wclClient,
                guildConfigStore,
                recapPreviewStateService,
                previewStateTtlSeconds: env.PREVIEW_STATE_TTL_SECONDS,
                coachingViewService,
                accountabilityViewService,
                trendTrackingService,
            });
            return reply.send(response);
        } catch (error) {
            logger.error({ error }, "interaction handling failed");
            return reply.code(500).send({ error: "Internal server error" });
        }
    },
);

const pickGuildId = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

app.post("/discord/register-commands", async (req, reply) => {
    try {
        const body =
            typeof req.body === "object" && req.body !== null
                ? (req.body as Record<string, unknown>)
                : undefined;
        const query = req.query as Record<string, unknown> | undefined;

        const guildId =
            pickGuildId(query?.guildId) ?? pickGuildId(body?.guildId);

        if (guildId) {
            await registerGuildCommands(
                env.DISCORD_APPLICATION_ID,
                env.DISCORD_BOT_TOKEN,
                guildId,
            );
        } else {
            await registerGlobalCommands(
                env.DISCORD_APPLICATION_ID,
                env.DISCORD_BOT_TOKEN,
            );
        }

        return reply.send({
            status: "registered",
            scope: guildId ? "guild" : "global",
            guildId: guildId ?? null,
        });
    } catch (error) {
        logger.error({ error }, "register commands failed");

        if (error instanceof DiscordCommandRegistrationError) {
            return reply.code(502).send({
                error: "Discord command registration failed",
                scope: error.details.targetScope,
                discordStatus: error.details.status,
                discordStatusText: error.details.statusText,
                discordErrorBody: error.details.responseBody,
            });
        }

        if (error instanceof Error) {
            return reply.code(400).send({
                error: "Command validation failed",
                message: error.message,
            });
        }

        return reply.code(500).send({ error: "Internal server error" });
    }
});

const start = async () => {
    await connectMongo(env.MONGODB_URI);
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info({ port: env.PORT }, "web app started");
};

start().catch((error) => {
    logger.fatal({ error }, "web app failed to start");
    process.exit(1);
});

process.on("SIGTERM", async () => {
    logger.info("received SIGTERM");
    await app.close();
    process.exit(0);
});
