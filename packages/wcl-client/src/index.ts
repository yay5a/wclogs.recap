import { GraphQLClient, gql } from "graphql-request";
import fixture from "./fixtures/report-fixture.json" with { type: "json" };
import type {
    GameFamily,
    NormalizedBossPerformance,
    NormalizedFight,
    NormalizedLeaderboardEntry,
    NormalizedPlayer,
    NormalizedReport,
} from "@wcl/domain";
import { ReportCacheModel } from "@wcl/db";
import {
    asNumber,
    asObject,
    asString,
    indexLeaderboardByActorAndName,
    normalizeName,
    parseBossRankingsPayload,
    parsePlayerDetailsPayload,
    parseReportRankingsPayload,
    parseTablePayload,
    type ParsedTableEntry,
    type TableDataType,
} from "./parsers/index.js";

export interface ParsedReportUrl {
    reportCode: string;
    gameFamily: GameFamily;
    rawUrl: string;
}

const REPORT_CODE_PATTERN = /^[A-Za-z0-9]+$/;

export const normalizeReportUrlInput = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("Report URL is empty");
    }

    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
        const unwrapped = trimmed.slice(1, -1).trim();
        if (!unwrapped) {
            throw new Error("Report URL is empty");
        }
        return unwrapped;
    }

    return trimmed;
};

const extractReportCodeFromPath = (pathname: string): string | undefined => {
    const segments = pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

    for (let i = 0; i < segments.length - 1; i += 1) {
        const segment = segments[i]?.toLowerCase();
        if (segment !== "reports" && segment !== "report") continue;

        const candidate = decodeURIComponent(segments[i + 1] ?? "").trim();
        if (candidate && REPORT_CODE_PATTERN.test(candidate)) {
            return candidate;
        }
    }

    return undefined;
};

export const parseReportUrl = (url: string): ParsedReportUrl => {
    const normalizedInput = normalizeReportUrlInput(url);
    let parsed: URL;
    try {
        parsed = new URL(normalizedInput);
    } catch {
        throw new Error("Invalid Warcraft Logs report URL");
    }
    const queryReportCode =
        parsed.searchParams.get("report") ?? parsed.searchParams.get("code");
    const reportCode =
        queryReportCode?.trim() || extractReportCodeFromPath(parsed.pathname);
    if (!reportCode || !REPORT_CODE_PATTERN.test(reportCode)) {
        throw new Error(
            "Could not find a Warcraft Logs report code in the URL",
        );
    }

    const lowerHost = parsed.hostname.toLowerCase();
    const lowerPath = parsed.pathname.toLowerCase();
    const gameFamily: GameFamily =
        lowerHost.includes("classic") ||
        lowerPath.includes("classic") ||
        lowerPath.includes("mop")
            ? "mop_classic"
            : "retail";
    return { reportCode, gameFamily, rawUrl: normalizedInput };
};

const BASE_REPORT_QUERY = gql`
  query BaseReportSummary($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        endTime
        zone { name }
        fights(killType: Kills) {
          id
          name
          startTime
          endTime
          kill
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

const REPORT_RANKINGS_QUERY = gql`
  query ReportRankings($code: String!) {
    reportData {
      report(code: $code) {
        rankings(playerMetric: default)
      }
    }
  }
`;

const BOSS_RANKINGS_QUERY = gql`
  query BossRankings($code: String!, $fightIDs: Int) {
    reportData {
      report(code: $code) {
        rankings(playerMetric: default, fightIDs: $fightIDs)
      }
    }
  }
`;

const PLAYER_DETAILS_QUERY = gql`
  query PlayerDetails($code: String!, $startTime: Float, $endTime: Float) {
    reportData {
      report(code: $code) {
        playerDetails(startTime: $startTime, endTime: $endTime)
      }
    }
  }
`;

const TABLE_QUERY = gql`
  query ReportTable($code: String!, $fightIDs: Int) {
    reportData {
      report(code: $code) {
        damageDone: table(dataType: DamageDone, fightIDs: $fightIDs)
        healing: table(dataType: Healing, fightIDs: $fightIDs)
        deaths: table(dataType: Deaths, fightIDs: $fightIDs)
        interrupts: table(dataType: Interrupts, fightIDs: $fightIDs)
        survivability: table(dataType: Survivability, fightIDs: $fightIDs)
      }
    }
  }
