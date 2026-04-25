# wclogs.recap

Beta Warcraft Logs recap service for Discord.

`wclogs.recap` fetches Warcraft Logs reports, normalizes the GraphQL payloads into typed raid recap models, and renders concise Discord-ready summaries. The current beta focuses on `/report recap` for Warcraft Logs Classic raid reports, with Mongo-backed caching and preview state.

## Beta Status

The beta is usable for live recap generation, but the internals are still being hardened.

Currently working:

- Discord interaction webhook handling with signature verification.
- `/report recap` flow for Warcraft Logs report URLs.
- Deferred Discord responses so longer WCL fetches do not block the initial interaction ACK.
- Recap sections for Outcome, Performance, Volume, Execution, and Report link.
- Report-wide damage, healing, damage taken, deaths, dispels, and interrupts from WCL table payloads.
- Human-readable phase durations in boss highlights and raid superlatives.
- Mongo-backed report cache, guild config, recap preview state, WCL user auth, and trend/job models.
- Background worker for Mongo job polling, currently used for trend recomputation.

Known beta limitations:

- `@wcl/wcl-client` still owns too much orchestration and normalization logic in one large module.
- WCL GraphQL payload shapes vary; parsers are defensive, but new report shapes may require probe-backed fixes.
- There is no database migration system yet.
- Worker processing is intentionally simple and serial.
- Public `/api/recap` abuse protection/rate limiting is not implemented yet.
- The Discord renderer is optimized for concise embeds, not exhaustive raid analysis.

## Repository Layout

```text
wclogs.recap/
  apps/
    web/            Fastify API, Discord webhook, WCL OAuth routes
    worker/         Mongo-backed background job worker
  packages/
    contracts/      Shared contract package placeholder
    db/             Mongoose models and Mongo stores/services
    discord/        Discord commands, interaction handling, embed rendering
    domain/         Normalized raid types and recap section builders
    shared/         Logger, Zod helpers, shared utility types
    wcl-client/     Warcraft Logs GraphQL client, cache policy, parsers
  docker-compose.yml
  pnpm-workspace.yaml
```

## Recap Output

The beta recap is rendered as a Discord embed with these sections:

- `Outcome`: raid title, guild/realm, duration, date, and boss highlights.
- `Performance`: best parses, best average, best single-boss parse, and overall DPS/HPS/DTPS rankings.
- `Volume`: top damage done, healing done, damage taken, and raid totals.
- `Execution`: top interrupts, top dispels, and raid superlatives.
- `Report`: source Warcraft Logs report URL.

Example source input:

```text
https://classic.warcraftlogs.com/reports/jLXw9HBGyRW6D8vZ
```

## Requirements

- Node.js compatible with the repo toolchain.
- PNPM via Corepack. The repo declares `pnpm@10.33.0`.
- MongoDB connection string.
- Warcraft Logs API client ID and client secret.
- Discord application credentials for the Discord webhook flow.

## Environment

The web app loads `.env` from the repo root when present. Docker Compose also reads root `.env` for variable substitution.

Required for `apps/web`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection URI. |
| `DISCORD_PUBLIC_KEY` | 64-character Discord public key used to verify interactions. |
| `DISCORD_APPLICATION_ID` | Discord application ID. |
| `DISCORD_BOT_TOKEN` | Discord bot token used for command registration and response edits. |
| `WCL_CLIENT_ID` | Warcraft Logs OAuth client ID. |
| `WCL_CLIENT_SECRET` | Warcraft Logs OAuth client secret. |
| `WCL_REDIRECT_URI` | Callback URL for WCL user OAuth routes. |
| `COOKIE_SECRET` | Secret for signed cookies used by OAuth state handling. |

Optional web variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Runtime mode: `development`, `test`, or `production`. |
| `PORT` | `3000` | HTTP port for the Fastify web service. |
| `WCL_API_BASE_URL` | `https://www.warcraftlogs.com/api/v2/client` | WCL GraphQL API endpoint. |
| `PREVIEW_STATE_TTL_SECONDS` | `900` | TTL for Discord recap preview state. |

Required for `apps/worker`:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection URI. |

Useful WCL client toggles:

| Variable | Purpose |
| --- | --- |
| `WCL_OAUTH_TOKEN` | Use an explicit WCL bearer token instead of client credentials. |
| `WCL_BYPASS_CACHE=true` | Force report fetches to bypass cached payloads. |
| `WCL_USE_FIXTURES=true` | Use local fixture mode in targeted development paths. |

## Install

```sh
corepack enable
pnpm install
```

Create a root `.env` with the variables above. This repo does not currently ship a committed `.env.example`.

## Local Development

Run the web app:

```sh
pnpm dev:web
```

Run the worker:

```sh
pnpm dev:worker
```

Register Discord commands:

```sh
pnpm --filter @wcl/web register:discord-commands
```

To register commands to a guild, provide `DISCORD_GUILD_ID` in the environment or pass the guild ID as the command argument if using the app script convention.

## Docker

Build and start the beta stack:

```sh
docker compose up --build
```

When using environment loaded by another tool such as `direnv`, run Compose through that tool:

```sh
direnv exec . docker compose up --build
```

The Compose file defines:

- `web`: Fastify API and Discord interactions service on port `3000`.
- `worker`: background Mongo job worker.
- `backend`: internal Docker network.

The checked-in Compose file includes deployment-specific public URLs. Adjust `WCL_REDIRECT_URI`, `DISCORD_INTERACTIONS_URL`, and `PUBLIC_URL` for the target beta environment before deploying elsewhere.

## HTTP Routes

| Route | Purpose |
| --- | --- |
| `GET /health` | Basic health check returning `{ "status": "ok" }`. |
| `POST /api/recap` | Fetch and normalize a report recap payload from a report code or URL. |
| `POST /discord/interactions` | Discord interaction webhook endpoint. |
| `GET /api/auth/wcl/status` | Inspect stored WCL user OAuth state. |
| `GET /api/auth/wcl/login` | Start WCL user OAuth. |
| `GET /api/auth/wcl/callback` | Complete WCL user OAuth. |

## Verification

Run the same checks used during beta hardening:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm -r build
```

Focused package checks are useful while working inside one package:

```sh
pnpm --filter @wcl/wcl-client test
pnpm --filter @wcl/discord test
pnpm --filter @wcl/domain test
```

## Operational Notes

- Discord requires interaction webhooks to acknowledge quickly. The web route defers the response and schedules the heavier WCL recap work after the HTTP response finishes.
- Report-wide table data is fetched from kill fight IDs and normalized into recap totals and top-player rows.
- Per-encounter boss rankings are fetched with bounded concurrency to reduce report latency without firing every boss request at once.
- Mongo report cache entries include payload versions so stale normalized/raw payload shapes can be refetched after parser changes.
- Logs are emitted through Pino with sensitive fields redacted by `@wcl/shared`.

## License

MIT.
