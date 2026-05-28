import type { ReactNode } from "react";

const LAST_UPDATED = "May 28, 2026";
const GITHUB_ISSUES_URL = "https://github.com/yay5a/wclogs.recap/issues";

const LegalShell = ({
    children,
    title,
}: {
    children: ReactNode;
    title: string;
}) => (
    <main className="legal-shell">
        <article className="legal-document">
            <header className="legal-header">
                <div>
                    <p className="eyebrow">wclogs.report</p>
                    <h1>{title}</h1>
                </div>
                <p>Last updated: {LAST_UPDATED}</p>
            </header>

            {children}

            <nav className="legal-nav" aria-label="Legal pages">
                <a href="/dashboard/terms">Terms</a>
                <a href="/dashboard/privacy">Privacy</a>
                <a href="/dashboard">Dashboard</a>
            </nav>
        </article>
    </main>
);

const SupportLink = () => (
    <a href={GITHUB_ISSUES_URL} rel="noreferrer" target="_blank">
        GitHub issues
    </a>
);

export const TermsPage = () => (
    <LegalShell title="Terms of Service">
        <section>
            <h2>Overview</h2>
            <p>
                WCLogs Recap is a beta Discord bot and web dashboard that summarizes Warcraft Logs
                reports, shows guild ranking summaries, detects Warcraft Logs report links in
                configured Discord channels, and helps guild staff manage character claims and bot
                settings.
            </p>
            <p>
                By installing, configuring, or using the bot, you agree to use it only in servers
                and channels where you have permission. Server administrators are responsible for
                deciding whether the bot is appropriate for their Discord server.
            </p>
        </section>

        <section>
            <h2>Allowed Use</h2>
            <p>
                You may use the bot to create report summaries, configure passive Warcraft Logs URL
                handling, manage approved character claims, and view dashboard activity for Discord
                servers where you are authorized.
            </p>
            <p>
                You may not use the bot to bypass privacy settings, harass users, spam Discord
                channels, probe private data you are not allowed to access, or interfere with the
                service, Discord, Warcraft Logs, or any connected system.
            </p>
        </section>

        <section>
            <h2>Warcraft Logs Data</h2>
            <p>
                WCLogs Recap depends on Warcraft Logs data and APIs. Report summaries and ranking
                output may be incomplete, delayed, unavailable, or different from the values shown
                directly on Warcraft Logs. Output is informational and should be checked against the
                source report when accuracy matters.
            </p>
        </section>

        <section>
            <h2>Accounts and Authorization</h2>
            <p>
                Dashboard sign-in uses Discord OAuth. Warcraft Logs account linking is optional and
                is used only when a user chooses to authorize Warcraft Logs access for reports that
                require their linked authorization.
            </p>
            <p>
                Keep your Discord account, Warcraft Logs account, and server permissions secure. Do
                not share bot tokens, OAuth codes, dashboard secrets, private reports, or other
                credentials in support requests.
            </p>
        </section>

        <section>
            <h2>Beta Service</h2>
            <p>
                The bot is provided during beta development. Features may change, break, be removed,
                or become unavailable without notice. Access may be limited or removed for abuse,
                security reasons, maintenance, or project changes.
            </p>
        </section>

        <section>
            <h2>Third Parties</h2>
            <p>
                WCLogs Recap is not affiliated with Discord, Blizzard Entertainment, or Warcraft
                Logs. Your use of Discord and Warcraft Logs is also governed by their own terms and
                privacy policies.
            </p>
        </section>

        <section>
            <h2>Support</h2>
            <p>
                For support, bug reports, abuse reports, or deletion requests, open an issue through{" "}
                <SupportLink />. Do not include secrets, private report contents, OAuth codes, or
                bot tokens in a public issue.
            </p>
        </section>
    </LegalShell>
);

