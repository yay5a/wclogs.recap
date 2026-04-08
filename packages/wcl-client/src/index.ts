import { GraphQLClient, gql } from "graphql-request";
import fixture from "./fixtures/report-fixture.json" with { type: "json" };
import type {
    GameFamily,
    NormalizedFight,
    NormalizedPlayer,
    NormalizedReport,
} from "@wcl/domain";
import { ReportCacheModel } from "@wcl/db";

export interface ParsedReportUrl {
    reportCode: string;
    gameFamily: GameFamily;
    rawUrl: string;
}

export const parseReportUrl = (url: string): ParsedReportUrl => {
    const parsed = new URL(url);
    const reportCode =
        parsed.searchParams.get("report") ?? parsed.searchParams.get("code");
    if (!reportCode) throw new Error("Missing report code in WCL URL");
    const lowerHost = parsed.hostname.toLowerCase();
    const lowerPath = parsed.pathname.toLowerCase();
    const gameFamily: GameFamily =
        lowerHost.includes("classic") ||
        lowerPath.includes("classic") ||
        lowerPath.includes("mop")
            ? "mop_classic"
            : "retail";
    return { reportCode, gameFamily, rawUrl: url };
};

const REPORT_QUERY = gql`
  query ReportSummary($code: String!) {
    reportData {
      report(code: $code) {
        title
        startTime
        endTime
        zone {
          name
        }
        fights(killType: Kills) {
          id
          name
          startTime
          endTime
          kill
        }
        rankings
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

interface WclClientOptions {
    clientId: string;
    clientSecret: string;
    apiBaseUrl: string;
    fetchImpl?: typeof fetch;
}

type RankingMetric = {
    bestParse?: number;
    avgParse?: number;
    executionScore?: number;
};

const asObject = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : undefined;

const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

const pickNumber = (
    obj: Record<string, unknown>,
    keys: string[],
): number | undefined => {
    for (const key of keys) {
        const v = asNumber(obj[key]);
        if (typeof v === "number") return v;
    }
    return undefined;
};

const parseRankingsPayload = (
    rankings: unknown,
): Map<string, RankingMetric> => {
    const parsedRankings =
        typeof rankings === "string"
            ? (JSON.parse(rankings) as unknown)
            : rankings;
    const root = asObject(parsedRankings);
    if (!root) return new Map<string, RankingMetric>();

    const containers: unknown[] = [
        root,
        ...(Array.isArray(root.data) ? root.data : []),
        ...(Array.isArray(root.rankings) ? root.rankings : []),
        ...(Array.isArray(root.players) ? root.players : []),
    ];

    const byName = new Map<string, RankingMetric>();
    for (const container of containers) {
        const entry = asObject(container);
        if (!entry) continue;

        const nestedPlayer = asObject(entry.player);
        const nestedCharacter = asObject(entry.character);
        const nestedActor = asObject(entry.actor);
        const name =
            asString(entry.name) ??
            asString(nestedPlayer?.name) ??
            asString(nestedCharacter?.name) ??
            asString(nestedActor?.name);
        if (!name) continue;

        const bestParse = pickNumber(entry, [
            "bestPerformanceAverage",
            "bestPercent",
            "bestParse",
            "bestAmount",
            "rankPercent",
            "percentile",
        ]);
        const avgParse = pickNumber(entry, [
            "performanceAverage",
            "averagePerformance",
            "avgParse",
            "averageAmount",
            "averagePercent",
            "medianPercent",
        ]);
        const executionScore = pickNumber(entry, [
            "execution",
            "executionScore",
            "executionPercent",
            "executionRankPercent",
        ]);

        const prior = byName.get(name) ?? {};
        const merged: RankingMetric = {};
        const resolvedBestParse = bestParse ?? prior.bestParse;
        const resolvedAvgParse = avgParse ?? prior.avgParse;
        const resolvedExecutionScore = executionScore ?? prior.executionScore;
        if (typeof resolvedBestParse === "number")
            merged.bestParse = resolvedBestParse;
        if (typeof resolvedAvgParse === "number")
            merged.avgParse = resolvedAvgParse;
        if (typeof resolvedExecutionScore === "number") {
            merged.executionScore = resolvedExecutionScore;
        }
        byName.set(name, merged);
    }

    return byName;
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
            rawPayload = fixture;
        } else {
            const token = await this.getAccessToken();
            this.gqlClient.setHeader("Authorization", `Bearer ${token}`);
            rawPayload = await this.gqlClient.request(REPORT_QUERY, {
                code: parsed.reportCode,
            });
        }

        const normalized = normalizeReport(rawPayload, parsed);

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

export const normalizeReport = (
    raw: unknown,
    parsed: ParsedReportUrl,
): NormalizedReport => {
    const root = asObject(raw);
    const data = asObject(root?.data);
    const reportData = asObject(data?.reportData ?? root?.reportData);
    const report = asObject(reportData?.report);
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

    const rankingByName = parseRankingsPayload(report.rankings);

    const players: NormalizedPlayer[] = (
        asObject(report.masterData)?.actors instanceof Array
            ? (asObject(report.masterData)?.actors as unknown[])
            : []
    ).flatMap((actorValue, index) => {
        const actor = asObject(actorValue);
        if (!actor) return [];
        const name = asString(actor.name);
        if (!name) return [];

        const player: NormalizedPlayer = {
            id: String(asNumber(actor.id) ?? index),
            name,
        };
        const className = asString(actor.subType);
        const realm = asString(actor.server);
        if (className) player.className = className;
        if (realm) player.realm = realm;

        const metrics = rankingByName.get(name);
        if (typeof metrics?.bestParse === "number") {
            player.bestParse = metrics.bestParse;
        }
        if (typeof metrics?.avgParse === "number") {
            player.avgParse = metrics.avgParse;
        }
        if (typeof metrics?.executionScore === "number") {
            player.executionScore = metrics.executionScore;
        }

        return [player];
    });

    const normalized: NormalizedReport = {
        reportCode: parsed.reportCode,
        title: asString(report.title) ?? "Untitled Report",
        startTime: asNumber(report.startTime) ?? Date.now(),
        endTime: asNumber(report.endTime) ?? Date.now(),
        gameFamily: parsed.gameFamily,
        fights,
        players,
    };

    const zoneName = asString(asObject(report.zone)?.name);
    if (zoneName) normalized.zoneName = zoneName;

    return normalized;
};

export const retailAdapter = normalizeReport;
export const mopClassicAdapter = normalizeReport;
