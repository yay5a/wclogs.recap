# Warcraft Logs-focused Discord companion app

This project provides a World of Warcraft raid recap generator, built to fetch data from Warcraft Logs
, normalize it into a structured domain model, and publish recap summaries to Discord or other targets. The refactored structure aims to be modular, maintainable, and aligned with a clear domain model.

## Overview

The system pulls data from Warcraft Logs, organizes it into four core domains, and then renders it via presentation adapters:

Outcome – progression status and extremes (boss kills, attempts, kill times, deaths).
Performance – highlights of top performers for kill-only data (best parsers, average parses, best single‑boss parse, most improved vs historical).
Volume – statistical summary of totals and extremes (overall damage, healing, damage taken, interrupts, dispels) and per‑fight standouts.
Execution – wipe analysis detailing top damaging mechanics, common death causes, and wipe signatures.

By cleanly separating these concepts, the recap generator stays focused and easy to extend.

## Repository Structure

wclogs.recap/
├── packages/
│   ├── transport/        # API clients and data-fetching logic
│   ├── domain/           # Domain models and builders for Outcome/Performance/Volume/Execution
│   ├── presentation/     # Presentation adapters (Discord embeds, web UI components, etc.)
│   └── app/              # Orchestration layer combining modules to generate a recap
├── apps/
│   ├── web/              # Optional web service (API endpoints, OAuth handling)
│   └── worker/           # Optional background workers (e.g. trend recompute, syncing)
├── .env.example          # Sample environment variables
├── docker-compose.yml    # Containerized development environment
└── README.md             # You are here

### Core Packages

| Package        | Purpose                                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport`    | Provides functions like `fetchReportSummary`, `fetchKillRankings`, `fetchSummaryTables`, and `fetchPlayerDetails`.  Handles OAuth token management and only minimal payload transformation.          |
| `domain`       | Contains domain entities (`Outcome`, `Performance`, `Volume`, `Execution`) and builders that transform raw data into these objects.  No external API calls or UI knowledge lives here.               |
| `presentation` | Converts domain objects into concrete outputs (Discord embeds, HTML fragments, etc.).  Each adapter is isolated; for example, the Discord adapter is unaware of web or Slack.                        |
| `app`          | Coordinates the flow: obtains data via `transport`, builds domain models via `domain`, and passes them to a `presentation` adapter for rendering.  It also handles configuration and error handling. |

### Setup

#### Prerequisites

Node.js 18+ with pnpm
; use corepack enable if pnpm is not globally installed.
MongoDB if you intend to persist data (optional; the app can run statelessly for simple recaps).
Discord bot token (optional, only if using the Discord adapter).
Warcraft Logs API credentials: you will need a client ID and client secret from Warcraft Logs API
. At runtime the app exchanges these for an OAuth bearer token.
Installation

#### Installation

```bash
# install dependencies
corepack enable
pnpm install

# copy environment template and set secrets
cp .env.example .env
# Edit .env with your WCL client ID/secret and Discord credentials
```

### Running Testing/Development

- **Transport layer tests**: fetch data from Warcraft Logs and print domain objects.

```bash
pnpm run dev:transport
```

- **Domain layer tests**: build domain objects from sample payloads and verify outputs.

```bash
pnpm run dev:domain
```

- **Discord bot**: start the bot locally and register commands in your development guild/server.

```bash
pnpm run dev:bot
```

- **Web API**(optional): start the API server if you need HTTP endpoints or OAuth flows

```bash
pnpm run dev:web
```

### Running in Production

- Use Docker to build and run the app in a container. The `docker-compose.yml` file includes services for the app, a worker, and MongoDB

```bash
# Pull images and start up services
docker compose up --build -d 

# For debugging
docker compose logs -f
```

## Usage

### Generating a Raid-log Recap through the CLI

A typical workflow to generate a recap of raid logs from a real-world log report:

```bash
pnpm run recap <reportCode>
```

This will:

1. Fetch/query the necessary data from the Warcraft Logs API using GraphQL queries and resolvers in `transport`.
2. Build the `domain` objects.
3. Render a Discord embed (default) via the `presentation` layer.
4. Optionally post the embed to a Discord channel/server.

Although the focus of this repo is on Discord, you can add new adapters under `packages/presentation` for other outputs. Each adapter should consume the domain objects and produce platform-specific payloads.

## Configuration

The project reads configurations from environment variables:
| Variable                    | Description                                          | Required?        |
| --------------------------- | ---------------------------------------------------- | ---------------- |
| `WCL_CLIENT_ID`             | Warcraft Logs client ID                              | Yes              |
| `WCL_CLIENT_SECRET`         | Warcraft Logs client secret                          | Yes              |
| `DISCORD_BOT_TOKEN`         | Token for your Discord bot                           | If using Discord |
| `DISCORD_PUBLIC_CHANNEL_ID` | ID of the channel where public recaps will be posted | If using Discord |
| `MONGODB_URI`               | MongoDB connection string                            | Optional         |
| `PREVIEW_STATE_TTL_SECONDS` | TTL for preview state caching in seconds             | Optional         |

Additional configuration (e.g. caching, TTLs, API endpoints) can be added in `.env` as needed

## Contributing

1. Fork the repository and create a feature branch.
2. Make your changes following the modular architecture:
    - Add or modify functions in packages/transport only for data fetching.
    - Adjust domain builders in packages/domain to compute new metrics or modify existing ones.
    - Update presentation adapters in packages/presentation to render new domain fields.
    - Keep cross‑cutting concerns (e.g. logging, error handling) confined to the app layer.
3. Run pnpm lint and pnpm typecheck to ensure code quality.
4. Submit a pull request.

## License

MIT -- see `License` for details.
