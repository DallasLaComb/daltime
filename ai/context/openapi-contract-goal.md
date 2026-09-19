# Goal: Single OpenAPI Contract for Frontend + Backend

**Status:** Foundation + pilot complete (5 / 152 files). The `contracts/` package, generation, CI drift check, and typed frontend client are built, and `manager/profile` is migrated end-to-end. The remaining ~20 vertical slices are not started. Read this file at the start of any session working on this initiative before writing code.

**Companion files:**

- [`ai/context/openapi-contract-blueprint.md`](openapi-contract-blueprint.md) — the approved _how_: decisions made, layout, and the per-slice migration recipe. Follow this when migrating a slice.
- [`ai/context/openapi-contract-checklist.md`](openapi-contract-checklist.md) enumerates every one of the 152 backend/frontend files this migration touches, grouped by vertical slice, as checkboxes. Read the goal (this file) first for _why_ and _what "done" means_, then work the checklist so no slice gets missed.

---

## The problem today

Request/response shapes are hand-written twice, independently, and can drift silently:

- **Backend:** interfaces live in `backend/src/functions/shared/models/` (and scattered per-feature types under `backend/src/functions/<role>/<feature>/`).
- **Frontend:** the same shapes are hand-written again in `frontend/src/app/core/models/`.

Nothing catches it if these two drift apart — a backend field rename only shows up as a runtime bug in the frontend, not a build error.

Separately: DynamoDB is single-table design (see `docs/dynamodb-entity-map.md`), and query/access-pattern design requires knowing every access pattern the API needs to serve. Today those access patterns are implicit — scattered across ~20+ `db.ts` files, one per vertical slice, under `backend/src/functions/<role>/<feature>/`. There's no single place to look to answer "what are all the queries this API needs to support?"

## The goal

**One OpenAPI contract that both frontend and backend generate from — fully, across every vertical slice, not a partial or opt-in pattern.** This is a commitment to finish, not an experiment we might stop after one slice:

1. **Backend and frontend types are 100% generated from the same source, with zero hand-written duplicates left.** Every hand-written interface in `backend/src/functions/shared/models/` and `frontend/src/app/core/models/` is replaced. Change the contract, regenerate, and both sides get compiler errors if they haven't caught up — instead of the current silent-drift risk.
2. **All data schemas and query shapes are visible in one file, for every route in the system.** A single `openapi.json`/spec becomes the enumerated list of every access pattern the API serves — every request/response shape, every path, every operation, across all ~20+ vertical slices, not just a pilot subset. This is meant to make future DynamoDB single-table design work easier: instead of reading 20+ scattered `db.ts` files to figure out what queries the app actually needs, that list should be readable from the contract in one pass, then used to evaluate/redesign partition keys, sort keys, and GSIs against the _real, complete_ set of access patterns rather than a partial mental model built file-by-file.

### Definition of done

This initiative is not finished until all of the following are true — in practice, this means every box in `openapi-contract-checklist.md` is checked:

- [ ] Every backend vertical slice defines its request/response shapes as Zod schemas registered into the contract — none left using the old hand-written model files.
- [ ] `backend/src/functions/shared/models/` (and any other hand-written duplicate backend types) is deleted, not just deprecated.
- [ ] `frontend/src/app/core/models/` hand-written duplicates are deleted; the frontend consumes only generated types (see rollout — the generated client itself is the target, not just types).
- [ ] The committed contract file contains every operation in the system, each with the file-path / purpose / actual-query metadata described below — not just the pilot slice.
- [ ] A DynamoDB access-pattern audit has been run against the completed contract and `docs/dynamodb-entity-map.md` updated accordingly.
- [ ] CI fails the build if the contract and either side's generated output drift out of sync (generation is enforced, not a manual "remember to run this" step).

### What each operation entry must capture

Plain OpenAPI (path, method, request/response schema) tells you the HTTP contract but not how the data actually gets fetched. For point 2 above to actually work — a session gets the _full_ picture from one file, without opening every `db.ts` — each operation in the contract needs to carry, alongside the standard OpenAPI fields:

- **File path(s)** — where the handler/service/db code that implements this operation actually lives (e.g. `backend/src/functions/manager/profile/{handler,service,db}.ts`), so the contract points straight at the implementation instead of requiring a repo-wide search.
- **Purpose** — a plain-language description of why this operation/query exists and what feature or screen it serves (OpenAPI's native `description` field, but treated as a hard requirement per operation, not optional).
- **The actual query** — the real DynamoDB operation behind this API call: which table/index, the key condition (PK/SK or GSI PK/SK), and any filter expression. Not just "returns a list of shifts" but e.g. "Query on GSI1: `GSI1PK = ORG#<orgId>`, `GSI1SK begins_with SHIFT#`".

OpenAPI supports vendor extension fields (any key prefixed `x-`) on operations specifically for this kind of thing, so this metadata can live in the _same_ generated `openapi.json` rather than a separate doc — e.g. `x-implementation-path`, `x-dynamodb-query`. The exact field names/shape are a blueprint decision, not decided here — this section just records that the requirement exists and must survive into whatever generation approach gets picked.

## Why this matters for AI-assisted sessions specifically

The second point above is the main reason this is worth doing, not just "nice to have type safety." A single contract file is something a Claude Code session can read in one pass to get a complete picture of every API operation and every data shape, instead of having to explore dozens of handler/service/db files across every role/feature directory to reconstruct that picture from scratch each session. That directly enables better-informed DynamoDB query/index design — the recommendation is only as good as how completely the access patterns are known, and today that requires a lot of manual exploration per session.

## Non-goals

Only one thing is actually out of scope — everything else below is a _sequencing_ decision (see rollout), not a scope cut:

- **Not** migrating `infra/template.yaml` to define routes via OpenAPI `DefinitionBody`. SAM's current shorthand (`Events: Api: Path/Method:` per function) stays as the deploy mechanism. The generated OpenAPI spec is a types/validation/documentation artifact, not a replacement for how routes get deployed. This is orthogonal to full type/contract automation and isn't required to finish this goal.

Explicitly **not** non-goals (i.e., these ARE the target end-state, not optional stretch goals):

- A fully generated Angular HTTP client (e.g. via `openapi-fetch` or `ng-openapi`), not just generated types with hand-written services on top. Existing interceptors (auth, impersonation) need to keep working with whatever client shape is chosen, but "generate types only, hand-write the client forever" is not the finish line.
- Migrating all ~20+ vertical slices, not just a pilot subset. The pilot (see rollout) proves the pattern before scaling it — it does not define the scope.

## Candidate approach (researched, not yet approved as a blueprint)

This is the direction that came out of research into how other TypeScript-both-sides projects solve this — captured here so a future session doesn't have to re-research it, but it is **not locked in** until a blueprint is written and approved per this repo's normal `@new-lambda` workflow.

1. **Zod schemas as the source, not hand-written OpenAPI YAML.** Define request/response shapes as Zod schemas (new dependency, not currently used anywhere in this repo). Zod schemas double as runtime validators _and_ type generators (`z.infer<>`), so backend handlers get request validation for free instead of just types.
2. **Generate the OpenAPI spec from the Zod schemas** via `zod-openapi` or `@asteasolutions/zod-to-openapi`. Commit the generated `openapi.json` so changes are reviewable in PR diffs. The registration step for each operation must also supply the file-path / purpose / actual-query metadata described above (see "What each operation entry must capture") — both libraries support attaching arbitrary extra fields (including `x-*` vendor extensions) alongside the request/response schema during registration, so this isn't a separate pass.
3. **Backend** imports the Zod schemas directly as TypeScript source (no build step needed — esbuild already bundles this the same way it bundles everything else today).
4. **Frontend** generates types from the committed `openapi.json` via `openapi-typescript`, into a clearly-marked generated directory (e.g. `frontend/src/app/core/generated/`) that nothing hand-edits. Existing services keep using those types the same way they use `core/models/` today.
5. **Where the shared contract lives:** a new `contracts/` folder at the repo root (not a full npm-workspaces migration — plain relative imports are enough for a single repo like this one).

## Rollout plan (not yet started) — sequenced, but the end state is full migration

The pilot exists to validate the pattern cheaply before committing 20+ slices to it — it is a sequencing step, not a decision gate about whether to finish. Barring the pilot surfacing a real blocker, the plan is to carry this through to the full definition of done above.

1. Write and get approval for a proper blueprint (per this repo's `@new-lambda`/`@blueprint-review` conventions) before touching any code.
2. **Pilot on one small vertical slice first** — e.g. `manager/profile` — to prove the pattern end-to-end (Zod schema → generated OpenAPI with file-path/purpose/query metadata → generated frontend types → working request/response). Treat this as validating _how_, not _whether_.
3. **Migrate every remaining vertical slice** to the same pattern, role by role, until none are left on hand-written models.
4. **Delete the hand-written duplicates** (`backend/src/functions/shared/models/`, `frontend/src/app/core/models/`) once nothing depends on them.
5. **Wire generation into CI** so the contract and both sides' generated output can't silently drift (e.g. a CI step that regenerates and fails the build on a diff).
6. **Run the DynamoDB access-pattern audit** against the now-complete contract and update `docs/dynamodb-entity-map.md` accordingly — this was the other half of the original motivation and only works once the contract actually covers every operation.

## Relevant existing files to read before starting implementation

- `backend/src/functions/shared/models/` — current hand-written backend types being replaced
- `frontend/src/app/core/models/` — current hand-written frontend types being replaced
- `infra/template.yaml` — current route definitions (SAM shorthand, staying as-is)
- `docs/dynamodb-entity-map.md` — current DynamoDB single-table design, the thing this should ultimately help improve
- `ai/prompts/backend.md` / `ai/prompts/ui.md` — existing conventions any new pattern must fit within