export const PrivacyPage = () => (
    <LegalShell title="Privacy Policy">
        <section>
            <h2>Overview</h2>
            <p>
                WCLogs Recap processes only the information needed to operate the Discord bot,
                dashboard, Warcraft Logs summaries, passive report detection, and character claim
                workflow.
            </p>
        </section>

        <section>
            <h2>Information Processed</h2>
            <p>The bot may process and store the following information:</p>
            <ul>
                <li>Discord guild IDs, channel IDs, message IDs, and user IDs.</li>
                <li>Discord dashboard sign-in profile basics, such as username and display name.</li>
                <li>Discord OAuth guild list data used to decide which dashboards you can access.</li>
                <li>Guild settings, officer user IDs, auto-report channel IDs, and WCL guild targets.</li>
                <li>
                    Character claim records, including character name, realm, region, owner Discord
                    user ID, claim status, privacy opt-ins, and review or revoke metadata.
                </li>
                <li>
                    Warcraft Logs report URLs, report codes, report summaries, ranking data, and
                    operational cache data needed to render bot responses.
                </li>
                <li>
                    Encrypted Warcraft Logs OAuth tokens when a Discord user chooses to link their
                    Warcraft Logs account.
                </li>
            </ul>
        </section>

        <section>
            <h2>Message Content</h2>
            <p>
                Passive report detection reads message content in configured Discord channels to find
                Warcraft Logs report URLs. The bot does not use Discord message content for ads, data
                sale, user profiling, or AI model training.
            </p>
            <p>
                When a supported report URL is detected, the bot stores operational metadata such as
                guild ID, channel ID, source message ID, source author ID, report code, report URL,
                and temporary prompt or duplicate-tracking state.
            </p>
        </section>

        <section>
            <h2>How Information Is Used</h2>
            <p>Information is used to:</p>
            <ul>
                <li>Respond to slash commands and button interactions.</li>
                <li>Generate Warcraft Logs summaries and guild ranking output.</li>
                <li>Provide guild-scoped dashboard configuration and activity history.</li>
                <li>Authorize dashboard access for server managers and configured officers.</li>
                <li>Manage character claims and comparison privacy choices.</li>
                <li>Prevent duplicate passive report posts in configured channels.</li>
            </ul>
        </section>

        <section>
            <h2>Retention</h2>
            <p>
                Dashboard activity records are retained for about 90 days. Auto-report prompt and
                duplicate-tracking records are temporary and typically expire after about 15 minutes.
                Dashboard sessions and OAuth state cookies are short-lived.
            </p>
            <p>
                Guild configuration and character claim records are retained while they are needed
                for the server configuration and claim workflow. Warcraft Logs OAuth tokens are
                retained until the user unlinks Warcraft Logs or requests deletion.
            </p>
        </section>

        <section>
            <h2>Sharing and Security</h2>
            <p>
                WCLogs Recap does not sell personal data and does not share Discord API data with
                advertising networks or data brokers. Data is shared with Discord and Warcraft Logs
                only as needed for bot operation, OAuth flows, API requests, and Discord messages.
            </p>
            <p>
                Warcraft Logs OAuth tokens are encrypted at rest. The dashboard uses signed,
                HTTP-only cookies and production deployments use secure cookies when configured with
                HTTPS.
            </p>
        </section>

        <section>
            <h2>Deletion Requests</h2>
            <p>
                To request deletion of stored data, open an issue through <SupportLink /> with the
                minimum context needed to identify the request. Do not post secrets, private report
                contents, OAuth codes, or bot tokens in a public issue.
            </p>
        </section>

        <section>
            <h2>Third Parties</h2>
            <p>
                Discord and Warcraft Logs operate their own services and have their own privacy
                policies. WCLogs Recap is not responsible for the privacy practices of those third
                parties.
            </p>
        </section>
    </LegalShell>
);

export const getPublicLegalPage = (pathname: string): ReactNode | null => {
    if (pathname === "/dashboard/terms") return <TermsPage />;
    if (pathname === "/dashboard/privacy") return <PrivacyPage />;
    return null;
};
