# Compare Modes MVP Blueprint

## Product Intent

`/config compare_mode` is a guild-level fallback default. It should answer:

- Which comparison policy should commands use when no command-level mode is provided?
- What policy should recap internals record as metadata for future comparison work?

It is not the primary rich comparison feature.

The intended command direction is:

- `/recap url:<report_url>` stays clean, channel-friendly, and concise.
- `/recap url:<report_url> compare_mode:<character|mixed>` may later allow an explicit override, but should not become the rich comparison surface.
- `/compare report:<report_url> character:<name-or-id> mode:<character|mixed>` is the targeted comparison surface.

`/compare` should be private/ephemeral by default. A later "post summary" flow can be added after the private comparison experience is reliable.

## Compare Modes

`character` means exact character history only.

- Use the current report participant identity.
- Prefer a stable character ID when normalized data provides one.
- Otherwise use `participantKey` built from normalized region, realm/server, and character name.
- If required identity fields are missing, return a non-comparable status instead of guessing.

`mixed` means mapped player history only.

- Require an explicit player-character mapping such as `playerProfileId`.
- Do not compare by display name, similar character name, shared realm, or other inferred identity.
- If mapping is missing, return `missing-player-mapping`.
- Do not compute mixed baseline deltas when mapping is missing.
- If a character-only fallback is ever displayed later, it must be explicitly labeled as a character-only fallback.

No mode may auto-detect alts, fuzzy-match names, infer player identity from similar names, or merge identities from Discord display names.

## MVP Metrics

Use only normalized fields that already exist or can be derived from existing parser outputs.

Prioritized metrics:

- Parse delta vs baseline, when `rankPercent` exists.
- Damage total delta vs baseline, when damage total exists.
- Healing total delta vs baseline, when healing total exists.
- Deaths delta.
- Interrupts delta.
- Dispels delta.
- Best boss and lowest boss from the current report only, when already available.
- Sample size.
- Comparison mode and identity status.

Do not label raw damage/healing totals as DPS/HPS. Use:

- `damage total`
- `healing total`

Only use DPS/HPS labels when the source metric is actually DPS/HPS.

Best boss and lowest boss are current-report context only for MVP. Do not build same-boss historical comparison until stable historical boss-level snapshots exist.

## Trust And Thresholds

Put MVP thresholds in a small domain constants module, not inline across command handlers, DB stores, or renderers.

Initial constants:

- `trustedSampleSize: 3`
- `historyLimit: 5`
- `parseNearPercentilePoints: 5`
- `outputNearPercent: 10`
- `countNearDelta: 1`

Baseline behavior:

- Query up to the last 5 matching historical snapshots before the current report.
- Use 0 samples as `no-history`.
- Use 1-2 samples as `insufficient-history`.
- Use 3 or more samples as trusted enough for above/below/near labels.
- Missing metrics are unavailable, not zero.
- Zero is only zero when the source value is actually zero.

MVP wording:

- Parse is near baseline within 5 percentile points.
- Damage/healing totals are near baseline within 10%.
- Deaths, interrupts, and dispels are near baseline within 1 count.

## Snapshot Persistence Shape

Use a separate minimal comparison snapshot store. Do not use raw Warcraft Logs payloads for comparison history, and do not couple MVP comparison queries to trend snapshots.

Snapshot identity:

- Use `participantKey` as the per-report snapshot identity.
- Prefer stable character ID if available from normalized participant data.
- Otherwise build `participantKey` from normalized region, realm/server, and character name.
- Do not use a vague character display name as the persisted identity.

Unique index:

- `guildId + reportCode + participantKey`

Recommended query indexes:

- `guildId + participantKey + reportStartedAt`
- `guildId + playerProfileId + reportStartedAt`, if explicit player mappings are present

Minimal snapshot fields:

- `guildId`
- `reportCode`
- `sourceId` or source URL if already available in the flow
- `reportStartedAt`
- raid/zone metadata when available
- `participantKey`
- stable character ID when available
- character name
- normalized region
- normalized realm/server
- class/spec/role when available
- `playerProfileId` only when explicitly mapped
- parse percentile when available
- damage total when available
- healing total when available
- deaths
- interrupts
- dispels
- current-report best/lowest boss context when already available
- created/updated timestamps

Bounded history lookup:

- Filter by `guildId`.
- For `character`, filter by `participantKey`.
- For `mixed`, filter by explicit `playerProfileId`.
- Filter to snapshots before the current report timestamp.
- Sort newest first.
- Limit to `historyLimit`.
- Project only fields needed for comparison math and rendering.
- Return an empty array safely when no history exists.

## Probe And Field Grounding

Use `/home/_yaysa/dev/wcl-probes/probes/` only when it exists in the environment. In this environment it is available.

The probe payloads ground the MVP fields:

- Rankings payloads include `rankPercent` and `amount`.
- Report-wide table payloads include player totals for damage and healing.
- Death table payloads include death event rows that can be counted.
- Interrupts and dispels table payloads include nested detail rows with per-player totals.

If the probe directory is unavailable in a future environment, inspect existing repo fixtures, parser tests, normalized report types, and parser outputs instead. Do not invent fields.

## Architecture Plan

Planned domain modules:

- `comparison/compare-mode.ts`: compare mode constants, parser, default, and source metadata.
- `comparison/constants.ts`: MVP history and near-baseline thresholds.
- `comparison/identity.ts`: target resolution, `participantKey`, explicit mapping checks, and identity status.
- `comparison/snapshot.ts`: pure extraction of comparison snapshots from normalized reports.
- `comparison/baseline.ts`: pure baseline averages, deltas, sample-size status, and near/above/below labels.
- `comparison/build-comparison.ts`: targeted comparison view model builder.

Planned DB modules:

- Comparison snapshot model and indexes.
- Comparison history store interface implementation.
- Bounded save and lookup methods with projections.

Planned Discord modules:

- `/compare` command registration.
- Small command handler that fetches current report, resolves target and mode, loads history, calls domain builder, and returns an ephemeral response.
- Separate compare renderer that formats an already-built view model.

Package boundaries:

- Domain logic must not depend on Discord rendering.
- DB stores must not depend on Discord rendering.
- Discord command handling must not own comparison math.
- Warcraft Logs client should fetch and normalize only.

## Privacy And Trust Guardrails

- Private/ephemeral output by default.
- No public callouts by default.
- No blame wording.
- No automatic alt detection.
- No fuzzy matching.
- No speculative failure or accountability claims.
- Missing data must be stated clearly.
- Sample size must be visible anywhere comparison claims are rendered.
- Mixed-mode claims require explicit mapping.

## Non-Goals

- No full trend dashboard.
- No public spreadsheet output.
- No side-by-side character and mixed output in posted recaps.
- No same-boss historical comparison until stable boss-level snapshots exist.
- No speculative metrics such as avoidable damage, overhealing, mitigation, external cooldowns, assignment-aware interrupts, mechanic failures, gear normalization, or spec-specific cast analysis.
- No raw Warcraft Logs payload persistence for comparison history unless that is already part of the intentional cache path.
- No architecture rewrite.
- No changes that make `/recap` noisy.
