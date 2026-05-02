import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
    api,
    type ActivityEvent,
    type CharacterClaim,
    type ClaimStatus,
    type ConfigPatch,
    type DashboardAuth,
    type DashboardCapability,
    type Directory,
    type GuildConfig,
    type GuildSummary,
    type OnboardingState,
} from "./api.js";
import { ActivityTab } from "./dashboard/ActivityTab.js";
import { ClaimsTab } from "./dashboard/ClaimsTab.js";
import {
    claimActionPastTense,
    onboardingSteps,
    tabs,
    type ClaimAction,
    type Tab,
} from "./dashboard/constants.js";
import { IdLabel, parseChannelText, toChannelText } from "./dashboard/display.js";
import { OfficersTab } from "./dashboard/OfficersTab.js";
import { OnboardingPanel } from "./dashboard/OnboardingPanel.js";
import { OverviewTab } from "./dashboard/OverviewTab.js";
import { RevokeClaimModal } from "./dashboard/RevokeClaimModal.js";
import { SettingsTab } from "./dashboard/SettingsTab.js";
import { StaleGuildRequestError, useGuildRequestGuards } from "./dashboard/useGuildRequestGuards.js";

export const App = () => {
    const [checkingSession, setCheckingSession] = useState(true);
    const [auth, setAuth] = useState<DashboardAuth | null>(null);
    const [adminSecret, setAdminSecret] = useState("");
    const [guilds, setGuilds] = useState<GuildSummary[]>([]);
    const [selectedGuildId, setSelectedGuildId] = useState("");
    const [config, setConfig] = useState<GuildConfig | null>(null);
    const [directory, setDirectory] = useState<Directory | null>(null);
    const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
    const [activity, setActivity] = useState<ActivityEvent[]>([]);
    const [claims, setClaims] = useState<CharacterClaim[]>([]);
    const [claimStatus, setClaimStatus] = useState<ClaimStatus>("pending");
    const [channelText, setChannelText] = useState("");
    const [newGuildId, setNewGuildId] = useState("");
    const [officerUserId, setOfficerUserId] = useState("");
    const [tab, setTab] = useState<Tab>("overview");
    const [revokeClaimId, setRevokeClaimId] = useState("");
    const [revokeReason, setRevokeReason] = useState("player_left_guild");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const runRequestRef = useRef(0);
    const {
        assertCurrentGuild,
        assertCurrentGuildRequest,
        invalidateGuildRequests,
        isClaimStatusCurrent,
        isCurrentClaimRequest,
        startClaimRequest,
    } = useGuildRequestGuards({ claimStatus, selectedGuildId });

    const selectedSummary = useMemo(
        () => guilds.find((guild) => guild.guildId === selectedGuildId),
        [guilds, selectedGuildId],
    );
    const selectedRevokeClaim = useMemo(
        () => claims.find((claim) => claim.claimId === revokeClaimId),
        [claims, revokeClaimId],
    );

    const capabilities = selectedSummary?.capabilities ?? [];
    const can = (capability: DashboardCapability): boolean =>
        auth?.kind === "admin-secret" || capabilities.includes(capability);

    const guildLabel = selectedGuildId
        ? (directory?.guild.label ?? selectedSummary?.guildName ?? selectedGuildId)
        : "";

    const clearMessages = () => {
        setError("");
        setNotice("");
    };

    const clearGuildData = () => {
        setConfig(null);
        setDirectory(null);
        setOnboarding(null);
        setActivity([]);
        setClaims([]);
        setChannelText("");
        setRevokeClaimId("");
    };

    const run = async (task: () => Promise<void>) => {
        const runRequestId = (runRequestRef.current += 1);
        clearMessages();
        setLoading(true);
        try {
            await task();
        } catch (caught) {
            if (caught instanceof StaleGuildRequestError) return;
            if (runRequestRef.current !== runRequestId) return;
            const message = caught instanceof Error ? caught.message : String(caught);
            if (message === "unauthorized") {
                setAuth(null);
                setGuilds([]);
                setSelectedGuildId("");
                invalidateGuildRequests("");
                clearGuildData();
            }
            setError(message);
        } finally {
            if (runRequestRef.current === runRequestId) setLoading(false);
        }
    };

    const loadGuildData = async (guildId: string, status = claimStatus) => {
        const requestId = invalidateGuildRequests(guildId);
        clearGuildData();
        try {
            const nextConfig = await api.getConfig(guildId);
            assertCurrentGuildRequest(requestId, guildId);
            setConfig(nextConfig);
            setChannelText(toChannelText(nextConfig));
            const [nextDirectory, nextClaims, nextActivity, nextOnboarding] = await Promise.all([
                api.getDirectory(guildId),
                api.listClaims(guildId, status),
                api.listActivity(guildId),
                api.getOnboarding(guildId),
            ]);
            assertCurrentGuildRequest(requestId, guildId);
            setDirectory(nextDirectory);
            if (isClaimStatusCurrent(status)) setClaims(nextClaims);
            setActivity(nextActivity);
            setOnboarding(nextOnboarding);
        } catch (caught) {
            assertCurrentGuildRequest(requestId, guildId);
            throw caught;
        }
    };

    const refreshGuilds = async (
        nextGuildId = selectedGuildId,
        options: { requireCurrentGuildId?: string } = {},
    ) => {
        const nextGuilds = await api.listGuilds();
        if (options.requireCurrentGuildId) assertCurrentGuild(options.requireCurrentGuildId);
        setGuilds(nextGuilds);
        const fallbackGuildId = nextGuilds[0]?.guildId ?? "";
        const usableGuildId = nextGuilds.some((guild) => guild.guildId === nextGuildId)
            ? nextGuildId
            : fallbackGuildId;
        setSelectedGuildId(usableGuildId);
        if (usableGuildId) {
            await loadGuildData(usableGuildId);
        } else {
            invalidateGuildRequests("");
            clearGuildData();
        }
    };

    useEffect(() => {
        let active = true;
        const boot = async () => {
            try {
                const session = await api.session();
                if (!active) return;
                setAuth(session);
                if (session) await refreshGuilds("");
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

    useEffect(() => {
        if (!selectedGuildId || !auth) return;
        const requestId = startClaimRequest();
        const guildId = selectedGuildId;
        const status = claimStatus;
        void run(async () => {
            try {
                const nextClaims = await api.listClaims(guildId, status);
                if (!isCurrentClaimRequest(requestId, guildId, status)) {
                    return;
                }
                setClaims(nextClaims);
            } catch (caught) {
                if (!isCurrentClaimRequest(requestId, guildId, status)) {
                    throw new StaleGuildRequestError();
                }
                throw caught;
            }
        });
    }, [claimStatus]);

    useEffect(() => {
        if (revokeClaimId && !selectedRevokeClaim) setRevokeClaimId("");
    }, [revokeClaimId, selectedRevokeClaim]);

    const handleLogin = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void run(async () => {
            await api.login(adminSecret);
            setAdminSecret("");
            const session = await api.session();
            setAuth(session);
            await refreshGuilds("");
            setNotice("Signed in");
        });
    };

    const handleDiscordLogin = () => {
        window.location.href = api.discordLoginUrl();
    };

    const handleLogout = () => {
        void run(async () => {
            await api.logout();
            setAuth(null);
            setGuilds([]);
            setSelectedGuildId("");
            invalidateGuildRequests("");
            clearGuildData();
            setNotice("Signed out");
        });
    };

    const handleGuildSelect = (guildId: string) => {
        setSelectedGuildId(guildId);
        if (!guildId) {
            invalidateGuildRequests("");
            clearGuildData();
            return;
        }
        void run(async () => loadGuildData(guildId));
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
            dashboardOfficerAccessEnabled: config.dashboardOfficerAccessEnabled,
            autoRecapMode: config.autoRecapMode,
            autoRecapChannelIds: parseChannelText(channelText),
            defaultGameFamily: config.defaultGameFamily,
        };

        void run(async () => {
            try {
                const saved = await api.saveConfig(guildId, patch);
                assertCurrentGuild(guildId);
                setConfig(saved);
                setChannelText(toChannelText(saved));
                await refreshGuilds(guildId, { requireCurrentGuildId: guildId });
                setNotice("Config saved");
            } catch (caught) {
                assertCurrentGuild(guildId);
                throw caught;
            }
        });
    };

    const handleAddOfficer = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!config) return;
        const guildId = config.guildId;
        const discordUserId = officerUserId.trim();
        void run(async () => {
            try {
                const nextConfig = await api.addOfficer(guildId, discordUserId);
                assertCurrentGuild(guildId);
                setConfig(nextConfig);
                setOfficerUserId("");
                await refreshGuilds(guildId, { requireCurrentGuildId: guildId });
                setNotice("Officer added");
            } catch (caught) {
                assertCurrentGuild(guildId);
                throw caught;
            }
        });
    };

    const handleRemoveOfficer = (discordUserId: string) => {
        if (!config) return;
        const guildId = config.guildId;
        void run(async () => {
            try {
                const nextConfig = await api.removeOfficer(guildId, discordUserId);
                assertCurrentGuild(guildId);
                setConfig(nextConfig);
                await refreshGuilds(guildId, { requireCurrentGuildId: guildId });
                setNotice("Officer removed");
            } catch (caught) {
                assertCurrentGuild(guildId);
                throw caught;
            }
        });
    };

    const handleClaimAction = (claimId: string, action: ClaimAction) => {
        if (!config) return;
        const guildId = config.guildId;
        void run(async () => {
            try {
                if (action === "approve") await api.approveClaim(guildId, claimId);
                if (action === "reject") await api.rejectClaim(guildId, claimId);
                if (action === "revoke") await api.revokeClaim(guildId, claimId, revokeReason);
                assertCurrentGuild(guildId);
                setRevokeClaimId("");
                await loadGuildData(guildId);
                setNotice(`Claim ${claimActionPastTense[action]}`);
            } catch (caught) {
                assertCurrentGuild(guildId);
                throw caught;
            }
        });
    };

    const handleDismissOnboarding = () => {
        if (!config || !onboarding) return;
        const guildId = config.guildId;
        void run(async () => {
            try {
                const saved = await api.saveOnboarding(guildId, {
                    seenSteps: onboardingSteps,
                    dismissed: true,
                });
                assertCurrentGuild(guildId);
                setOnboarding(saved);
                setNotice("Onboarding dismissed");
            } catch (caught) {
                assertCurrentGuild(guildId);
                throw caught;
            }
        });
    };

    const handleDeleteGuild = () => {
        if (!config || !window.confirm(`Deconfigure ${guildLabel}?`)) return;
        const guildId = config.guildId;
        void run(async () => {
            try {
                await api.deconfigureGuild(guildId);
            } catch (caught) {
                assertCurrentGuild(guildId);
                throw caught;
            }
            assertCurrentGuild(guildId);
            await refreshGuilds("", { requireCurrentGuildId: guildId });
            setNotice("Guild deconfigured");
        });
    };

    if (checkingSession) {
        return (
            <main className="app-shell">
                <div className="status-panel">Loading</div>
            </main>
        );
    }

    if (!auth) {
        return (
            <main className="login-shell">
                <form className="login-panel" onSubmit={handleLogin}>
                    <div>
                        <p className="eyebrow">wclogs.recap</p>
                        <h1>Operations Console</h1>
                    </div>
                    <button type="button" className="discord-login" onClick={handleDiscordLogin}>
                        Sign in with Discord
                    </button>
                    <div className="divider">or</div>
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
                    <h1>Operations</h1>
                    <small>
                        {auth.kind === "discord" ? auth.displayName : "Admin secret"}
                    </small>
                </div>

                {auth.kind === "admin-secret" ? (
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
                ) : null}

                <div className="guild-list">
                    {guilds.map((guild) => (
                        <button
                            type="button"
                            key={guild.guildId}
                            className={guild.guildId === selectedGuildId ? "selected" : ""}
                            onClick={() => handleGuildSelect(guild.guildId)}
                        >
                            <span>{guild.guildName ?? guild.guildId}</span>
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
                                <h2>
                                    <IdLabel record={directory?.guild} id={config.guildId} />
                                </h2>
                            </div>
                            <div className="header-actions">
                                {selectedSummary?.updatedAt ? (
                                    <time dateTime={selectedSummary.updatedAt}>
                                        {new Date(selectedSummary.updatedAt).toLocaleString()}
                                    </time>
                                ) : null}
                                {can("guild:delete") ? (
                                    <button
                                        type="button"
                                        className="danger"
                                        onClick={handleDeleteGuild}
                                        disabled={loading}
                                    >
                                        Deconfigure
                                    </button>
                                ) : null}
                            </div>
                        </header>

                        {!onboarding?.dismissedAt ? (
                            <OnboardingPanel onDismiss={handleDismissOnboarding} />
                        ) : null}

                        <nav className="tabs">
                            {tabs.map((entry) => (
                                <button
                                    key={entry}
                                    type="button"
                                    className={tab === entry ? "selected" : ""}
                                    onClick={() => setTab(entry)}
                                >
                                    {entry}
                                </button>
                            ))}
                        </nav>

                        {tab === "overview" ? (
                            <OverviewTab
                                activity={activity}
                                claims={claims}
                                claimStatus={claimStatus}
                                config={config}
                                directory={directory}
                            />
                        ) : null}

                        {tab === "settings" ? (
                            <SettingsTab
                                can={can}
                                channelText={channelText}
                                config={config}
                                loading={loading}
                                onChannelTextChange={setChannelText}
                                onSaveConfig={handleSaveConfig}
                                updateConfigField={updateConfigField}
                            />
                        ) : null}

                        {tab === "officers" ? (
                            <OfficersTab
                                can={can}
                                config={config}
                                directory={directory}
                                loading={loading}
                                officerUserId={officerUserId}
                                onAddOfficer={handleAddOfficer}
                                onOfficerUserIdChange={setOfficerUserId}
                                onRemoveOfficer={handleRemoveOfficer}
                            />
                        ) : null}

                        {tab === "claims" ? (
                            <ClaimsTab
                                can={can}
                                claims={claims}
                                claimStatus={claimStatus}
                                directory={directory}
                                onClaimAction={handleClaimAction}
                                onClaimStatusChange={setClaimStatus}
                                onRevokeClaim={setRevokeClaimId}
                            />
                        ) : null}

                        {tab === "activity" ? (
                            <ActivityTab activity={activity} directory={directory} />
                        ) : null}
                    </>
                )}
            </section>

            {revokeClaimId && selectedRevokeClaim ? (
                <RevokeClaimModal
                    claim={selectedRevokeClaim}
                    directory={directory}
                    onCancel={() => setRevokeClaimId("")}
                    onReasonChange={setRevokeReason}
                    onSubmit={(event) => {
                        event.preventDefault();
                        handleClaimAction(revokeClaimId, "revoke");
                    }}
                    reason={revokeReason}
                />
            ) : null}
        </main>
    );
};
