import type { GameFamily, GuildRankSummary, ReportIndexData, ReportSummary } from '@wcl/domain';
import { WclGraphqlClient } from './graphql-client.js';
import { parseReportUrl } from './report-code.js';
import {
  publicClientAuthMode,
  userLinkedAuthMode,
  type WclAuthMode,
  type WclPublicClientAuth,
} from './auth-mode.js';
import {
  shouldRetryWithUserLinkedAuth,
  toWclReportFetchError,
  WclReportFetchError,
} from './report-errors.js';
import { collectReportSummaryData } from './pipeline/report-pipeline.js';
import { collectGuildRankSummaryData } from './pipeline/guildrank-pipeline.js';
import type { GuildRankInput, GuildRankTrendReader } from './pipeline/types.js';
import type { GuildRankReportMetadataReader } from './pipeline/guildrank-candidate-selector.js';
import { collectZoneName } from './collectors/zone-name-collector.js';
import { collectReportIndex } from './collectors/report-index-collector.js';
import {
  collectGuildReportIndex,
  type GuildReportIndexInput,
  type GuildReportIndexResult,
} from './collectors/guild-report-index-collector.js';
import {
  collectReportRankingEnrichment,
  type ReportRankingEnrichmentInput,
  type ReportRankingEnrichmentResult,
} from './collectors/report-ranking-enrichment-collector.js';
import type { ReportIndexCacheStore } from './report-index-cache.js';

export interface WclLinkedUserAuthRecord {
  discordUserId: string;
  userAccessToken?: string;
  expiresAt?: Date | string;
}

export interface WclLinkedUserAuthStore {
  getByDiscordUserId(discordUserId: string): Promise<WclLinkedUserAuthRecord | null>;
}

export interface WclClientOptions {
  publicClientAuth: WclPublicClientAuth;
  apiBaseUrl: string;
  userApiBaseUrl?: string;
  v1ClientKey?: string;
  fetchImpl?: typeof fetch;
  wclUserAuthStore?: WclLinkedUserAuthStore;
  reportIndexCacheStore?: ReportIndexCacheStore;
  guildReportMetadataStore?: GuildRankReportMetadataReader;
  guildRankTrendReader?: GuildRankTrendReader;
}

export interface WclAuthContextOptions {
  discordUserId?: string;
}

const toGameFamilyApiBaseUrl = (apiBaseUrl: string, gameFamily?: GameFamily): string => {
  if (gameFamily !== 'mop_classic') return apiBaseUrl;
  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname === 'www.warcraftlogs.com') {
      url.hostname = 'classic.warcraftlogs.com';
      return url.toString();
    }
  } catch {
    return apiBaseUrl;
  }
  return apiBaseUrl;
};

export class WclClient {
  public constructor(private readonly options: WclClientOptions) {}

  public async fetchReportSummary(
    url: string,
    options: WclAuthContextOptions = {},
  ): Promise<ReportSummary> {
    const parsed = parseReportUrl(url);
    return this.withAuthFallback(parsed.reportCode, options, (authMode) =>
      collectReportSummaryData(
        this.createGraphqlClient(authMode),
        {
          sourceUrl: parsed.rawUrl,
          reportCode: parsed.reportCode,
          gameFamily: parsed.gameFamily,
        },
        {
          ...(this.options.reportIndexCacheStore
            ? { reportIndexCacheStore: this.options.reportIndexCacheStore }
            : {}),
        },
      ),
    );
  }

  public async fetchGuildRankSummary(
    input: GuildRankInput,
    options: WclAuthContextOptions = {},
  ): Promise<GuildRankSummary> {
    return this.withUserAuthPreferredFallback(`guildrank:${input.guildName}`, options, (authMode) =>
      collectGuildRankSummaryData(this.createGraphqlClient(authMode, input.gameFamily), input, {
        ...(this.options.guildReportMetadataStore
          ? { metadataReader: this.options.guildReportMetadataStore }
          : {}),
        ...(this.options.guildRankTrendReader
          ? { trendReader: this.options.guildRankTrendReader }
          : {}),
        liveReportIndexFetcher: async (fetchInput) => {
          const result = await this.fetchGuildReportIndex({
            guildName: fetchInput.guildName,
            guildServerSlug: fetchInput.guildServerSlug,
            guildServerRegion: fetchInput.guildServerRegion,
            gameFamily: fetchInput.gameFamily,
            startTimeMs: fetchInput.startTimeMs,
            endTimeMs: fetchInput.endTimeMs,
          });
          return result.rows.map((row) => ({
            reportCode: row.code,
            ...(row.title ? { title: row.title } : {}),
            ...(row.owner ? { owner: row.owner } : {}),
            ...(typeof row.zoneId === 'number' ? { zoneId: row.zoneId } : {}),
            startTime: row.startTime,
            ...(typeof row.endTime === 'number' ? { endTime: row.endTime } : {}),
          }));
        },
      }),
    );
  }

