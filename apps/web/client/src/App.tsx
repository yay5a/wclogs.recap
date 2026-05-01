import { FormEvent, useEffect, useMemo, useState } from "react";
import {
    api,
    type AutoRecapMode,
    type CompareAccessMode,
    type CompareMode,
    type ConfigPatch,
    type GameFamily,
    type GuildConfig,
    type GuildSummary,
} from "./api.js";

const compareModes: CompareMode[] = ["character", "mixed"];
const compareAccessModes: CompareAccessMode[] = [
    "officer_only",
    "owner_or_officer",
    "owner_opt_in_or_officer",
    "owner_only",
];
const autoRecapModes: AutoRecapMode[] = ["off", "prompt", "auto_preview", "auto_post"];
const gameFamilies: GameFamily[] = ["retail", "mop_classic"];

const toChannelText = (config: GuildConfig | null): string =>
    config?.autoRecapChannelIds.join("\n") ?? "";

const parseChannelText = (value: string): string[] =>
    value
        .split(/\s|,/)
        .map((entry) => entry.trim())
        .filter(Boolean);

export const App = () => {
    const [checkingSession, setCheckingSession] = useState(true);
    const [authenticated, setAuthenticated] = useState(false);
    const [adminSecret, setAdminSecret] = useState("");
    const [guilds, setGuilds] = useState<GuildSummary[]>([]);
    const [selectedGuildId, setSelectedGuildId] = useState("");
    const [config, setConfig] = useState<GuildConfig | null>(null);
    const [channelText, setChannelText] = useState("");
    const [newGuildId, setNewGuildId] = useState("");
    const [officerUserId, setOfficerUserId] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const selectedSummary = useMemo(
        () => guilds.find((guild) => guild.guildId === selectedGuildId),
        [guilds, selectedGuildId],
    );

    const clearMessages = () => {
        setError("");
        setNotice("");
    };

    const run = async (task: () => Promise<void>) => {
        clearMessages();
        setLoading(true);
        try {
            await task();
        } catch (caught) {
            const message = caught instanceof Error ? caught.message : String(caught);
            if (message === "unauthorized") {
                setAuthenticated(false);
                setConfig(null);
                setGuilds([]);
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const refreshGuilds = async (nextGuildId = selectedGuildId) => {
        const nextGuilds = await api.listGuilds();
        setGuilds(nextGuilds);
        const fallbackGuildId = nextGuilds[0]?.guildId ?? "";
        const usableGuildId = nextGuilds.some((guild) => guild.guildId === nextGuildId)
            ? nextGuildId
            : fallbackGuildId;
        setSelectedGuildId(usableGuildId);
        if (usableGuildId) {
            const nextConfig = await api.getConfig(usableGuildId);
            setConfig(nextConfig);
            setChannelText(toChannelText(nextConfig));
        } else {
            setConfig(null);
            setChannelText("");
        }
    };

    useEffect(() => {
        let active = true;
        const boot = async () => {
            try {
                const hasSession = await api.session();
                if (!active) return;
                setAuthenticated(hasSession);
                if (hasSession) {
                    await refreshGuilds("");
                }
            } catch (caught) {
                if (!active) return;
                setError(caught instanceof Error ? caught.message : String(caught));
            } finally {
                if (active) setCheckingSession(false);
            }
        };
        void boot();
        return () => {
            active = false;
        };
    }, []);

    const handleLogin = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void run(async () => {
            await api.login(adminSecret);
            setAdminSecret("");
            setAuthenticated(true);
            await refreshGuilds("");
            setNotice("Signed in");
        });
    };

    const handleLogout = () => {
        void run(async () => {
            await api.logout();
            setAuthenticated(false);
            setGuilds([]);
            setSelectedGuildId("");
            setConfig(null);
            setNotice("Signed out");
        });
    };

    const handleGuildSelect = (guildId: string) => {
        setSelectedGuildId(guildId);
        if (!guildId) {
            setConfig(null);
            return;
        }
        void run(async () => {
            const nextConfig = await api.getConfig(guildId);
            setConfig(nextConfig);
            setChannelText(toChannelText(nextConfig));
        });
    };

    const handleCreateGuild = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const guildId = newGuildId.trim();
        void run(async () => {
            const created = await api.createGuild(guildId);
            setNewGuildId("");
            await refreshGuilds(created.guildId);
            setNotice("Guild ready");
        });
    };

    const updateConfigField = <Key extends keyof GuildConfig>(key: Key, value: GuildConfig[Key]) => {
        setConfig((current) => (current ? { ...current, [key]: value } : current));
    };

    const handleSaveConfig = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!config) return;
        const guildId = config.guildId;
        const patch: ConfigPatch = {
            compareModeDefault: config.compareModeDefault,
            compareAccessMode: config.compareAccessMode,
            comparePublicPostingEnabled: config.comparePublicPostingEnabled,
            autoRecapMode: config.autoRecapMode,
            autoRecapChannelIds: parseChannelText(channelText),
            defaultGameFamily: config.defaultGameFamily,
        };

        void run(async () => {
            const saved = await api.saveConfig(guildId, patch);
            setConfig(saved);
            setChannelText(toChannelText(saved));
            await refreshGuilds(guildId);
            setNotice("Config saved");
        });
    };

    const handleAddOfficer = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!config) return;
        const guildId = config.guildId;
        const discordUserId = officerUserId.trim();
        void run(async () => {
            const nextConfig = await api.addOfficer(guildId, discordUserId);
            setConfig(nextConfig);
            setOfficerUserId("");
            await refreshGuilds(guildId);
            setNotice("Officer added");
        });
    };

    const handleRemoveOfficer = (discordUserId: string) => {
        if (!config) return;
        const guildId = config.guildId;
        void run(async () => {
            const nextConfig = await api.removeOfficer(guildId, discordUserId);
            setConfig(nextConfig);
            await refreshGuilds(guildId);
            setNotice("Officer removed");
        });
    };

    if (checkingSession) {
        return (
            <main className="app-shell">
                <div className="status-panel">Loading</div>
            </main>
        );
    }

    if (!authenticated) {
        return (
            <main className="login-shell">
                <form className="login-panel" onSubmit={handleLogin}>
                    <div>
                        <p className="eyebrow">wclogs.recap</p>
                        <h1>Dashboard</h1>
                    </div>
                    <label>
                        Admin secret
                        <input
                            type="password"
                            value={adminSecret}
                            onChange={(event) => setAdminSecret(event.target.value)}
                            autoComplete="current-password"
                        />
                    </label>
                    <button type="submit" disabled={loading || !adminSecret.trim()}>
                        Sign in
                    </button>
                    {error ? <p className="message error">{error}</p> : null}
                </form>
            </main>
        );
    }

    return (
        <main className="dashboard-shell">
            <aside className="sidebar">
                <div className="brand">
                    <p className="eyebrow">wclogs.recap</p>
                    <h1>Dashboard</h1>
                </div>

                <form className="create-guild" onSubmit={handleCreateGuild}>
                    <label>
                        Guild ID
                        <input
                            value={newGuildId}
                            onChange={(event) => setNewGuildId(event.target.value)}
                            inputMode="numeric"
                        />
                    </label>
                    <button type="submit" disabled={loading || !newGuildId.trim()}>
                        Add guild
                    </button>
                </form>

                <div className="guild-list">
                    {guilds.map((guild) => (
                        <button
                            type="button"
                            key={guild.guildId}
                            className={guild.guildId === selectedGuildId ? "selected" : ""}
                            onClick={() => handleGuildSelect(guild.guildId)}
                        >
                            <span>{guild.guildId}</span>
                            <small>
                                {guild.compareOfficerUserCount} officers -{" "}
                                {guild.autoRecapChannelCount} channels
                            </small>
                        </button>
                    ))}
                </div>

                <button type="button" className="secondary" onClick={handleLogout} disabled={loading}>
                    Sign out
                </button>
            </aside>

            <section className="workspace">
                {error ? <div className="message error">{error}</div> : null}
                {notice ? <div className="message success">{notice}</div> : null}

                {!config ? (
                    <div className="status-panel">No guild selected</div>
                ) : (
                    <>
                        <header className="guild-header">
                            <div>
                                <p className="eyebrow">Guild</p>
                                <h2>{config.guildId}</h2>
                            </div>
                            {selectedSummary?.updatedAt ? (
                                <time dateTime={selectedSummary.updatedAt}>
                                    {new Date(selectedSummary.updatedAt).toLocaleString()}
                                </time>
                            ) : null}
                        </header>

                        <form className="config-grid" onSubmit={handleSaveConfig}>
                            <label>
                                Game family
                                <select
                                    value={config.defaultGameFamily}
                                    onChange={(event) =>
                                        updateConfigField(
                                            "defaultGameFamily",
                                            event.target.value as GameFamily,
                                        )
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
                                    onChange={(event) =>
                                        updateConfigField(
                                            "compareModeDefault",
                                            event.target.value as CompareMode,
                                        )
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
                                    onChange={(event) =>
                                        updateConfigField(
                                            "compareAccessMode",
                                            event.target.value as CompareAccessMode,
                                        )
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
                                Auto recap
                                <select
                                    value={config.autoRecapMode}
                                    onChange={(event) =>
                                        updateConfigField(
                                            "autoRecapMode",
                                            event.target.value as AutoRecapMode,
                                        )
                                    }
                                >
                                    {autoRecapModes.map((mode) => (
                                        <option key={mode} value={mode}>
                                            {mode}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="checkbox-row">
                                <input
                                    type="checkbox"
                                    checked={config.comparePublicPostingEnabled}
                                    onChange={(event) =>
                                        updateConfigField(
                                            "comparePublicPostingEnabled",
                                            event.target.checked,
                                        )
                                    }
                                />
                                Public compare posting
                            </label>

                            <label className="wide">
                                Auto recap channels
                                <textarea
                                    value={channelText}
                                    onChange={(event) => setChannelText(event.target.value)}
                                    rows={5}
                                />
                            </label>

                            <button type="submit" disabled={loading}>
                                Save config
                            </button>
                        </form>

                        <section className="officer-panel">
                            <h3>Officers</h3>
                            <form className="officer-form" onSubmit={handleAddOfficer}>
                                <input
                                    value={officerUserId}
                                    onChange={(event) => setOfficerUserId(event.target.value)}
                                    inputMode="numeric"
                                />
                                <button type="submit" disabled={loading || !officerUserId.trim()}>
                                    Add officer
                                </button>
                            </form>
                            <div className="officer-list">
                                {config.compareOfficerUserIds.length === 0 ? (
                                    <span className="empty">No explicit officers</span>
                                ) : (
                                    config.compareOfficerUserIds.map((discordUserId) => (
                                        <div key={discordUserId} className="officer-row">
                                            <span>{discordUserId}</span>
                                            <button
                                                type="button"
                                                className="secondary"
                                                onClick={() => handleRemoveOfficer(discordUserId)}
                                                disabled={loading}
                                            >
                                                Remove
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>
                    </>
                )}
            </section>
        </main>
    );
};
