# Current State [Apr. 14, 2026 08:15AM]

## Right Now 

The discord bot has suffered extreme over engineering due to vibe-coding features; it's quite a learning curve keeping AI Agents on track while manually reviewing 1000s of lines of code its written or rewritten.

## What works (and doesn't) in Production & Development

Everything runs more or less; I'm able to invite the bot/install the app on a server I created for testing and run `/recap` with a link to a raid log recorded by my guild.
The embedded report looks like this:

![current-embed-sate](current-state.png)

- Docker spins up and creates a container successfully
- `app/web` & `app/worker` works
- `packages/wcl-client` works
- `packages/discord` works
- Uncertain if `packages/domain`, `packages/shared`, `packages/db` work as intended. (Hence the restructuring and refactoring to cut the overengineered bloat).
- All environment variables are called and used successfully hitting the necessasry endpoints for `Warcraft logs` and `cloudflare`, I suppose
- Uncertain how to get data structures/models routed to MongoDB Atlas.

## What repo says architecture should look like

Modular and focused layers/features; no overlapping or bearing too much responsibility.

## Current codebases' violations

- Bloat in `packages/wcl-client` (GraphQL client)
    - Excessive GraphQL queries and heavy normalization
    - Redundant probe scripts and fixtures

- Bloat in `packages/domain`
    - Overly broad domainmodels 
    - Drift from desired recap design

- Bloat in `packages/discord`
    - Complex command and preview infrastructure
    - Coupling presentation with domain logic

- Bloat in `apps/web`
    - Heavy server code with multiple responsibilities
    - Redundant features not needed for recaps

- Other sources of bloat 
    - Database and service modules
    - Configuration and subscription services

## What needs to keep working during refactor

- Calls to API endpoints
- Recap report generation
- OAuth callback

## Anything out of scope for this first pass?

- Don't think so.
