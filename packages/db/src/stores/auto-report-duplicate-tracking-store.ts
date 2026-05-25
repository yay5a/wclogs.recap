import type { AutoReportMode, GameFamily } from '@wcl/domain';
import { AutoReportDuplicateTrackingModel } from '../models/auto-report-duplicate-tracking-model.js';

export type AutoReportDuplicateStatus =
  | 'processing'
  | 'prompted'
  | 'preview_posted'
  | 'final_posted'
  | 'ignored'
  | 'failed';

export type AutoReportLatestOutputKind =
  | 'prompt'
  | 'public_preview'
  | 'public_final_report'
  | 'duplicate_confirmation'
  | 'public_failure';

export interface AutoReportDuplicateTrackingRecord {
  guildId: string;
  channelId: string;
  reportCode: string;
  gameFamily: GameFamily;
  sourceUrl: string;
  sourceMessageId: string;
  sourceAuthorId: string;
  mode: Exclude<AutoReportMode, 'off'>;
  status: AutoReportDuplicateStatus;
  latestOutputMessageId?: string;
  latestOutputKind?: AutoReportLatestOutputKind;
  duplicateConfirmationMessageId?: string;
  confirmationNonce?: string;
  expiresAt: Date;
}

type ClaimAutoReportDuplicateInput = Omit<
  AutoReportDuplicateTrackingRecord,
  | 'status'
  | 'latestOutputMessageId'
  | 'latestOutputKind'
  | 'duplicateConfirmationMessageId'
  | 'confirmationNonce'
>;

type UpdateAutoReportDuplicateInput = Pick<
  AutoReportDuplicateTrackingRecord,
  'guildId' | 'channelId' | 'reportCode'
> &
  Partial<
    Pick<
      AutoReportDuplicateTrackingRecord,
      | 'sourceUrl'
      | 'gameFamily'
      | 'sourceMessageId'
      | 'sourceAuthorId'
      | 'mode'
      | 'status'
      | 'latestOutputMessageId'
      | 'latestOutputKind'
      | 'duplicateConfirmationMessageId'
      | 'confirmationNonce'
      | 'expiresAt'
    >
  >;

const isGameFamily = (value: unknown): value is GameFamily =>
  value === 'retail' || value === 'mop_classic';
const isMode = (value: unknown): value is Exclude<AutoReportMode, 'off'> =>
  value === 'prompt' || value === 'auto_preview' || value === 'auto_post';
const isStatus = (value: unknown): value is AutoReportDuplicateStatus =>
  value === 'processing' ||
  value === 'prompted' ||
  value === 'preview_posted' ||
  value === 'final_posted' ||
  value === 'ignored' ||
  value === 'failed';
const isOutputKind = (value: unknown): value is AutoReportLatestOutputKind =>
  value === 'prompt' ||
  value === 'public_preview' ||
  value === 'public_final_report' ||
  value === 'duplicate_confirmation' ||
  value === 'public_failure';

const toDuplicateTrackingRecord = (doc: unknown): AutoReportDuplicateTrackingRecord | null => {
  if (!doc || typeof doc !== 'object') return null;
  const raw = doc as Record<string, unknown>;
  if (
    typeof raw.guildId !== 'string' ||
    typeof raw.channelId !== 'string' ||
    typeof raw.reportCode !== 'string' ||
    !isGameFamily(raw.gameFamily) ||
    typeof raw.sourceUrl !== 'string' ||
    typeof raw.sourceMessageId !== 'string' ||
    typeof raw.sourceAuthorId !== 'string' ||
    !isMode(raw.mode) ||
    !isStatus(raw.status) ||
    !(raw.expiresAt instanceof Date)
  ) {
    return null;
  }

  const record: AutoReportDuplicateTrackingRecord = {
    guildId: raw.guildId,
    channelId: raw.channelId,
    reportCode: raw.reportCode,
    gameFamily: raw.gameFamily,
    sourceUrl: raw.sourceUrl,
    sourceMessageId: raw.sourceMessageId,
    sourceAuthorId: raw.sourceAuthorId,
    mode: raw.mode,
    status: raw.status,
    expiresAt: raw.expiresAt,
  };
  if (typeof raw.latestOutputMessageId === 'string') {
    record.latestOutputMessageId = raw.latestOutputMessageId;
  }
  if (isOutputKind(raw.latestOutputKind)) {
    record.latestOutputKind = raw.latestOutputKind;
  }
  if (typeof raw.duplicateConfirmationMessageId === 'string') {
    record.duplicateConfirmationMessageId = raw.duplicateConfirmationMessageId;
  }
  if (typeof raw.confirmationNonce === 'string') {
    record.confirmationNonce = raw.confirmationNonce;
  }
  return record;
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: unknown }).code === 11000 ||
    (error as { cause?: { code?: unknown } }).cause?.code === 11000);

