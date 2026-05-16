export type { ParsedReportUrl } from './report-code.js';
export { normalizeReportUrlInput, parseReportUrl } from './report-code.js';

export { createWclClient, WclClient } from './wcl-client.js';
export type {
  WclAuthContextOptions,
  WclClientOptions,
  WclLinkedUserAuthRecord,
  WclLinkedUserAuthStore,
} from './wcl-client.js';

export { collectGuildReportIndex } from './collectors/guild-report-index-collector.js';
export type {
  GuildReportIndexInput,
  GuildReportIndexResult,
  GuildReportIndexRow,
} from './collectors/guild-report-index-collector.js';

export {
  collectReportRankingEnrichment,
  getReportRankingEnrichmentQueryHashes,
} from './collectors/report-ranking-enrichment-collector.js';
export type {
  ReportRankingEnrichmentCompareMode,
  ReportRankingEnrichmentContext,
  ReportRankingEnrichmentFight,
  ReportRankingEnrichmentInput,
  ReportRankingEnrichmentResult,
  ReportRankingEnrichmentTimeframe,
  ReportRankingFact,
  ReportRankingRawPayload,
} from './collectors/report-ranking-enrichment-collector.js';

export type {
  GuildRankInput,
  GuildRankTrendReader,
  GuildRankTrendScope,
  GuildRankWeeklyTrendRow,
} from './pipeline/types.js';
export { selectGuildRankCandidateReports } from './pipeline/guildrank-candidate-selector.js';
export type {
  GuildRankLiveReportIndexFetcher,
  GuildRankReportCandidate,
  GuildRankReportCandidateSource,
  GuildRankReportMetadataReader,
  GuildRankReportMetadataRow,
  SelectGuildRankCandidateReportsInput,
} from './pipeline/guildrank-candidate-selector.js';
export { getReportIndexCacheExpiresAt } from './report-index-cache.js';
export type {
  ReportIndexCacheKey,
  ReportIndexCacheReadResult,
  ReportIndexCacheStore,
} from './report-index-cache.js';

export {
  deriveWclUserApiBaseUrl,
  publicClientAuthMode,
  resolveWclGraphqlApiBaseUrl,
  resolveWclPublicClientAuth,
  userLinkedAuthMode,
} from './auth-mode.js';
export type {
  PublicClientWclAuthMode,
  UserLinkedWclAuthMode,
  WclAuthMode,
  WclAuthModeKind,
  WclPublicClientAuth,
} from './auth-mode.js';

export {
  classifyWclReportFetchError,
  shouldRetryWithUserLinkedAuth,
  toWclReportFetchError,
  WclReportFetchError,
} from './report-errors.js';
export type { WclReportFetchFailureCategory } from './report-errors.js';

export {
  exchangeWclAuthorizationCode,
  getWclTokenExpiresAt,
  parseWclAuthorizationCodeTokenPayload,
  resolveWclClientCredentialsToken,
  resolveWclPublicClientBearerToken,
} from './oauth.js';
export type {
  ExchangeWclAuthorizationCodeOptions,
  WclAuthorizationCodeTokenPayload,
} from './oauth.js';
