import { GraphQLClient, gql } from 'graphql-request';
import fixture from './fixtures/report-fixture.json' with { type: 'json' };
import type {
  GameFamily,
  NormalizedFight,
  NormalizedPlayer,
  NormalizedReport,
  PreviousRaidLookup,
} from '@wcl/domain';
import {
  FightSnapshotModel,
  PlayerRaidSummaryModel,
  RaidSnapshotModel,
  ReportCacheModel,
  toNormalizedPlayersFromRaidSummary,
} from '@wcl/db';

const WCL_HOSTS = new Set(['www.warcraftlogs.com', 'classic.warcraftlogs.com']);

export interface ParsedReportUrl {
  reportCode: string;
  gameFamilyHint: GameFamily;
  rawUrl: string;
  host: string;
  requestedFightId?: number;
}

export class ReportUrlParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ReportUrlParseError';
  }
}

const extractReportCode = (parsed: URL): string | undefined => {
  const reportParam = parsed.searchParams.get('report') ?? parsed.searchParams.get('code');
  if (reportParam) return reportParam;

  const pathMatch = parsed.pathname.match(/\/reports\/([A-Za-z0-9]+)/i);
  if (pathMatch?.[1] && pathMatch[1].toLowerCase() !== 'view') return pathMatch[1];

  return undefined;
};

const extractFightId = (parsed: URL): number | undefined => {
  const fightKeys = ['fight', 'fightID', 'fightId', 'encounter'];
  for (const key of fightKeys) {
    const raw = parsed.searchParams.get(key);
    if (!raw) continue;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new ReportUrlParseError(`Invalid fight selector '${raw}' in WCL URL`);
    }
    return n;
  }
  return undefined;
};

const detectGameFamilyHint = (parsed: URL): GameFamily => {
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  const explicit = parsed.searchParams.get('game')?.toLowerCase();

  if (host.includes('classic')) return 'mop_classic';
  if (path.includes('/classic') || path.includes('/mop')) return 'mop_classic';
  if (explicit && ['classic', 'mop', 'mop_classic'].includes(explicit)) return 'mop_classic';

  return 'retail';
};

export const parseReportUrl = (url: string): ParsedReportUrl => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ReportUrlParseError('Invalid URL format');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new ReportUrlParseError(`Unsupported protocol '${parsed.protocol}'`);
  }

  const host = parsed.hostname.toLowerCase();
  if (![...WCL_HOSTS].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new ReportUrlParseError(`Unsupported Warcraft Logs host '${parsed.hostname}'`);
  }

  const reportCode = extractReportCode(parsed);
  if (!reportCode) {
    throw new ReportUrlParseError('Missing report code in WCL URL');
  }

  if (!/^[A-Za-z0-9]+$/.test(reportCode)) {
    throw new ReportUrlParseError('Invalid report code format');
  }

  const parsedResult: ParsedReportUrl = {
    reportCode,
    gameFamilyHint: detectGameFamilyHint(parsed),
    rawUrl: url,
    host,
  };

  const fightId = extractFightId(parsed);
  if (typeof fightId === 'number') parsedResult.requestedFightId = fightId;

  return parsedResult;
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

interface ParsedRankingPlayer {
  name: string;
  className?: string;
  specName?: string;
  performance?: number;
  execution?: number;
}

