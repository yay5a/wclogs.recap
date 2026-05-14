import type { GuildRankSummary, ReportSummary } from '@wcl/domain';
import { WclGraphqlClient } from './graphql-client.js';
import { parseReportUrl } from './report-code.js';
import { publicClientAuthMode, userLinkedAuthMode, type WclAuthMode } from './auth-mode.js';
import {
  shouldRetryWithUserLinkedAuth,
  toWclReportFetchError,
  WclReportFetchError,
} from './report-errors.js';
import { collectReportSummaryData } from './pipeline/report-pipeline.js';
import { collectGuildRankSummaryData } from './pipeline/guildrank-pipeline.js';
import type { GuildRankInput } from './pipeline/types.js';

export interface WclLinkedUserAuthRecord {
  discordUserId: string;
  accessToken?: string;
  expiresAt?: Date | string;
}

export interface WclLinkedUserAuthStore {
  getByDiscordUserId(discordUserId: string): Promise<WclLinkedUserAuthRecord | null>;
}

export interface WclClientOptions {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  userApiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  wclUserAuthStore?: WclLinkedUserAuthStore;
}

export interface WclAuthContextOptions {
  discordUserId?: string;
}

export class WclClient {
  public constructor(private readonly options: WclClientOptions) {}

  public async fetchReportSummary(
    url: string,
    options: WclAuthContextOptions = {},
  ): Promise<ReportSummary> {
    const parsed = parseReportUrl(url);
    return this.withAuthFallback(parsed.reportCode, options, (authMode) =>
      collectReportSummaryData(this.createGraphqlClient(authMode), {
        sourceUrl: url,
        reportCode: parsed.reportCode,
        gameFamily: parsed.gameFamily,
      }),
    );
  }

  public async fetchGuildRankSummary(
    input: GuildRankInput,
    options: WclAuthContextOptions = {},
  ): Promise<GuildRankSummary> {
    return this.withAuthFallback(`guildrank:${input.guildName}`, options, (authMode) =>
      collectGuildRankSummaryData(this.createGraphqlClient(authMode), input, {
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      }),
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
      if (!linkedAuth?.accessToken) {
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

      try {
        return await operation(
          userLinkedAuthMode(options.discordUserId, linkedAuth.accessToken),
        );
      } catch (userError) {
        throw toWclReportFetchError(userError, {
          reportCode: referenceCode,
          authMode: 'userLinked',
        });
      }
    }
  }

  private createGraphqlClient(authMode: WclAuthMode): WclGraphqlClient {
    return new WclGraphqlClient({
      clientId: this.options.clientId,
      clientSecret: this.options.clientSecret,
      apiBaseUrl: this.options.apiBaseUrl,
      ...(this.options.userApiBaseUrl ? { userApiBaseUrl: this.options.userApiBaseUrl } : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      authMode,
    });
  }
}

export const createWclClient = (options: WclClientOptions): WclClient =>
  new WclClient(options);

const isExpired = (expiresAt: Date | string | undefined): boolean => {
  if (!expiresAt) return false;
  const expiresAtMs =
    expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
};
