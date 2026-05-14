import type {
    AutoReportMode,
    BotActivityStore,
    CharacterClaimStatus,
    GameFamily,
    GuildConfigStore,
} from "@wcl/domain";
import type { WclClient } from "@wcl/wcl-client";

export interface AutoReportPromptStateRecord {
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

export interface AutoReportPromptStateService {
    savePromptState(input: AutoReportPromptStateRecord): Promise<AutoReportPromptStateRecord>;
    getValidPromptState(sourceMessageId: string): Promise<AutoReportPromptStateRecord | null>;
    consumeValidPromptState(sourceMessageId: string): Promise<AutoReportPromptStateRecord | null>;
}

export type AutoReportDuplicateStatus =
    | "processing"
    | "prompted"
    | "preview_posted"
    | "final_posted"
    | "ignored"
    | "failed";

export type AutoReportLatestOutputKind =
    | "prompt"
    | "public_preview"
    | "public_final_report"
    | "duplicate_confirmation"
    | "public_failure";

export interface AutoReportDuplicateTrackingRecord {
    guildId: string;
    channelId: string;
    reportCode: string;
    gameFamily: GameFamily;
    sourceUrl: string;
    sourceMessageId: string;
    sourceAuthorId: string;
    mode: Exclude<AutoReportMode, "off">;
    status: AutoReportDuplicateStatus;
    latestOutputMessageId?: string;
    latestOutputKind?: AutoReportLatestOutputKind;
    duplicateConfirmationMessageId?: string;
    confirmationNonce?: string;
    expiresAt: Date;
}

export interface AutoReportDuplicateTrackingService {
    claimPassiveDetection(input: {
        guildId: string;
        channelId: string;
        reportCode: string;
        gameFamily: GameFamily;
        sourceUrl: string;
        sourceMessageId: string;
        sourceAuthorId: string;
        mode: Exclude<AutoReportMode, "off">;
        expiresAt: Date;
    }): Promise<
        | { claimed: true; record: AutoReportDuplicateTrackingRecord }
        | { claimed: false; record: AutoReportDuplicateTrackingRecord | null }
    >;
    getByConfirmationNonce?(
        confirmationNonce: string,
    ): Promise<AutoReportDuplicateTrackingRecord | null>;
    updateTracking(input: {
        guildId: string;
        channelId: string;
        reportCode: string;
        sourceUrl?: string;
        gameFamily?: GameFamily;
        sourceMessageId?: string;
        sourceAuthorId?: string;
        mode?: Exclude<AutoReportMode, "off">;
        status?: AutoReportDuplicateStatus;
        latestOutputMessageId?: string;
        latestOutputKind?: AutoReportLatestOutputKind;
        duplicateConfirmationMessageId?: string;
        confirmationNonce?: string;
        expiresAt?: Date;
    }): Promise<AutoReportDuplicateTrackingRecord | null>;
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
    wclClient: WclClient;
    guildConfigStore: GuildConfigStore;
    characterClaimStore?: CharacterClaimStore;
    botActivityStore?: BotActivityStore | undefined;
    autoReportPromptStateService?: AutoReportPromptStateService;
    autoReportDuplicateTrackingService?: AutoReportDuplicateTrackingService;
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
