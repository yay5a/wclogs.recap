import type {
    AutoRecapMode,
    ClaimStatus,
    CompareAccessMode,
    CompareMode,
    GameFamily,
} from "../api.js";

export const compareModes: CompareMode[] = ["character", "mixed"];
export const compareAccessModes: CompareAccessMode[] = [
    "officer_only",
    "owner_or_officer",
    "owner_opt_in_or_officer",
    "owner_only",
];
export const autoRecapModes: AutoRecapMode[] = ["off", "prompt", "auto_preview", "auto_post"];
export const gameFamilies: GameFamily[] = ["retail", "mop_classic"];
export const tabs = ["overview", "settings", "officers", "claims", "activity"] as const;
export const claimStatuses: ClaimStatus[] = ["pending", "approved", "revoked"];
export const revokeReasons = [
    ["player_left_guild", "Player left guild"],
    ["character_inactive", "Character inactive"],
    ["duplicate_wrong_character", "Duplicate / wrong character"],
    ["requested_by_player", "Requested by player"],
    ["other", "Other"],
] as const;
export const onboardingSteps = [
    "bot-in-guild",
    "game-family",
    "recap-channel",
    "auto-recap",
    "compare-privacy",
    "raid-officers",
    "officer-dashboard-access",
    "test-log-url",
    "pending-claims",
];

export type Tab = (typeof tabs)[number];
export type ClaimAction = "approve" | "reject" | "revoke";

export const claimActionPastTense: Record<ClaimAction, string> = {
    approve: "approved",
    reject: "rejected",
    revoke: "revoked",
};
