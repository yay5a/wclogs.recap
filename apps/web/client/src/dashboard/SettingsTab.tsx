import type { FormEvent } from "react";
import type {
    AutoReportMode,
    CompareAccessMode,
    CompareMode,
    DashboardCapability,
    GameFamily,
    GuildConfig,
} from "../api.js";
import {
    autoReportModes,
    compareAccessModes,
    compareModes,
    gameFamilies,
} from "./constants.js";

type SettingsTabProps = {
    can: (capability: DashboardCapability) => boolean;
    channelText: string;
    config: GuildConfig;
    loading: boolean;
    onChannelTextChange: (value: string) => void;
    onSaveConfig: (event: FormEvent<HTMLFormElement>) => void;
    updateConfigField: <Key extends keyof GuildConfig>(key: Key, value: GuildConfig[Key]) => void;
};

export const SettingsTab = ({
    can,
    channelText,
    config,
    loading,
    onChannelTextChange,
    onSaveConfig,
    updateConfigField,
}: SettingsTabProps) => (
    <form className="config-grid" onSubmit={onSaveConfig}>
        <label>
            Game family
            <select
                value={config.defaultGameFamily}
                disabled={!can("settings:edit")}
                onChange={(event) =>
                    updateConfigField("defaultGameFamily", event.target.value as GameFamily)
                }
            >
                {gameFamilies.map((family) => (
                    <option key={family} value={family}>
                        {family}
                    </option>
                ))}
            </select>
        </label>
        <label>
            Compare mode
            <select
                value={config.compareModeDefault}
                disabled={!can("settings:edit")}
                onChange={(event) =>
                    updateConfigField("compareModeDefault", event.target.value as CompareMode)
                }
            >
                {compareModes.map((mode) => (
                    <option key={mode} value={mode}>
                        {mode}
                    </option>
                ))}
            </select>
        </label>
        <label>
            Compare access
            <select
                value={config.compareAccessMode}
                disabled={!can("settings:edit")}
                onChange={(event) =>
                    updateConfigField("compareAccessMode", event.target.value as CompareAccessMode)
                }
            >
                {compareAccessModes.map((mode) => (
                    <option key={mode} value={mode}>
                        {mode}
                    </option>
                ))}
            </select>
        </label>
        <label>
            Auto report
            <select
                value={config.autoReportMode}
                disabled={!can("settings:edit")}
                onChange={(event) =>
                    updateConfigField("autoReportMode", event.target.value as AutoReportMode)
                }
            >
                {autoReportModes.map((mode) => (
                    <option key={mode} value={mode}>
                        {mode}
                    </option>
                ))}
            </select>
        </label>
        <label className="checkbox-row">
            <input
                type="checkbox"
                disabled={!can("settings:edit")}
                checked={config.comparePublicPostingEnabled}
                onChange={(event) =>
                    updateConfigField("comparePublicPostingEnabled", event.target.checked)
                }
            />
            Public compare posting
        </label>
        <label className="checkbox-row">
            <input
                type="checkbox"
                disabled={!can("settings:edit")}
                checked={config.dashboardOfficerAccessEnabled}
                onChange={(event) =>
                    updateConfigField("dashboardOfficerAccessEnabled", event.target.checked)
                }
            />
            Officer dashboard access
        </label>
        <label className="wide">
            Auto report channels
            <textarea
                value={channelText}
                disabled={!can("settings:edit")}
                onChange={(event) => onChannelTextChange(event.target.value)}
                rows={5}
            />
        </label>
        {can("settings:edit") ? (
            <button type="submit" disabled={loading}>
                Save config
            </button>
        ) : null}
    </form>
);
