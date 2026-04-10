# AGENT.md

## Purpose

This repository is a TypeScript monorepo. Agents working in this repo must optimize for:
1. type safety
2. package boundaries
3. minimal diff radius
4. explicit contracts
5. build stability across the whole workspace

Do not trade long-term maintainability for short-term convenience.

---

## Required validation before considering work complete

Run the smallest relevant checks first, then the broader repo checks.

### Package-local
- `pnpm --filter <package> build`
- `pnpm --filter <package> test`

### Repo-wide
- `pnpm -r build`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

Do not claim success if TypeScript, lint, or tests are failing unless the task explicitly allows partial work.

---

## TypeScript rules

The repo already uses strict compiler settings. Treat them as design constraints, not obstacles.

### Mandatory rules
- Do not weaken TypeScript settings.
- Do not disable lint rules to make code pass.
- Do not use `any` unless absolutely unavoidable.
- Prefer `unknown` over `any`, then narrow.
- Prefer `satisfies` over broad `as Type` assertions.
- Prefer type guards, parser helpers, and explicit narrowing over casting.
- Do not use non-null assertions (`!`) unless there is a proven invariant and a short comment explaining it.
- Do not assign `undefined` to optional properties. Omit the property instead.
- Do not rely on unchecked indexed access. Narrow first.
- Add explicit return types for exported functions, package boundary functions, and parsers.
- Avoid boolean coercion for schema fields unless the semantic loss is intentional and documented.

### Forbidden shortcuts
- Broad `as unknown as X`
- silent fallback casts
- “temporary” weakening of types
- changing types to `string | undefined` / `number | undefined` just to silence errors when omission is the correct model

### JSON handling rule
All JSON-shaped external payloads are untrusted.
Parse them defensively, narrow them explicitly, and treat nested keys as optional unless proven otherwise.

This is especially important for Warcraft Logs payloads such as rankings, playerDetails, table, graph, and paginated event data.

---

## Package boundary rules

Respect the architectural boundaries implied by the workspace.

### `packages/shared`
- Generic utilities only
- No domain-specific business rules
- No database logic
- No Discord, web, or worker transport concerns

### `packages/domain`
- Pure domain types, normalization targets, and business logic
- No direct database models
- No transport-layer logic
- No raw external API calling

### `packages/db`
- Persistence and model concerns only
- No Discord/web presentation logic
- No external API parsing logic

### `packages/wcl-client`
- Warcraft Logs integration only
- Fetching, parsing, normalization, rate-limit handling, API-specific caching decisions
- No Discord command logic
- No web presentation logic
- No direct persistence side effects

### `packages/discord`
- Discord transport and interaction logic only
- No raw WCL payload parsing in command handlers if that logic belongs in `wcl-client`
- No database schema ownership

### `apps/worker`
- Orchestration, background processing, job coordination
- Can compose domain, db, and client packages
- Should not become a dumping ground for parsing or presentation logic

### `apps/web`
- Presentation and web-facing application behavior
- No Discord-specific logic
- No direct ownership of WCL parsing contracts

### Boundary rule
If logic can live in a lower, more reusable layer, it should not be implemented in a higher app layer.

---

## External API compliance rules

When working with external schemas or APIs:
- Treat documented nullable fields as nullable
- Treat scalar `JSON` fields as schema boundaries, not structured guarantees
- Do not invent nested contracts unless validated by parser logic
- Prefer partial normalization over unsafe certainty
- Preserve source semantics where useful, especially for archive status, in-progress state, and visibility rules

For Warcraft Logs specifically:
- `rankings`, `playerDetails`, `table`, `graph`, and event paginator `data` are JSON-backed and must be parsed defensively
- archived reports may restrict access to events/tables/graphs
- in-progress fights must not be treated as permanently stable data

---

## Change management rules

- One logical improvement per commit
- Preserve previously accepted changes in touched files
- Do not refactor unrelated code while making a targeted fix
- Keep diff radius as small as practical
- Add comments only when they explain invariants, contracts, or non-obvious tradeoffs
- Do not rewrite working code just because a different style seems nicer

When modifying a file that has already been changed in a prior phase:
- assume current checked-out contents are the source of truth
- do not revert or rewrite prior accepted changes unless required for correctness

---

## Infrastructure and repository hygiene rules

Agents should flag, not ignore:
- package boundary leakage
- config drift between tsconfig, eslint, tests, and runtime expectations
- hidden coupling between apps and packages
- caching rules that contradict external data mutability
- missing archive/rate-limit awareness for external APIs
- environment/config assumptions that only work locally
- weak observability around network, parsing, and background jobs

Do not confuse infrastructure problems with user-facing bugs.
Infrastructure problems include architectural fragility, unsafe contracts, coupling, missing enforcement, and operational risk.

---

## Output expectations for agent work

When proposing or applying changes:
- explain the contract being enforced
- identify any assumptions
- identify any remaining uncertainty
- prefer incremental work over sweeping rewrites
- if the schema does not guarantee something, say so explicitly