  public async resolveZoneName(
    zoneId: number,
    options: WclAuthContextOptions = {},
  ): Promise<string | undefined> {
    if (!Number.isFinite(zoneId)) return undefined;
    return this.withAuthFallback(`zone:${zoneId}`, options, (authMode) =>
      collectZoneName(this.createGraphqlClient(authMode), Math.trunc(zoneId)),
    );
  }

  public async fetchReportIndex(
    input: { reportCode: string; sourceUrl: string; gameFamily: GameFamily },
    options: WclAuthContextOptions = {},
  ): Promise<ReportIndexData> {
    return this.withAuthFallback(input.reportCode, options, (authMode) =>
      collectReportIndex(this.createGraphqlClient(authMode, input.gameFamily), input),
    );
  }

  public async fetchGuildReportIndex(
    input: GuildReportIndexInput,
  ): Promise<GuildReportIndexResult> {
    const v1ClientKey = this.options.v1ClientKey?.trim();
    if (!v1ClientKey) {
      throw new Error('fetchGuildReportIndex requires WCL_V1_CLIENT_KEY');
    }

    return collectGuildReportIndex({
      ...input,
      v1ClientKey,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
    });
  }

  public async fetchReportRankingEnrichment(
    input: ReportRankingEnrichmentInput,
    options: WclAuthContextOptions = {},
  ): Promise<ReportRankingEnrichmentResult> {
    return this.withAuthFallback(input.reportCode, options, (authMode) =>
      collectReportRankingEnrichment(this.createGraphqlClient(authMode, input.gameFamily), input),
    );
  }

  private async withAuthFallback<T>(
    referenceCode: string,
    options: WclAuthContextOptions,
    operation: (authMode: WclAuthMode) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(publicClientAuthMode());
    } catch (error) {
      const publicError = toWclReportFetchError(error, {
        reportCode: referenceCode,
        authMode: 'publicClient',
      });

      if (!options.discordUserId || !shouldRetryWithUserLinkedAuth(publicError)) {
        throw publicError;
      }

      const linkedAuthMode = await this.getUserLinkedAuthMode(referenceCode, options);

      try {
        return await operation(linkedAuthMode);
      } catch (userError) {
        throw toWclReportFetchError(userError, {
          reportCode: referenceCode,
          authMode: 'userLinked',
        });
      }
    }
  }

  private async withUserAuthPreferredFallback<T>(
    referenceCode: string,
    options: WclAuthContextOptions,
    operation: (authMode: WclAuthMode) => Promise<T>,
  ): Promise<T> {
    try {
      const linkedAuthMode = await this.getUserLinkedAuthMode(referenceCode, options);
      try {
        return await operation(linkedAuthMode);
      } catch {
        // The guild ranking path can use user-scoped WCL data when available,
        // but public client data remains the safe fallback for public rankings.
      }
    } catch {
      // No usable linked token; fall back to the public client endpoint.
    }

    try {
      return await operation(publicClientAuthMode());
    } catch (error) {
      throw toWclReportFetchError(error, {
        reportCode: referenceCode,
        authMode: 'publicClient',
      });
    }
  }

  private async getUserLinkedAuthMode(
    referenceCode: string,
    options: WclAuthContextOptions,
  ): Promise<WclAuthMode> {
    if (!options.discordUserId) {
      throw new WclReportFetchError({
        category: 'missing_linked_auth',
        reportCode: referenceCode,
        authMode: 'userLinked',
      });
    }

    let linkedAuth: WclLinkedUserAuthRecord | null | undefined;
    try {
      linkedAuth = await this.options.wclUserAuthStore?.getByDiscordUserId(options.discordUserId);
    } catch (linkedAuthError) {
      throw new WclReportFetchError({
        category: 'linked_auth_unreadable',
        reportCode: referenceCode,
        authMode: 'userLinked',
        cause: linkedAuthError,
      });
    }
    if (!linkedAuth?.userAccessToken) {
      throw new WclReportFetchError({
        category: 'missing_linked_auth',
        reportCode: referenceCode,
        authMode: 'userLinked',
      });
    }

    if (isExpired(linkedAuth.expiresAt)) {
      throw new WclReportFetchError({
        category: 'expired_linked_auth',
        reportCode: referenceCode,
        authMode: 'userLinked',
      });
    }

    return userLinkedAuthMode(options.discordUserId, linkedAuth.userAccessToken);
  }

  private createGraphqlClient(authMode: WclAuthMode, gameFamily?: GameFamily): WclGraphqlClient {
    const apiBaseUrl = toGameFamilyApiBaseUrl(this.options.apiBaseUrl, gameFamily);
    return new WclGraphqlClient({
      publicClientAuth: this.options.publicClientAuth,
      apiBaseUrl,
      ...(this.options.userApiBaseUrl
        ? { userApiBaseUrl: toGameFamilyApiBaseUrl(this.options.userApiBaseUrl, gameFamily) }
        : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      authMode,
    });
  }
}

export const createWclClient = (options: WclClientOptions): WclClient => new WclClient(options);

const isExpired = (expiresAt: Date | string | undefined): boolean => {
  if (!expiresAt) return false;
  const expiresAtMs =
    expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
};
