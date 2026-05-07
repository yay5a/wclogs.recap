import type { ActivityEvent, CharacterClaim, ClaimStatus, Directory, GuildConfig } from "../api.js";
import { IdLabel } from "./display.js";

type OverviewTabProps = {
    activity: ActivityEvent[];
    claims: CharacterClaim[];
    claimStatus: ClaimStatus;
    config: GuildConfig;
    directory: Directory | null;
};

export const OverviewTab = ({
    activity,
    claims,
    claimStatus,
    config,
    directory,
}: OverviewTabProps) => (
    <section className="panel-grid">
        <div className="metric-panel">
            <span>Configured channels</span>
            <strong>{config.autoRecapChannelIds.length}</strong>
        </div>
        <div className="metric-panel">
            <span>Officers</span>
            <strong>{config.compareOfficerUserIds.length}</strong>
        </div>
        <div className="metric-panel">
            <span>Pending claims</span>
            <strong>{claimStatus === "pending" ? claims.length : "-"}</strong>
        </div>
        <div className="metric-panel">
            <span>Recent successful actions</span>
            <strong>{activity.length}</strong>
        </div>
        <section className="wide-panel">
            <h3>Channels</h3>
            <div className="stack">
                {config.autoRecapChannelIds.length === 0 ? (
                    <span className="empty">No report channels configured</span>
                ) : (
                    config.autoRecapChannelIds.map((channelId) => (
                        <IdLabel
                            key={channelId}
                            id={channelId}
                            record={directory?.channels[channelId]}
                        />
                    ))
                )}
            </div>
        </section>
    </section>
);
