import type { CharacterClaim, ClaimStatus, DashboardCapability, Directory } from "../api.js";
import { claimStatuses, type ClaimAction } from "./constants.js";
import { claimCharacter, formatDate, IdLabel } from "./display.js";

type ClaimsTabProps = {
    can: (capability: DashboardCapability) => boolean;
    claims: CharacterClaim[];
    claimStatus: ClaimStatus;
    directory: Directory | null;
    onClaimAction: (claimId: string, action: ClaimAction) => void;
    onClaimStatusChange: (status: ClaimStatus) => void;
    onRevokeClaim: (claimId: string) => void;
};

export const ClaimsTab = ({
    can,
    claims,
    claimStatus,
    directory,
    onClaimAction,
    onClaimStatusChange,
    onRevokeClaim,
}: ClaimsTabProps) => (
    <section className="claims-panel">
        <div className="segmented">
            {claimStatuses.map((status) => (
                <button
                    key={status}
                    type="button"
                    className={claimStatus === status ? "selected" : ""}
                    onClick={() => onClaimStatusChange(status)}
                >
                    {status}
                </button>
            ))}
        </div>
        <div className="table">
            {claims.length === 0 ? (
                <span className="empty">No {claimStatus} claims</span>
            ) : (
                claims.map((claim) => (
                    <div className="table-row" key={claim.claimId}>
                        <IdLabel
                            id={claim.discordUserId}
                            record={directory?.users[claim.discordUserId]}
                        />
                        <span>{claimCharacter(claim)}</span>
                        <span>
                            {claimStatus === "pending"
                                ? formatDate(claim.requestedAt)
                                : claimStatus === "approved"
                                  ? formatDate(claim.reviewedAt)
                                  : formatDate(claim.revokedAt)}
                        </span>
                        <span>
                            {claimStatus === "approved"
                                ? `Peer ${claim.peerCompareOptIn ? "open" : "private"} / public ${claim.publicPostOptIn ? "yes" : "no"}`
                                : claim.revokeReason ?? ""}
                        </span>
                        <div className="row-actions">
                            {claimStatus === "pending" && can("claims:approve") ? (
                                <button
                                    type="button"
                                    onClick={() => onClaimAction(claim.claimId, "approve")}
                                >
                                    Approve
                                </button>
                            ) : null}
                            {claimStatus === "pending" && can("claims:reject") ? (
                                <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => onClaimAction(claim.claimId, "reject")}
                                >
                                    Reject
                                </button>
                            ) : null}
                            {claimStatus === "approved" && can("claims:revoke") ? (
                                <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => onRevokeClaim(claim.claimId)}
                                >
                                    Revoke
                                </button>
                            ) : null}
                        </div>
                    </div>
                ))
            )}
        </div>
    </section>
);
