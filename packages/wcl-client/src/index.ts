export type {
  ReportCacheRecord,
  ReportCacheStore,
  ReportCacheWriteEntry,
} from './report-cache-store.js';

export type { ParsedReportUrl } from './report-code.js';
export { normalizeReportUrlInput, parseReportUrl } from './report-code.js';

export {
  normalizeEnrichedReport,
  normalizeReport,
  retailAdapter,
  mopClassicAdapter,
} from './normalize-report.js';

export { createWclClient, WclClient } from './wcl-client.js';
export type {
  FetchAndNormalizeReportOptions,
  WclClientOptions,
  WclLinkedUserAuthRecord,
  WclLinkedUserAuthStore,
} from './wcl-client.js';

export {
  deriveWclUserApiBaseUrl,
  publicClientAuthMode,
  resolveWclGraphqlApiBaseUrl,
  userLinkedAuthMode,
} from './auth-mode.js';
export type {
  PublicClientWclAuthMode,
  UserLinkedWclAuthMode,
  WclAuthMode,
  WclAuthModeKind,
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
  resolveWclAccessToken,
} from './oauth.js';
export type {
  ExchangeWclAuthorizationCodeOptions,
  WclAuthorizationCodeTokenPayload,
} from './oauth.js';