`;

interface WclClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
}

interface EnrichedRawReport {
    base: unknown;
    reportRankings?: unknown;
    playerDetails?: unknown;
    reportTables?: Partial<Record<TableDataType, unknown>>;
    bossRankings: Array<{ fightId: number; bossName: string; payload: unknown }>;
    bossTables: Array<{
        fightId: number;
        bossName: string;
        tables: Partial<Record<TableDataType, unknown>>;
    }>;
}

const getReportNode = (raw: unknown): Record<string, unknown> | undefined => {
    const root = asObject(raw);
    const data = asObject(root?.data);
    const reportData = asObject(data?.reportData ?? root?.reportData);
    return asObject(reportData?.report);
};

export class WclClient {
    private token: string | null = null;
    private readonly gqlClient: GraphQLClient;

    public constructor(private readonly options: WclClientOptions) {
        this.gqlClient = options.fetchImpl
            ? new GraphQLClient(options.apiBaseUrl, {
                  fetch: options.fetchImpl,
              })
            : new GraphQLClient(options.apiBaseUrl);
    }

    private async getAccessToken(): Promise<string> {
        if (this.token) return this.token;
        const auth = Buffer.from(
            `${this.options.clientId}:${this.options.clientSecret}`,
        ).toString("base64");
        const response = await fetch(
            "https://www.warcraftlogs.com/oauth/token",
            {
                method: "POST",
                headers: {
                    Authorization: `Basic ${auth}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: "grant_type=client_credentials",
            },
        );
        if (!response.ok)
            throw new Error(`WCL OAuth failed: ${response.status}`);
        const payload = (await response.json()) as { access_token: string };
        this.token = payload.access_token;
        return payload.access_token;
    }

    private async fetchEnrichedRawReport(code: string): Promise<EnrichedRawReport> {
        const base = await this.gqlClient.request(BASE_REPORT_QUERY, { code });
        const baseReport = getReportNode(base);
        const baseFights = baseReport && Array.isArray(baseReport.fights) ? baseReport.fights : [];
        const fights = baseFights.flatMap((value) => {
            const fight = asObject(value);
            const id = asNumber(fight?.id);
            const name = asString(fight?.name);
            if (typeof id !== "number" || !name) return [];
            return [{ id, name }];
        });

        const reportRankingsRaw = await this.gqlClient.request(REPORT_RANKINGS_QUERY, { code });
        const playerDetailsRaw = await this.gqlClient.request(PLAYER_DETAILS_QUERY, {
            code,
            startTime: asNumber(baseReport?.startTime),
            endTime: asNumber(baseReport?.endTime),
        });
        const reportTablesRaw = await this.gqlClient.request(TABLE_QUERY, {
            code,
            fightIDs: -1,
        });

        const bossRankings: Array<{ fightId: number; bossName: string; payload: unknown }> = [];
        const bossTables: Array<{
            fightId: number;
            bossName: string;
            tables: Partial<Record<TableDataType, unknown>>;
        }> = [];

        for (const fight of fights) {
            const rankingsPayload = await this.gqlClient.request(BOSS_RANKINGS_QUERY, {
                code,
                fightIDs: fight.id,
            });
            bossRankings.push({
                fightId: fight.id,
                bossName: fight.name,
                payload: getReportNode(rankingsPayload)?.rankings,
            });

            const tablesPayload = await this.gqlClient.request(TABLE_QUERY, {
                code,
                fightIDs: fight.id,
            });
            const tableNode = getReportNode(tablesPayload);
            bossTables.push({
                fightId: fight.id,
                bossName: fight.name,
                tables: {
                    DamageDone: tableNode?.damageDone,
                    Healing: tableNode?.healing,
                    Deaths: tableNode?.deaths,
                    Interrupts: tableNode?.interrupts,
                    Survivability: tableNode?.survivability,
                },
            });
        }

        return {
            base,
            reportRankings: getReportNode(reportRankingsRaw)?.rankings,
            playerDetails: getReportNode(playerDetailsRaw)?.playerDetails,
            reportTables: {
                DamageDone: getReportNode(reportTablesRaw)?.damageDone,
                Healing: getReportNode(reportTablesRaw)?.healing,
                Deaths: getReportNode(reportTablesRaw)?.deaths,
                Interrupts: getReportNode(reportTablesRaw)?.interrupts,
                Survivability: getReportNode(reportTablesRaw)?.survivability,
            },
            bossRankings,
            bossTables,
        };
    }

    public async fetchAndNormalizeReport(
        url: string,
    ): Promise<NormalizedReport> {
        const parsed = parseReportUrl(url);
        const cached = await ReportCacheModel.findOne({
            reportCode: parsed.reportCode,
        }).lean();
        if (cached) {
            return cached.normalizedPayload as NormalizedReport;
        }

        let rawPayload: unknown;
        if (process.env.WCL_USE_FIXTURES === "true") {
            rawPayload = {
                base: fixture,
                reportRankings: getReportNode(fixture)?.rankings,
                playerDetails: undefined,
                reportTables: {},
                bossRankings: [],
                bossTables: [],
            } satisfies EnrichedRawReport;
        } else {
            const token = await this.getAccessToken();
            this.gqlClient.setHeader("Authorization", `Bearer ${token}`);
            rawPayload = await this.fetchEnrichedRawReport(parsed.reportCode);
        }

        const normalized = normalizeEnrichedReport(rawPayload, parsed);

        await ReportCacheModel.create({
            reportCode: parsed.reportCode,
            sourceUrl: url,
            gameFamily: parsed.gameFamily,
            rawPayload,
            normalizedPayload: normalized,
            fetchedAt: new Date(),
        });

        return normalized;
    }
}

