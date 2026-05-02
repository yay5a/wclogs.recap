import type {
    AutoRecapMode,
    BotActivityStore,
    CharacterClaimStatus,
    ComparisonSnapshotInput,
    GameFamily,
    GuildConfigStore,
    PreviousRaidLookup,
} from "@wcl/domain";
import type { buildRecapSummary } from "@wcl/domain";
import type { WclClient } from "@wcl/wcl-client";

export type RecapSummary = ReturnType<typeof buildRecapSummary>;
export type RecapPreviewSummary = RecapSummary;

export interface SavePreviewStateInput {
    guildId: string;
    channelId: string;
    reportCode: string;
    sourceUrl: string;
    summaryPayload: RecapPreviewSummary;
    createdByUserId: string;
    createdAt: Date;
    expiresAt: Date;
    interactionId?: string;
    messageId?: string;
}

export interface PreviewStateLookup {
    reportCode: string;
    guildId: string;
    channelId: string;
}

export type PreviewStateRecord = SavePreviewStateInput;

export interface RecapPreviewStateService {
    savePreviewState(input: SavePreviewStateInput): Promise<PreviewStateRecord>;
    getValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<PreviewStateRecord | null>;
    consumeValidPreviewState(
        lookup: PreviewStateLookup,
    ): Promise<PreviewStateRecord | null>;
    deletePreviewState(lookup: PreviewStateLookup): Promise<void>;
}

export interface AutoRecapPromptStateRecord {
    guildId: string;
    channelId: string;
    reportCode: string;
    gameFamily: GameFamily;
    sourceUrl: string;
    sourceMessageId: string;
    sourceAuthorId: string;
    promptMessageId: string;
    expiresAt: Date;
}

export interface AutoRecapPromptStateService {
    savePromptState(input: AutoRecapPromptStateRecord): Promise<AutoRecapPromptStateRecord>;
    getValidPromptState(sourceMessageId: string): Promise<AutoRecapPromptStateRecord | null>;
    consumeValidPromptState(sourceMessageId: string): Promise<AutoRecapPromptStateRecord | null>;
}

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

export interface AutoRecapDuplicateTrackingService {
    claimPassiveDetection(input: {
        guildId: string;
        channelId: string;
        reportCode: string;
        gameFamily: GameFamily;
        sourceUrl: string;
        sourceMessageId: string;
        sourceAuthorId: string;
        mode: Exclude<AutoRecapMode, "off">;
        expiresAt: Date;
    }): Promise<
        | { claimed: true; record: AutoRecapDuplicateTrackingRecord }
        | { claimed: false; record: AutoRecapDuplicateTrackingRecord | null }
    >;
    getByConfirmationNonce?(
        confirmationNonce: string,
    ): Promise<AutoRecapDuplicateTrackingRecord | null>;
    updateTracking(input: {
        guildId: string;
        channelId: string;
        reportCode: string;
        sourceUrl?: string;
        gameFamily?: GameFamily;
        sourceMessageId?: string;
        sourceAuthorId?: string;
        mode?: Exclude<AutoRecapMode, "off">;
        status?: AutoRecapDuplicateStatus;
        latestOutputMessageId?: string;
        latestOutputKind?: AutoRecapLatestOutputKind;
        duplicateConfirmationMessageId?: string;
        confirmationNonce?: string;
        expiresAt?: Date;
    }): Promise<AutoRecapDuplicateTrackingRecord | null>;
}

export interface ComparisonHistoryStore {
    saveComparisonSnapshot(input: ComparisonSnapshotInput): Promise<unknown>;
    findCharacterHistory(input: {
        guildId: string;
        participantKey: string;
        before: Date;
        limit?: number;
    }): Promise<ComparisonSnapshotInput[]>;
}

export interface CharacterClaimRecord {
    claimId: string;
    guildId: string;
    discordUserId: string;
    participantKey: string;
    characterName: string;
    region: string;
    realm: string;
    status: CharacterClaimStatus;
    peerCompareOptIn: boolean;
    publicPostOptIn: boolean;
    requestedAt: Date;
    reviewedAt?: Date;
    reviewedByDiscordUserId?: string;
    revokedAt?: Date;
    revokedByDiscordUserId?: string;
    revokeReason?: string;
}

export interface CharacterClaimStore {
    requestCharacterClaim(input: {
        guildId: string;
        discordUserId: string;
        participantKey: string;
        characterName: string;
        region: string;
        realm: string;
    }): Promise<CharacterClaimRecord>;
    approveCharacterClaim(input: {
        guildId: string;
        discordUserId: string;
        participantKey: string;
        characterName: string;
        region: string;
        realm: string;
        reviewedByDiscordUserId: string;
    }): Promise<CharacterClaimRecord | null>;
    rejectCharacterClaim(input: {
        guildId: string;
        discordUserId: string;
        participantKey: string;
        characterName: string;
        region: string;
        realm: string;
        reviewedByDiscordUserId: string;
    }): Promise<CharacterClaimRecord | null>;
    findApprovedClaimForUserCharacter(input: {
        guildId: string;
        discordUserId: string;
        participantKey: string;
    }): Promise<CharacterClaimRecord | null>;
    findApprovedClaimsForParticipant(input: {
        guildId: string;
        participantKey: string;
    }): Promise<CharacterClaimRecord[]>;
    updateClaimPrivacy(input: {
        guildId: string;
        discordUserId: string;
        participantKey: string;
        peerCompareOptIn?: boolean;
        publicPostOptIn?: boolean;
    }): Promise<CharacterClaimRecord | null>;
    listClaimsForUser(input: {
        guildId: string;
        discordUserId: string;
    }): Promise<CharacterClaimRecord[]>;
    listClaimsByStatus?(input: {
        guildId: string;
        status: CharacterClaimStatus;
    }): Promise<CharacterClaimRecord[]>;
    approveClaimById?(input: {
        guildId: string;
        claimId: string;
        reviewedByDiscordUserId?: string | undefined;
    }): Promise<CharacterClaimRecord | null>;
    rejectClaimById?(input: {
        guildId: string;
        claimId: string;
        reviewedByDiscordUserId?: string | undefined;
    }): Promise<CharacterClaimRecord | null>;
    revokeClaimById?(input: {
        guildId: string;
        claimId: string;
        revokedByDiscordUserId?: string | undefined;
        revokeReason?: string | undefined;
    }): Promise<CharacterClaimRecord | null>;
}

export interface HandleOptions {
    wclClient: WclClient & Partial<PreviousRaidLookup>;
    guildConfigStore: GuildConfigStore;
    recapPreviewStateService: RecapPreviewStateService;
    comparisonHistoryStore?: ComparisonHistoryStore;
    characterClaimStore?: CharacterClaimStore;
    botActivityStore?: BotActivityStore | undefined;
    autoRecapPromptStateService?: AutoRecapPromptStateService;
    autoRecapDuplicateTrackingService?: AutoRecapDuplicateTrackingService;
    previewStateTtlSeconds?: number;
    scheduleBackgroundTask?: (task: () => void) => void;
}

export interface DiscordInteractionData {
    name?: string;
    options?: unknown;
    custom_id?: string;
}

export interface DiscordInteraction {
    id?: string;
    application_id?: string;
    token?: string;
    type?: number;
    guild_id?: string;
    channel_id?: string;
    member?: { user?: { id?: string }; roles?: string[]; permissions?: string | number };
    user?: { id?: string };
    data?: DiscordInteractionData;
}
