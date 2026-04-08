# Working Agreements

## Conventions
- Use strict TypeScript and avoid `any` unless guarded by runtime checks.
- Keep Discord transport concerns in `packages/discord`; business logic lives in domain packages.
- Prefer composable services over large classes.
- Keep dependencies minimal.

## Implementation Notes
- MVP is read-only with external providers except Discord command registration.
- Incomplete integrations must be marked with explicit TODO comments and documented in README.
- Worker queue is MongoDB-backed for now; no Redis in this phase.

## Quality Gates
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before commit.
