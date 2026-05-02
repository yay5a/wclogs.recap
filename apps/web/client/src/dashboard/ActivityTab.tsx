import type { ActivityEvent, Directory } from "../api.js";
import { actionText, formatDate, IdLabel } from "./display.js";

type ActivityTabProps = {
    activity: ActivityEvent[];
    directory: Directory | null;
};

export const ActivityTab = ({ activity, directory }: ActivityTabProps) => (
    <section className="activity-panel">
        <div className="table activity-table">
            {activity.length === 0 ? (
                <span className="empty">No successful activity yet</span>
            ) : (
                activity.map((event, index) => (
                    <div className="table-row" key={`${event.kind}-${event.createdAt}-${index}`}>
                        <span>{formatDate(event.createdAt)}</span>
                        <span>{actionText(event)}</span>
                        <span>{event.reportCode ?? event.characterLabel ?? "-"}</span>
                        <span>
                            {event.channelId ? (
                                <IdLabel
                                    id={event.channelId}
                                    record={directory?.channels[event.channelId]}
                                />
                            ) : (
                                "-"
                            )}
                        </span>
                        <span>
                            {event.actor?.kind === "discord" ? (
                                <IdLabel
                                    id={event.actor.discordUserId}
                                    record={directory?.users[event.actor.discordUserId]}
                                />
                            ) : (
                                event.actor?.kind ?? "-"
                            )}
                        </span>
                        <span>success</span>
                    </div>
                ))
            )}
        </div>
    </section>
);
