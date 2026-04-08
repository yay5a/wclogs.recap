# WCLogs Recap Discord Companion (MVP Hardening)

Node.js + TypeScript pnpm monorepo for a Warcraft Logs-focused Discord companion app.

## What is real now
- Canonical WCL URL parsing supports path-based report URLs (`/reports/<code>`), plus legacy `?report=` / `?code=` fallbacks.
- URL parser validates protocol, host, report code shape, and optional fight selectors.
- Adapter selection is layered (host/path/hints) with dedicated Retail and MoP Classic adapter entry points over one normalized schema.
- WCL normalization uses actual ranking payload data where available (`rankPercent`, `executionRank`) and omits metrics if data is missing.
- Recap derivation and public embed rendering are data-backed only (no placeholder metric fabrication).
- `/config` now persists guild settings in MongoDB via `GuildSettings` and reads/writes:
  - default game family
  - compare mode default
  - accountability visibility
  - coaching shareability default
  - recap posting mode default
- `/report recap` preview/post flow now builds the same reliable embed output from normalized data.
- Raid snapshots and player summary snapshots are persisted for previous-raid comparisons (most improved metric when available).

## Still mocked or incomplete
- WCL query shape is intentionally MVP-scoped and does not yet fetch all possible parse dimensions.
- Compare mode is modeled and persisted, but only `character` mode behavior is currently used in recap derivation.
- Analyze Log context command still redirects users to `/report recap`.
- Worker job handlers for trends/subscriptions remain TODO scaffolds.
- Identity auto-link / candidate review orchestration is still not implemented.

## Assumptions
- WCL rankings payload is present as JSON string/object and may be partially populated.
- Missing WCL ranking details must result in omitted recap fields (never fabricated values).
- MongoDB remains the only persistence layer in this phase.

## Recommended next phase
1. Expand WCL query + normalization with per-fight/per-role dimensions for deeper coaching and accountability views.
2. Enforce role-based visibility rules in command handling for officers-only/shareable outputs.
3. Persist and rehydrate recap preview interaction state more robustly than custom-id encoding.
4. Build trend snapshots from worker pipeline using stored raid/player summaries.
5. Implement identity confidence scoring and candidate review workflow.

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