const summarizeBossTables = (
    bossName: string,
    fightId: number,
    parsedTables: Partial<Record<TableDataType, ParsedTableEntry[]>>,
    parseEntry?: NormalizedLeaderboardEntry,
): NormalizedBossPerformance => {
    // Find the top entry by value for a given table type. Return undefined if no entries exist.
    const topByValue = (entries?: ParsedTableEntry[]) =>
        (entries ?? [])
            .slice()
            .sort((a, b) => b.value - a.value)[0] as ParsedTableEntry | undefined;

    // Precompute top performers for each category. Avoid assigning undefined values directly to the result object
    // because exactOptionalPropertyTypes requires optional properties to be omitted entirely when absent.
    const topParse = parseEntry;

    const topDamageEntry = topByValue(parsedTables.DamageDone);
    const topDamage = topDamageEntry
        ? {
              playerName: topDamageEntry.playerName ?? "Unknown",
              value: topDamageEntry.value ?? 0,
          }
        : undefined;

    const topHealingEntry = topByValue(parsedTables.Healing);
    const topHealing = topHealingEntry
        ? {
              playerName: topHealingEntry.playerName ?? "Unknown",
              value: topHealingEntry.value ?? 0,
          }
        : undefined;

    const mostDeathsEntry = (parsedTables.Deaths ?? [])
        .slice()
        .sort((a, b) => b.value - a.value)[0] as ParsedTableEntry | undefined;
    const mostDeaths = mostDeathsEntry
        ? {
              playerName: mostDeathsEntry.playerName ?? "Unknown",
              value: mostDeathsEntry.value,
          }
        : undefined;

    const topInterruptsEntry = topByValue(parsedTables.Interrupts);
    const topInterrupts = topInterruptsEntry
        ? {
              playerName: topInterruptsEntry.playerName ?? "Unknown",
              value: topInterruptsEntry.value ?? 0,
          }
        : undefined;

    const topSurvivabilityEntry = topByValue(parsedTables.Survivability);
    const topSurvivability = topSurvivabilityEntry
        ? {
              playerName: topSurvivabilityEntry.playerName ?? "Unknown",
              value: topSurvivabilityEntry.value ?? 0,
          }
        : undefined;

    // Build the result object, only including optional properties when they are defined. This avoids assigning
    // undefined values to optional properties under exactOptionalPropertyTypes.
    const result: NormalizedBossPerformance = {
        bossName,
        fightId,
        ...(topParse ? { topParse } : {}),
        ...(topDamage ? { topDamage } : {}),
        ...(topHealing ? { topHealing } : {}),
        ...(mostDeaths ? { mostDeaths } : {}),
        ...(topInterrupts ? { topInterrupts } : {}),
        ...(topSurvivability ? { topSurvivability } : {}),
    };
    return result;
};

