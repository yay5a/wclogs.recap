import type { FormEvent } from "react";
import type { DashboardCapability, Directory, GuildConfig } from "../api.js";
import { IdLabel } from "./display.js";

type OfficersTabProps = {
    can: (capability: DashboardCapability) => boolean;
    config: GuildConfig;
    directory: Directory | null;
    loading: boolean;
    officerUserId: string;
    onAddOfficer: (event: FormEvent<HTMLFormElement>) => void;
    onOfficerUserIdChange: (value: string) => void;
    onRemoveOfficer: (discordUserId: string) => void;
};

export const OfficersTab = ({
    can,
    config,
    directory,
    loading,
    officerUserId,
    onAddOfficer,
    onOfficerUserIdChange,
    onRemoveOfficer,
}: OfficersTabProps) => (
    <section className="officer-panel">
        <h3>Officers</h3>
        {can("officers:manage") ? (
            <form className="officer-form" onSubmit={onAddOfficer}>
                <input
                    value={officerUserId}
                    onChange={(event) => onOfficerUserIdChange(event.target.value)}
                    inputMode="numeric"
                />
                <button type="submit" disabled={loading || !officerUserId.trim()}>
                    Add officer
                </button>
            </form>
        ) : null}
        <div className="officer-list">
            {config.compareOfficerUserIds.length === 0 ? (
                <span className="empty">No explicit officers</span>
            ) : (
                config.compareOfficerUserIds.map((discordUserId) => (
                    <div key={discordUserId} className="officer-row">
                        <IdLabel id={discordUserId} record={directory?.users[discordUserId]} />
                        {can("officers:manage") ? (
                            <button
                                type="button"
                                className="secondary"
                                onClick={() => onRemoveOfficer(discordUserId)}
                                disabled={loading}
                            >
                                Remove
                            </button>
                        ) : null}
                    </div>
                ))
            )}
        </div>
    </section>
);
