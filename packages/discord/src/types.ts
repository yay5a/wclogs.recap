import type {
    ComparisonSnapshotInput,
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

export interface ComparisonHistoryStore {
    saveComparisonSnapshot(input: ComparisonSnapshotInput): Promise<unknown>;
    findCharacterHistory(input: {
        guildId: string;
        participantKey: string;
        before: Date;
        limit?: number;
    }): Promise<ComparisonSnapshotInput[]>;
}

export interface HandleOptions {
    wclClient: WclClient & Partial<PreviousRaidLookup>;
    guildConfigStore: GuildConfigStore;
    recapPreviewStateService: RecapPreviewStateService;
    comparisonHistoryStore?: ComparisonHistoryStore;
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
    member?: { user?: { id?: string } };
    user?: { id?: string };
    data?: DiscordInteractionData;
}
