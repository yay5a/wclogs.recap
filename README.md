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
  - CoachingInsight
  - Job
  - AuditLog
- WCL client package with:
  - OAuth token plumbing
  - report URL parsing
  - retail vs MoP classic detection
  - normalized schema and adapters
  - report cache persistence
  - fixture-backed mode for safe local testing (`WCL_USE_FIXTURES=true`)
  - parse/execution extraction from Warcraft Logs `rankings` payload when provided by API
- Discord package with:
  - command registration
  - interaction handler for `/health`, `/config`, `/report recap <url>`, and
    context command `Analyze Log`
  - recap preview with **Post Recap** button
  - public recap embed builder
    - persisted `/config` values (guild defaults for game family, compare mode,
    accountability visibility, coaching shareability, and recap post mode)
  - recap generation uses saved guild config values in summary fields
- Domain/db service wiring for future features:
  - `CoachingViewService` stub (`MongoCoachingViewService`)
  - `AccountabilityViewService` stub (`MongoAccountabilityViewService`)
  - `TrendTrackingService` stub (`MongoTrendTrackingService`) with raid/player history ingest hooks
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

- Coaching and accountability view services are persistence-backed stubs and
  currently return placeholder payloads with TODO markers.
- Trend recomputation stores placeholder snapshots for now; rolling-average and
  improvement detection logic is a follow-up.
- Post recap button currently uses in-memory preview state; durable interaction
  state persistence is a follow-up.
- Identity auto-link and candidate-review workflow boundaries are typed and
  modeled, but orchestration service is not fully implemented.

## Behavior notes

- Parse/execution metrics are no longer fabricated. If rankings data for a
  player is unavailable in the Warcraft Logs response, those fields are omitted.
- `/config` now persists guild settings via Mongo and recap summaries consume
  those defaults at generation time.

### Recap enrichment pipeline (phase 1)

- Uses report-wide `rankings(playerMetric: default)` as the baseline metric for
  overall parse snapshots.
- Adds per-boss enrichment from boss-scoped rankings plus table payloads for
  Damage Done, Healing, Deaths, Interrupts, and Survivability.
- Uses actor-id-first joins when possible and falls back to normalized name
  matching when actor IDs are unavailable (less reliable for duplicate names).
- Role-aware metric selection (tank/healer/dps-specific ranking strategies) is
  planned for phase 2.
- Known current limitation: WCL JSON scalar payloads can vary by game family and
  endpoint shape, so parser coverage is heuristic and intentionally defensive.

## Assumptions

- Report URLs include either `?report=` or `?code=` query params.
- Game family inference is path/host heuristic (`classic`/`mop` => MoP Classic,
otherwise Retail).
- MVP recap is read-only against WCL and Discord data operations (except
command registration endpoint).
- MongoDB is the only persistence dependency for this phase.

## Next recommended phase

1. Expand rankings extraction with report-table per-encounter granularity per
game family.
2. Add durable interaction preview state persistence for recap button flows.
3. Implement coaching/advice generation rules and accountability narrative generation.
4. Implement trend rolling windows and improvement detection jobs from raid history.
5. Implement identity confidence scoring and candidate review queue.

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