const safeJsonParse = (raw: string | null | undefined): unknown => {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const toRankingRows = (rankings: unknown): ParsedRankingPlayer[] => {
  const parsed = typeof rankings === 'string' ? safeJsonParse(rankings) : rankings;
  if (!parsed || typeof parsed !== 'object') return [];

  const data = (parsed as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const rows: ParsedRankingPlayer[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name : undefined;
    if (!name) continue;

    const normalized: ParsedRankingPlayer = { name };
    if (typeof row.class === 'string') normalized.className = row.class;
    if (typeof row.spec === 'string') normalized.specName = row.spec;
    if (typeof row.rankPercent === 'number') normalized.performance = row.rankPercent;
    if (typeof row.executionRank === 'number') normalized.execution = row.executionRank;
    rows.push(normalized);
  }

  return rows;
};

const computePlayerMetrics = (rankingRows: ParsedRankingPlayer[]) => {
  const byName = new Map<string, { parses: number[]; executions: number[]; specName?: string; className?: string }>();

  for (const row of rankingRows) {
    const current = byName.get(row.name) ?? { parses: [], executions: [] };
    if (typeof row.performance === 'number') current.parses.push(row.performance);
    if (typeof row.execution === 'number') current.executions.push(row.execution);
    if (row.specName) current.specName = row.specName;
    if (row.className) current.className = row.className;
    byName.set(row.name, current);
  }

  return byName;
};

const aggregatePlayers = (
  actors: Array<Record<string, unknown>>,
  rankingRows: ParsedRankingPlayer[],
): NormalizedPlayer[] => {
  const metrics = computePlayerMetrics(rankingRows);
  return actors
    .map((actor, index) => {
      const name = typeof actor.name === 'string' ? actor.name : undefined;
      if (!name) return undefined;
      const playerMetrics = metrics.get(name);
      const parses = playerMetrics?.parses ?? [];
      const executions = playerMetrics?.executions ?? [];
      const avgParse =
        parses.length > 0
          ? parses.reduce((sum, value) => sum + value, 0) / parses.length
          : undefined;

      const performance: NormalizedPlayer['performance'] = {};
      const execution: NormalizedPlayer['execution'] = {};
      const realm = typeof actor.server === 'string' ? actor.server : undefined;
      const className =
        (typeof actor.subType === 'string' ? actor.subType : undefined) ??
        playerMetrics?.className;
      const executionScore =
        executions.length > 0
          ? executions.reduce((sum, value) => sum + value, 0) / executions.length
          : undefined;

      if (parses.length > 0) performance.bestSingleBossParse = Math.max(...parses);
      if (typeof avgParse === 'number') performance.averageParseAcrossKills = avgParse;
      if (typeof executionScore === 'number') execution.executionScore = executionScore;

      const player: NormalizedPlayer = {
        id: String(actor.id ?? index),
        name,
        performance,
        execution,
      };

      if (realm) player.realm = realm;
      if (className) player.className = className;
      if (playerMetrics?.specName) player.specName = playerMetrics.specName;

      return player;
    })
    .filter((player): player is NormalizedPlayer => Boolean(player));
};

const normalizeReportFromPayload = (raw: unknown, parsed: ParsedReportUrl): NormalizedReport => {
  const container = raw as { data?: { reportData?: { report?: unknown } }; reportData?: { report?: unknown } };
  const report = container?.data?.reportData?.report ?? container?.reportData?.report;
  if (!report || typeof report !== 'object') {
    throw new Error('Unexpected WCL payload shape');
  }

  const record = report as Record<string, unknown>;
  const fightsRaw = Array.isArray(record.fights) ? record.fights : [];
  const fights: NormalizedFight[] = fightsRaw
    .map((fight) => {
      if (!fight || typeof fight !== 'object') return undefined;
      const source = fight as Record<string, unknown>;
      if (typeof source.id !== 'number' || typeof source.name !== 'string') return undefined;
      return {
        id: source.id,
        name: source.name,
        startTime: typeof source.startTime === 'number' ? source.startTime : 0,
        endTime: typeof source.endTime === 'number' ? source.endTime : 0,
        kill: Boolean(source.kill),
      } satisfies NormalizedFight;
    })
    .filter((fight): fight is NormalizedFight => Boolean(fight));

  const masterData =
    record.masterData && typeof record.masterData === 'object'
      ? (record.masterData as Record<string, unknown>)
      : undefined;
  const actorsRaw = Array.isArray(masterData?.actors)
    ? (masterData?.actors as Array<Record<string, unknown>>)
    : [];

  const rankingRows = toRankingRows(record.rankings);

  const normalized: NormalizedReport = {
    reportCode: parsed.reportCode,
    title: typeof record.title === 'string' ? record.title : `Report ${parsed.reportCode}`,
    startTime: typeof record.startTime === 'number' ? record.startTime : Date.now(),
    endTime: typeof record.endTime === 'number' ? record.endTime : Date.now(),
    gameFamily: parsed.gameFamilyHint,
    comparisonMode: 'character',
    sourceHost: parsed.host,
    fights,
    players: aggregatePlayers(actorsRaw, rankingRows),
  };

  const zoneName =
    record.zone && typeof record.zone === 'object' && typeof (record.zone as { name?: unknown }).name === 'string'
      ? (record.zone as { name: string }).name
      : undefined;
  if (zoneName) normalized.zoneName = zoneName;
  if (typeof parsed.requestedFightId === 'number') normalized.requestedFightId = parsed.requestedFightId;

  return normalized;
};

const retailAdapter = (raw: unknown, parsed: ParsedReportUrl): NormalizedReport =>
  normalizeReportFromPayload(raw, parsed);
const mopClassicAdapter = (raw: unknown, parsed: ParsedReportUrl): NormalizedReport =>
  normalizeReportFromPayload(raw, parsed);

const selectAdapter = (
  parsed: ParsedReportUrl,
): ((raw: unknown, url: ParsedReportUrl) => NormalizedReport) => {
  if (parsed.host.includes('classic')) return mopClassicAdapter;
  if (parsed.rawUrl.toLowerCase().includes('/classic/')) return mopClassicAdapter;
  if (parsed.gameFamilyHint === 'mop_classic') return mopClassicAdapter;
  return retailAdapter;
};

export class WclClient implements PreviousRaidLookup {
  private token: string | null = null;
  private readonly gqlClient: GraphQLClient;

  public constructor(private readonly options: WclClientOptions) {
    this.gqlClient = options.fetchImpl
      ? new GraphQLClient(options.apiBaseUrl, { fetch: options.fetchImpl })
      : new GraphQLClient(options.apiBaseUrl);
  }

  private async getAccessToken(): Promise<string> {
    if (this.token) return this.token;
    const auth = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64');
    const response = await fetch('https://www.warcraftlogs.com/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new Error(`WCL OAuth failed: ${response.status}`);
    const payload = (await response.json()) as { access_token: string };
    this.token = payload.access_token;
    return payload.access_token;
  }

  public async fetchAndNormalizeReport(url: string, guildId?: string): Promise<NormalizedReport> {
    const parsed = parseReportUrl(url);
    const cached = await ReportCacheModel.findOne({ reportCode: parsed.reportCode }).lean();
    if (cached) {
      return cached.normalizedPayload as NormalizedReport;
    }

    let rawPayload: unknown;
    if (process.env.WCL_USE_FIXTURES === 'true') {
      rawPayload = fixture;
    } else {
      const token = await this.getAccessToken();
      this.gqlClient.setHeader('Authorization', `Bearer ${token}`);
      rawPayload = await this.gqlClient.request(REPORT_QUERY, { code: parsed.reportCode });
    }

    const adapter = selectAdapter(parsed);
    const normalized = adapter(rawPayload, parsed);

    await ReportCacheModel.create({
      reportCode: parsed.reportCode,
      sourceUrl: url,
      gameFamily: normalized.gameFamily,
      rawPayload,
      normalizedPayload: normalized,
      fetchedAt: new Date(),
    });

    if (guildId) {
      await this.persistRaidSnapshot(guildId, normalized);
    }

    return normalized;
  }

  private async persistRaidSnapshot(guildId: string, report: NormalizedReport): Promise<void> {
    const snapshot = await RaidSnapshotModel.findOneAndUpdate(
      { guildId, reportCode: report.reportCode },
      {
        $set: {
          title: report.title,
          zoneName: report.zoneName,
          gameFamily: report.gameFamily,
          startedAt: new Date(report.startTime),
          endedAt: new Date(report.endTime),
        },
        $setOnInsert: {
          guildId,
          reportCode: report.reportCode,
        },
      },
      { new: true, upsert: true },
    );

    await FightSnapshotModel.deleteMany({ raidSnapshotId: snapshot._id });
    if (report.fights.length > 0) {
      await FightSnapshotModel.insertMany(
        report.fights.map((fight) => ({
          raidSnapshotId: snapshot._id,
          fightId: fight.id,
          name: fight.name,
          kill: fight.kill,
          startedAt: new Date(fight.startTime),
          endedAt: new Date(fight.endTime),
        })),
      );
    }

    await PlayerRaidSummaryModel.deleteMany({ raidSnapshotId: snapshot._id });
    if (report.players.length > 0) {
      await PlayerRaidSummaryModel.insertMany(
        report.players.map((player) => ({
          raidSnapshotId: snapshot._id,
          characterName: player.name,
          bestParse: player.performance.bestSingleBossParse,
          averageParse: player.performance.averageParseAcrossKills,
          executionScore: player.execution.executionScore,
        })),
      );
    }
  }

  public async findPreviousRaidSummaries(
    guildId: string,
    beforeDate: Date,
    gameFamily?: GameFamily,
  ): Promise<NormalizedPlayer[]> {
    const query: Record<string, unknown> = { guildId, startedAt: { $lt: beforeDate } };
    if (gameFamily) query.gameFamily = gameFamily;

    const previousRaid = await RaidSnapshotModel.findOne(query).sort({ startedAt: -1 }).lean();
    if (!previousRaid?._id) return [];

    const rows = await PlayerRaidSummaryModel.find({ raidSnapshotId: previousRaid._id }).lean();
    return toNormalizedPlayersFromRaidSummary(
      rows.map((row) => ({
        characterName: row.characterName ?? undefined,
        bestParse: row.bestParse ?? undefined,
        averageParse: row.averageParse ?? undefined,
        executionScore: row.executionScore ?? undefined,
      })),
    );
  }
}

export { retailAdapter, mopClassicAdapter, selectAdapter, normalizeReportFromPayload as normalizeReport };
