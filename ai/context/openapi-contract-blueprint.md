# Blueprint: Single OpenAPI Contract — Foundation + Pilot

**Status:** Foundation and pilot slice (`manager/profile`) implemented and green. Remaining ~20 slices not started.

Read [`openapi-contract-goal.md`](openapi-contract-goal.md) first for _why_, and [`openapi-contract-checklist.md`](openapi-contract-checklist.md) for the enumerated _what_. This file is the _how_ — the pattern every remaining slice follows.

---

## Decisions made (and why)

These resolve the open questions the goal doc left to a blueprint.

| Decision                                              | Rationale                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contracts/` at repo root, own npm package            | Matches the goal doc. Backend cannot relatively import from outside `src/` (`backend/tsconfig.json` sets `rootDir: ./src`), so it consumes the contract as a package. See "Vendoring" below for how it reaches the Lambda bundle.          |
| Backend imports Zod **through** `@daltime/contracts`  | The package re-exports `z` and `ZodError`. Two copies of Zod would break `instanceof ZodError` in the error mapper. Do not add `zod` to `backend/package.json`.                                                                            |
| Typed wrapper over `HttpClient`, not `openapi-fetch`  | `openapi-fetch` uses `fetch`, which bypasses `auth.interceptor.ts` and `impersonation.interceptor.ts` entirely — every request would silently lose its auth and impersonation headers. `ApiClient` is fully contract-typed and keeps them. |
| Entity schemas live in `contracts/src/entities/`      | `shared/models/**` mixes stored-item shapes (with `PK`/`SK`) and wire shapes. Entities model the table; API schemas derive from them via `apiShapeOf()` (which `.omit()`s the key fields), mirroring `stripKeys()` at runtime.             |
| Metadata is **required**, enforced at generation time | The goal doc calls file-path / purpose / query hard requirements. `registerOperation` throws when they are missing, so a thin entry fails the build instead of quietly shipping.                                                           |
| OPTIONS routes are not registered                     | Every route has a CORS preflight event in `template.yaml`, but they carry no shape and no DynamoDB access. ~30 empty operations would dilute the access-pattern audit.                                                                     |
| Generated files are formatter- and linter-exempt      | `.prettierignore` and an eslint `ignores` entry cover them. Otherwise lint-staged reformats generated output and the CI drift check fails on files nobody edited.                                                                          |

## Layout

```
contracts/
  package.json            @daltime/contracts — zod, zod-openapi
  openapi.json            GENERATED, COMMITTED — the artifact everything reads
  src/
    registry.ts           registerOperation() + the metadata contract
    generate.ts           writes openapi.json
    index.ts              barrel; side-effect imports register operations
    entities/
      keys.ts             SingleTableKeys, apiShapeOf()
      manager.ts          ManagerRecord  (replaces shared/models/org-admin/manager.model.ts)
    schemas/
      common.ts           UserStatus, IsoTimestamp, ErrorResponse, errorResponses
      manager/profile.ts  PILOT — schemas + registerOperation calls

backend/src/functions/shared/
  contract-validation.ts  parseWithContract(): ZodError -> ValidationError -> 400

frontend/src/app/core/
  generated/api.d.ts      GENERATED, COMMITTED — do not hand-edit
  api/api-client.ts       typed HttpClient wrapper; ApiSchema<'Name'> alias
```

## Vendoring: how the contract reaches the Lambda bundle

This is the least obvious part of the setup, and the one most likely to be "simplified" into breakage.

SAM's `NodejsNpmEsbuildBuilder` copies **only the function's CodeUri** (`backend/`) into a scratch directory and runs `npm install` there. A dependency declared as `file:../contracts` dangles in that copy, and the build fails with `Could not resolve "@daltime/contracts"`.

So `backend/scripts/sync-contracts.mjs` builds the contract package and mirrors `dist/` plus a minimal manifest into **`backend/vendor/contracts/`**, and `backend/package.json` depends on `file:vendor/contracts`. Being inside the CodeUri, it is copied with everything else and resolves normally. `backend/vendor/` is gitignored — `contracts/` stays the only place contract source is edited.

Consequences to respect:

- **`npm ci` in `backend/` requires `vendor/contracts` to already exist.** Order is always: install `contracts/` → `node backend/scripts/sync-contracts.mjs` → install `backend/`. This ordering is encoded in `.github/workflows/ci.yml` and `.vscode/tasks.json`.
- `pretest` / `prebuild` in `backend/package.json` run the sync automatically, so `npm test` and `npm run build` are self-sufficient once installed. Anything calling `sam build` directly is not.
- After changing a schema, re-run the sync (or just `npm test`) before `sam build`, or the Lambda bundles a stale contract.

Verified: `sam build` succeeds and the emitted `handler.mjs` inlines both the Zod runtime and the schema (no unresolved bare import), so validation genuinely runs in Lambda.

## Per-slice migration recipe

Work one vertical slice at a time. A slice is done when every checklist box in its group is ticked.

**1. Read the implementation first.** Open the slice's `handler.ts`, `service.ts`, and `db.ts`. The `x-dynamodb-access` metadata must describe what `db.ts` _actually does_ — every command, index, key condition, and filter, in order. This is the half of the work that cannot be guessed; getting it wrong poisons the access-pattern audit that motivates the whole migration.

**2. Add the entity schema** to `contracts/src/entities/<entity>.ts` if the slice reads or writes an entity that has no schema yet. Port the doc comment describing the PK/SK/GSI layout — it is the most valuable part of the old model file.

**3. Add the operation schemas** in `contracts/src/schemas/<role>/<feature>.ts`:

```ts
export const XResponse = XApiFields.meta({ id: 'XResponse', description: '…' });

registerOperation('get', '/role/feature', {
  operationId: 'getX',
  summary: '…',
  tags: ['role'],
  purpose: '…',                    // required — what screen/feature this serves
  implementation: ['backend/src/functions/role/feature/handler.ts', …],  // required
  dynamodb: [{ command: 'Query', index: 'GSI1', keyCondition: 'GSI1PK = … AND begins_with(GSI1SK, …)' }], // required
  requestBody: { required: true, content: { 'application/json': { schema: XBody } } },
  responses: { 200: { …, content: { 'application/json': { schema: XResponse } } }, ...errorResponses },
});
```

**4. Register the module** in `contracts/src/index.ts` — both the side-effect import and the re-export. A schema file not imported there is invisible to the generated spec.

**5. Regenerate and commit:**

```bash
cd contracts && npm run generate
cd ../frontend && npm run contracts:types
```

**6. Point the backend at the contract.** Replace `shared/models/**` type imports with `@daltime/contracts`, and wire request validation. For handlers built by a factory, thread the schema through the factory (see `createProfileHandler`'s `bodySchema` parameter); for hand-written handlers, call `parseWithContract(Schema, parsed.data)` after `parseBody`.

**7. Point the frontend at the contract.** Replace the service's `HttpClient` usage with `ApiClient`, and its `core/models/**` imports with `ApiSchema<'Name'>`. Delete the hand-written model file once nothing imports it.

**8. Verify:**

```bash
cd backend && npm test
cd ../frontend && npm test && npx tsc -p tsconfig.app.json --noEmit
git diff --exit-code -- contracts/openapi.json frontend/src/app/core/generated/   # must be clean after regenerating
```

## Gotchas found while building the pilot

- **Files under `shared/models/` can only be deleted once _every_ consuming slice is migrated.** `manager.model.ts` is still imported by `org-admin/managers` and others, so it survives the pilot despite `ManagerRecord` now existing in the contract. Deleting these is a late step, not a per-slice one.
- **Zod strips unknown request keys rather than rejecting them**, and zod-openapi correctly reflects that by omitting `additionalProperties: false` on input schemas while emitting it on response schemas. Do not "fix" this with `.strict()` without checking the spec still matches runtime.
- **`npm ci` does not build a `file:` dependency**, and SAM cannot see one outside the CodeUri at all — see "Vendoring" above. This cost a `sam build` failure during the pilot; it is the single most important thing to not regress.
- **`z.iso.datetime()` emits a `pattern` that requires a `Z` suffix.** That matches `new Date().toISOString()`, which is what every `db.ts` writes — but a hand-rolled timestamp with an offset would fail validation.
- **Response schemas get `additionalProperties: false`.** Responses are not currently validated at runtime, so this is documentation only; do not start validating responses without checking that Cognito enrichment does not add fields.

## Definition of done — status

- [x] Contract package generating a committed `openapi.json` with required `x-implementation-path` / `x-dynamodb-access` metadata
- [x] Backend request validation sourced from the contract
- [x] Frontend consuming generated types via a fully typed client that preserves interceptors
- [x] CI fails the build on contract/generated drift
- [x] Pilot slice (`manager/profile`) migrated end-to-end, tests green
- [ ] Remaining ~20 vertical slices migrated
- [ ] `backend/src/functions/shared/models/` deleted
- [ ] `frontend/src/app/core/models/` deleted
- [ ] DynamoDB access-pattern audit run against the completed contract; `docs/dynamodb-entity-map.md` updated
