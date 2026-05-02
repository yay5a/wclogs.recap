import type { ActivityEvent, CharacterClaim, Directory, ResolvedLabel } from "../api.js";

export const toChannelText = (config: { autoRecapChannelIds: string[] } | null): string =>
    config?.autoRecapChannelIds.join("\n") ?? "";

export const parseChannelText = (value: string): string[] =>
    value
        .split(/\s|,/)
        .map((entry) => entry.trim())
        .filter(Boolean);

export const formatDate = (value?: string): string => (value ? new Date(value).toLocaleString() : "-");

export const labelFor = (record: ResolvedLabel | undefined, fallback: string): string =>
    record?.label ?? fallback;

const copyId = (id: string) => {
    void navigator.clipboard?.writeText(id);
};

export const IdLabel = ({ record, id }: { record?: ResolvedLabel | undefined; id: string }) => (
    <span className={record?.resolved ? "id-label" : "id-label unresolved"}>
        {labelFor(record, id)}
        <button type="button" className="copy-id" title={`Copy ${id}`} onClick={() => copyId(id)}>
            ^
        </button>
    </span>
);

export const claimCharacter = (claim: CharacterClaim): string =>
    `${claim.characterName} - ${claim.realm}-${claim.region}`;

export const userLabelForClaim = (
    claim: CharacterClaim,
    directory: Directory | null,
): string => {
    const record = directory?.users[claim.discordUserId];
    return record?.resolved && record.label ? record.label : `Discord user ${claim.discordUserId}`;
};

export const actionText = (event: ActivityEvent): string => {
    switch (event.kind) {
        case "recap_preview_created":
            return "Recap preview created";
        case "recap_posted":
            return "Recap posted";
        case "private_comparison_rendered":
            return "Private comparison rendered";
        case "public_comparison_posted":
            return "Public comparison posted";
        case "claim_requested":
            return "Claim requested";
        case "claim_approved":
            return "Claim approved";
        case "claim_rejected":
            return "Claim rejected";
        case "claim_revoked":
            return "Claim revoked";
        case "config_updated":
            return "Config updated";
        case "officer_added":
            return "Officer added";
        case "officer_removed":
            return "Officer removed";
        default:
            return event.kind;
    }
};
