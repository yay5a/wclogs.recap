import type { ReportSummary } from './report/types.js';

export type BotActivityKind =
  | 'report_preview_created'
  | 'report_posted'
  | 'private_comparison_rendered'
  | 'public_comparison_posted'
  | 'claim_requested'
  | 'claim_approved'
  | 'claim_rejected'
  | 'claim_revoked'
  | 'config_updated'
  | 'officer_added'
  | 'officer_removed';

export type ActivityActor =
  | { kind: 'discord'; discordUserId: string }
  | { kind: 'admin-secret' }
  | { kind: 'system' };

export interface BotActivityEvent {
  guildId: string;
  channelId?: string | undefined;
  sourceMessageId?: string | undefined;
  actor?: ActivityActor | undefined;
  kind: BotActivityKind;
  reportCode?: string | undefined;
  reportSummary?: ReportSummary | undefined;
  sourceUrl?: string | undefined;
  discordMessageUrl?: string | undefined;
  characterLabel?: string | undefined;
  targetDiscordUserId?: string | undefined;
  idempotencyKey?: string | undefined;
  createdAt: Date;
}

export interface BotActivityStore {
  recordActivity(event: BotActivityEvent): Promise<void>;
  findLatestReportSummary(input: {
    guildId: string;
    reportCode: string;
  }): Promise<ReportSummary | null>;
}