export const normalizeEnrichedReport = (
    raw: unknown,
    parsed: ParsedReportUrl,
): NormalizedReport => {
    const enriched = asObject(raw);
    const base = enriched?.base ?? raw;
    const report = getReportNode(base);
    if (!report) throw new Error("Unexpected WCL payload shape");

    const fights: NormalizedFight[] = (
        Array.isArray(report.fights) ? report.fights : []
    ).flatMap((fightValue) => {
        const fight = asObject(fightValue);
        if (!fight) return [];
        const id = asNumber(fight.id);
        const name = asString(fight.name);
        const startTime = asNumber(fight.startTime);
        const endTime = asNumber(fight.endTime);
        if (
            typeof id !== "number" ||
            typeof name !== "string" ||
            typeof startTime !== "number" ||
            typeof endTime !== "number"
        ) {
            return [];
        }

        return [
            {
                id,
                name,
                startTime,
                endTime,
                kill: Boolean(fight.kill),
            },
        ];
    });

    // WCL rankings JSON may be string or object depending on resolver/game family; parser handles both.
    const reportLeaderboards = parseReportRankingsPayload(
        enriched?.reportRankings ?? report.rankings,
    );
    const bossRankingsRaw =
        enriched && Array.isArray(enriched.bossRankings) ? enriched.bossRankings : [];
    const bossLeaderboards = bossRankingsRaw.flatMap((value) => {
        const boss = asObject(value);
        if (!boss) return [];
        const fightId = asNumber(boss.fightId);
        const bossName = asString(boss.bossName);
        if (typeof fightId !== "number") return [];
        // Only include bossName and fightId properties in the context when they are defined.
        const context: { bossName?: string; fightId?: number } = {};
        if (typeof fightId === "number") context.fightId = fightId;
        if (bossName) context.bossName = bossName;
        return parseBossRankingsPayload(boss.payload, context);
    });

    const playerDetails = parsePlayerDetailsPayload(enriched?.playerDetails);
    const detailByName = new Map(playerDetails.map((entry) => [normalizeName(entry.name), entry]));

    const leaderboardIndex = indexLeaderboardByActorAndName([
        ...reportLeaderboards,
        ...bossLeaderboards,
    ]);

    const players: NormalizedPlayer[] = (
        asObject(report.masterData)?.actors instanceof Array
            ? (asObject(report.masterData)?.actors as unknown[])
            : []
    ).flatMap((actorValue, index) => {
        const actor = asObject(actorValue);
        if (!actor) return [];
        const name = asString(actor.name);
        if (!name) return [];

        const actorId = asNumber(actor.id);
        const detail = detailByName.get(normalizeName(name));
        // Join strategy: prefer stable actor ID from masterData/rankings, fallback to normalized name when IDs are absent.
        const leaderboardMatches =
            (typeof actorId === "number"
                ? leaderboardIndex.byActorId.get(actorId)
                : undefined) ??
            leaderboardIndex.byName.get(normalizeName(name)) ??
            [];

        // Build the player object without assigning undefined to optional properties. The actorId
        // property is added only when a numeric actorId is present; otherwise it is omitted entirely.
        const player: NormalizedPlayer = {
            id: String(actorId ?? index),
            name,
            nameKey: normalizeName(name),
        };
        if (typeof actorId === "number") {
            player.actorId = actorId;
        }
        const className = asString(actor.subType) ?? detail?.className;
        const realm = asString(actor.server);
        if (className) player.className = className;
        if (realm) player.realm = realm;
        if (detail?.specName) player.specName = detail.specName;
        if (detail?.role) player.role = detail.role;

        // Determine best and average parse values only when leaderboard entries exist. The properties
        // bestParse and avgParse are omitted unless a best entry is found.
        const reportEntries = leaderboardMatches.filter((entry) => entry.scope === "report");
        const best = [...reportEntries].sort((a, b) => b.value - a.value)[0];
        if (best) {
            player.bestParse = best.value;
            player.avgParse = best.value;
        }

        return [player];
    });

    const bossPerformances: NormalizedBossPerformance[] = [];
    for (const fight of fights) {
        const bossTablesRaw =
            enriched && Array.isArray(enriched.bossTables) ? enriched.bossTables : [];
        const bossTablePayload = bossTablesRaw.find((value) => {
            const row = asObject(value);
            return asNumber(row?.fightId) === fight.id;
        });

        const tableNode = asObject(bossTablePayload?.tables);
        const parsedTables: Partial<Record<TableDataType, ParsedTableEntry[]>> = {
            DamageDone: parseTablePayload(tableNode?.DamageDone, "DamageDone"),
            Healing: parseTablePayload(tableNode?.Healing, "Healing"),
            Deaths: parseTablePayload(tableNode?.Deaths, "Deaths"),
            Interrupts: parseTablePayload(tableNode?.Interrupts, "Interrupts"),
            Survivability: parseTablePayload(tableNode?.Survivability, "Survivability"),
        };
        const topBossParse = bossLeaderboards
            .filter((entry) => entry.fightId === fight.id)
            .sort((a, b) => b.value - a.value)[0];

        bossPerformances.push(
            summarizeBossTables(fight.name, fight.id, parsedTables, topBossParse),
        );
    }

    const normalized: NormalizedReport = {
        reportCode: parsed.reportCode,
        title: asString(report.title) ?? "Untitled Report",
        startTime: asNumber(report.startTime) ?? Date.now(),
        endTime: asNumber(report.endTime) ?? Date.now(),
        gameFamily: parsed.gameFamily,
        fights,
        players,
        leaderboards: [...reportLeaderboards, ...bossLeaderboards],
        bossPerformances,
    };

    const zoneName = asString(asObject(report.zone)?.name);
    if (zoneName) normalized.zoneName = zoneName;

    return normalized;
};

export const normalizeReport = (
    raw: unknown,
    parsed: ParsedReportUrl,
): NormalizedReport => normalizeEnrichedReport({ base: raw }, parsed);

export const retailAdapter = normalizeEnrichedReport;
export const mopClassicAdapter = normalizeEnrichedReport;