export class MongoAutoReportDuplicateTrackingStore {
  public async claimPassiveDetection(
    input: ClaimAutoReportDuplicateInput,
  ): Promise<
    | { claimed: true; record: AutoReportDuplicateTrackingRecord }
    | { claimed: false; record: AutoReportDuplicateTrackingRecord | null }
  > {
    const now = new Date();
    const claimUpdate = {
      ...input,
      status: 'processing' as const,
    };

    const reclaimedExpired = await AutoReportDuplicateTrackingModel.findOneAndUpdate(
      {
        guildId: input.guildId,
        channelId: input.channelId,
        reportCode: input.reportCode,
        expiresAt: { $lte: now },
      },
      {
        $set: claimUpdate,
        $unset: {
          latestOutputMessageId: '',
          latestOutputKind: '',
          duplicateConfirmationMessageId: '',
          confirmationNonce: '',
        },
      },
      { returnDocument: 'after' },
    ).lean();
    const parsedReclaimed = toDuplicateTrackingRecord(reclaimedExpired);
    if (parsedReclaimed) return { claimed: true, record: parsedReclaimed };

    try {
      const created = await AutoReportDuplicateTrackingModel.create(claimUpdate);
      const parsedCreated = toDuplicateTrackingRecord(
        typeof created.toObject === 'function' ? created.toObject() : created,
      );
      if (!parsedCreated) {
        throw new Error('Failed to create auto report duplicate tracking record.');
      }
      return { claimed: true, record: parsedCreated };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const existing = await this.getActiveTracking({
        guildId: input.guildId,
        channelId: input.channelId,
        reportCode: input.reportCode,
      });
      if (existing) return { claimed: false, record: existing };

      const reclaimedStale = await AutoReportDuplicateTrackingModel.findOneAndUpdate(
        {
          guildId: input.guildId,
          channelId: input.channelId,
          reportCode: input.reportCode,
        },
        {
          $set: claimUpdate,
          $unset: {
            latestOutputMessageId: '',
            latestOutputKind: '',
            duplicateConfirmationMessageId: '',
            confirmationNonce: '',
          },
        },
        { returnDocument: 'after' },
      ).lean();
      const parsedReclaimedStale = toDuplicateTrackingRecord(reclaimedStale);
      return parsedReclaimedStale
        ? { claimed: true, record: parsedReclaimedStale }
        : { claimed: false, record: null };
    }
  }

  public async getActiveTracking(input: {
    guildId: string;
    channelId: string;
    reportCode: string;
  }): Promise<AutoReportDuplicateTrackingRecord | null> {
    const found = await AutoReportDuplicateTrackingModel.findOne({
      guildId: input.guildId,
      channelId: input.channelId,
      reportCode: input.reportCode,
      expiresAt: { $gt: new Date() },
    }).lean();
    return toDuplicateTrackingRecord(found);
  }

  public async getByConfirmationNonce(
    confirmationNonce: string,
  ): Promise<AutoReportDuplicateTrackingRecord | null> {
    const found = await AutoReportDuplicateTrackingModel.findOne({
      confirmationNonce,
      expiresAt: { $gt: new Date() },
    }).lean();
    return toDuplicateTrackingRecord(found);
  }

  public async updateTracking(
    input: UpdateAutoReportDuplicateInput,
  ): Promise<AutoReportDuplicateTrackingRecord | null> {
    const { guildId, channelId, reportCode, ...update } = input;
    const saved = await AutoReportDuplicateTrackingModel.findOneAndUpdate(
      { guildId, channelId, reportCode },
      { $set: update },
      { returnDocument: 'after' },
    ).lean();
    return toDuplicateTrackingRecord(saved);
  }
}
