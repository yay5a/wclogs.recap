<<<<<<< HEAD
# WCLogs Recap Discord Companion (MVP Hardening)
=======
# WCLogs Recap Discord Companion (MVP)
>>>>>>> c1868b4 (generated framework through codex)

Warcraft Logs-focused Discord companion app.

## Implemented in this run

- Workspace scaffold with `/apps/web`, `/apps/worker`, and `/packages/*` modules.
- Strict TypeScript config, ESLint, Prettier, Vitest, and environment validation.
- MongoDB + Mongoose data model for:
  - GuildSettings
  - PlayerProfile
  - CharacterIdentity
  - ReportCache
  - RaidSnapshot
  - FightSnapshot
  - PlayerRaidSummary
  - TrendSnapshot
  - AccountabilityEvent
  - Job
  - AuditLog
- WCL client package with:
  - OAuth token plumbing
  - report URL parsing
  - retail vs MoP classic detection
  - normalized schema and adapters
  - report cache persistence
  - fixture-backed mode for safe local testing (`WCL_USE_FIXTURES=true`)
- Discord package with:
  - command registration
  - interaction handler for `/health`, `/config`, `/report recap <url>`, and
    context command `Analyze Log`
  - recap preview with **Post Recap** button
  - public recap embed builder
- Web app with:
  - `/health`
  - `/discord/interactions`
  - `/discord/register-commands`
  - structured logging and graceful error handling
- Worker app with:
  - queue abstraction
  - MongoDB-backed job model polling scaffold
  - future hooks for subscriptions/trend recompute jobs

## Mocked / incomplete

- WCL normalization currently maps parse/execution metrics with deterministic
    placeholder values when real percentile details are unavailable from the
    selected MVP query.
- `/config` command currently acknowledges configuration but does not
    persist settings.
- Post recap button currently posts a simplified MVP recap message;
    fetching/rehydrating full preview state via interaction token is a follow-up.
- Identity auto-link and candidate-review workflow boundaries are typed and
    modeled, but orchestration service is not fully implemented.

## Assumptions

- Report URLs include either `?report=` or `?code=` query params.
- Game family inference is path/host heuristic (`classic`/`mop` => MoP Classic,
    otherwise Retail).
- MVP recap is read-only against WCL and Discord data operations (except
    command registration endpoint).
- MongoDB is the only persistence dependency for this phase.

## Next recommended phase

1. Implement real percentile/execution extraction queries per game family adapter.
2. Persist `/config` and enforce officers-only visibility rules.
3. Add recap-post state persistence for reliable button flows.
4. Implement identity confidence scoring and candidate review queue.
5. Add trend computation jobs and snapshots over rolling windows.

## Local setup

```bash
corepack enable
pnpm install
cp .env.example .env
# set secrets
pnpm dev:web
pnpm dev:worker
```

### with Docker

```bash
docker compose up --build
```

## Scripts

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm dev:web`
- `pnpm dev:worker`
<<<<<<< HEAD
=======

| Column1 |
| ------------- |
| Item1 |
>>>>>>> c1868b4 (generated framework through codex)
