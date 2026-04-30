import type { AutoRecapMode, GameFamily } from "@wcl/domain";
import { AutoRecapDuplicateTrackingModel } from "../index.js";

export type AutoRecapDuplicateStatus =
    | "processing"
    | "prompted"
    | "preview_posted"
    | "final_posted"
    | "ignored"
    | "failed";

export type AutoRecapLatestOutputKind =
    | "prompt"
    | "public_preview"
    | "public_final_recap"
    | "duplicate_confirmation"
    | "public_failure";

export interface AutoRecapDuplicateTrackingRecord {
    guildId: string;
    channelId: string;
    reportCode: string;
    gameFamily: GameFamily;
    sourceUrl: string;
    sourceMessageId: string;
    sourceAuthorId: string;
    mode: Exclude<AutoRecapMode, "off">;
    status: AutoRecapDuplicateStatus;
    latestOutputMessageId?: string;
    latestOutputKind?: AutoRecapLatestOutputKind;
    duplicateConfirmationMessageId?: string;
    confirmationNonce?: string;
    expiresAt: Date;
}

type ClaimAutoRecapDuplicateInput = Omit<
    AutoRecapDuplicateTrackingRecord,
    | "status"
    | "latestOutputMessageId"
    | "latestOutputKind"
    | "duplicateConfirmationMessageId"
    | "confirmationNonce"
>;

type UpdateAutoRecapDuplicateInput = Pick<
    AutoRecapDuplicateTrackingRecord,
    "guildId" | "channelId" | "reportCode"
> &
    Partial<
        Pick<
            AutoRecapDuplicateTrackingRecord,
            | "sourceUrl"
            | "gameFamily"
            | "sourceMessageId"
            | "sourceAuthorId"
            | "mode"
            | "status"
            | "latestOutputMessageId"
            | "latestOutputKind"
            | "duplicateConfirmationMessageId"
            | "confirmationNonce"
            | "expiresAt"
        >
    >;

const isGameFamily = (value: unknown): value is GameFamily =>
    value === "retail" || value === "mop_classic";
const isMode = (value: unknown): value is Exclude<AutoRecapMode, "off"> =>
    value === "prompt" || value === "auto_preview" || value === "auto_post";
const isStatus = (value: unknown): value is AutoRecapDuplicateStatus =>
    value === "processing" ||
    value === "prompted" ||
    value === "preview_posted" ||
    value === "final_posted" ||
    value === "ignored" ||
    value === "failed";
const isOutputKind = (value: unknown): value is AutoRecapLatestOutputKind =>
    value === "prompt" ||
    value === "public_preview" ||
    value === "public_final_recap" ||
    value === "duplicate_confirmation" ||
    value === "public_failure";

const toDuplicateTrackingRecord = (
    doc: unknown,
): AutoRecapDuplicateTrackingRecord | null => {
    if (!doc || typeof doc !== "object") return null;
    const raw = doc as Record<string, unknown>;
    if (
        typeof raw.guildId !== "string" ||
        typeof raw.channelId !== "string" ||
        typeof raw.reportCode !== "string" ||
        !isGameFamily(raw.gameFamily) ||
        typeof raw.sourceUrl !== "string" ||
        typeof raw.sourceMessageId !== "string" ||
        typeof raw.sourceAuthorId !== "string" ||
        !isMode(raw.mode) ||
        !isStatus(raw.status) ||
        !(raw.expiresAt instanceof Date)
    ) {
        return null;
    }

    const record: AutoRecapDuplicateTrackingRecord = {
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
    if (typeof raw.latestOutputMessageId === "string") {
        record.latestOutputMessageId = raw.latestOutputMessageId;
    }
    if (isOutputKind(raw.latestOutputKind)) {
        record.latestOutputKind = raw.latestOutputKind;
    }
    if (typeof raw.duplicateConfirmationMessageId === "string") {
        record.duplicateConfirmationMessageId = raw.duplicateConfirmationMessageId;
    }
    if (typeof raw.confirmationNonce === "string") {
        record.confirmationNonce = raw.confirmationNonce;
    }
    return record;
};

const isDuplicateKeyError = (error: unknown): boolean =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000;

export class MongoAutoRecapDuplicateTrackingStore {
    public async claimPassiveDetection(
        input: ClaimAutoRecapDuplicateInput,
    ): Promise<
        | { claimed: true; record: AutoRecapDuplicateTrackingRecord }
        | { claimed: false; record: AutoRecapDuplicateTrackingRecord | null }
    > {
        const now = new Date();
        const claimUpdate = {
            ...input,
            status: "processing" as const,
        };

        const reclaimedExpired = await AutoRecapDuplicateTrackingModel.findOneAndUpdate(
            {
                guildId: input.guildId,
                channelId: input.channelId,
                reportCode: input.reportCode,
                expiresAt: { $lte: now },
            },
            {
                $set: claimUpdate,
                $unset: {
                    latestOutputMessageId: "",
                    latestOutputKind: "",
                    duplicateConfirmationMessageId: "",
                    confirmationNonce: "",
                },
            },
            { new: true },
        ).lean();
        const parsedReclaimed = toDuplicateTrackingRecord(reclaimedExpired);
        if (parsedReclaimed) return { claimed: true, record: parsedReclaimed };

        try {
            const created = await AutoRecapDuplicateTrackingModel.create(claimUpdate);
            const parsedCreated = toDuplicateTrackingRecord(
                typeof created.toObject === "function" ? created.toObject() : created,
            );
            if (!parsedCreated) {
                throw new Error("Failed to create auto recap duplicate tracking record.");
            }
            return { claimed: true, record: parsedCreated };
        } catch (error) {
            if (!isDuplicateKeyError(error)) throw error;
            const existing = await this.getActiveTracking({
                guildId: input.guildId,
                channelId: input.channelId,
                reportCode: input.reportCode,
            });
            return { claimed: false, record: existing };
        }
    }

    public async getActiveTracking(input: {
        guildId: string;
        channelId: string;
        reportCode: string;
    }): Promise<AutoRecapDuplicateTrackingRecord | null> {
        const found = await AutoRecapDuplicateTrackingModel.findOne({
            guildId: input.guildId,
            channelId: input.channelId,
            reportCode: input.reportCode,
            expiresAt: { $gt: new Date() },
        }).lean();
        return toDuplicateTrackingRecord(found);
    }

    public async getByConfirmationNonce(
        confirmationNonce: string,
    ): Promise<AutoRecapDuplicateTrackingRecord | null> {
        const found = await AutoRecapDuplicateTrackingModel.findOne({
            confirmationNonce,
            expiresAt: { $gt: new Date() },
        }).lean();
        return toDuplicateTrackingRecord(found);
    }

    public async updateTracking(
        input: UpdateAutoRecapDuplicateInput,
    ): Promise<AutoRecapDuplicateTrackingRecord | null> {
        const { guildId, channelId, reportCode, ...update } = input;
        const saved = await AutoRecapDuplicateTrackingModel.findOneAndUpdate(
            { guildId, channelId, reportCode },
            { $set: update },
            { new: true },
        ).lean();
        return toDuplicateTrackingRecord(saved);
    }
}
