# OpenAPI Contract Migration — Gameplan

**For a solo dev driving AI agents.** This file is both the tracker and the briefing doc.
Start every wave by pasting it (or the relevant section) into your agent's context so it
doesn't rediscover the architecture from scratch.

**Current state:** 37 of 97 real operations have contracts. 7 frontend services are already on
`ApiClient`; 17 remain on raw `HttpClient`. The hard part is done — the pattern works and has
survived contact with real code. What remains is repetition, and this doc exists to make each
repetition cheap.

---

## 0. Architecture in one paragraph (read this first, every session)

`contracts/src/` holds Zod schemas — registered via `registerOperation()` in the
role barrels (`contracts/src/schemas/<role>/index.ts`). `npm run generate -w contracts`
produces the committed `contracts/openapi.json`. The backend imports the built package
via `file:vendor/contracts` (synced by `backend/scripts/sync-contracts.mjs` — SAM's esbuild
can't reach outside `backend/`). The frontend generates types with
`npm run contracts:types -w frontend` → `frontend/src/app/core/generated/api.d.ts`, consumed
through `frontend/src/app/core/api/api-client.ts` (typed `ApiClient` + `ApiSchema<'X'>` helper).
Routes live ONLY in `infra/template.yaml` (`Path:`/`Method:` per function) — never search
`backend/src` for routes.

## 1. The One Command

Run this after ANY contract edit. It catches breakage the moment it happens, not at deploy:

```bash
node contracts/scripts/contracts-sync.mjs
```

(There's no root `package.json`, so `npm -w` doesn't exist; run the script directly. It's also
aliased as `npm run sync` if you're already `cd contracts`.)

It runs five steps and stops at the first failure (`contracts/scripts/contracts-sync.mjs`):

1. **contracts** generate — Zod schemas → `contracts/openapi.json`
2. **backend** sync-contracts — built package → `backend/vendor/contracts`
3. **backend** `tsc --noEmit` — catches handlers broken by the shape change
4. **frontend** contracts:types — openapi.json → `core/generated/api.d.ts`
5. **frontend** `ng build` — catches components/services broken by it

If both typechecks pass after a schema change, the frontend and backend agree on the shape.
That is the entire value of this system.

## 2. Definition of Done — per operation

- [ ] Request + response Zod schema in `contracts/src/schemas/<role>/<feature>.ts`,
      registered in that role's `index.ts` barrel
- [ ] Backend handler validates with that schema via
      `backend/src/functions/shared/contract-validation.ts`; no duplicate local types
- [ ] Operation present in generated `openapi.json` (`npm run check -w contracts` is green)
- [ ] All frontend call sites go through `ApiClient` (zero raw HttpClient for the route)
- [ ] Bruno request exists under `bruno/`
- [ ] Obsolete hand-written types deleted (do this in the SAME PR, not a later sweep)

## 3. Current Inventory — ground truth as of 2026-09-20

### Spec coverage

| Metric | Value |
|---|---|
| Real (non-OPTIONS) routes in `infra/template.yaml` | 97 |
| Operations in `openapi.json` | 37 |
| Missing | **60** |
| Paths with zero contract coverage (whole domains) | 31 |

### Frontend client adoption

| Status | Count | List |
|---|---|---|
| ✅ On `ApiClient` | 7 + shared | employee (swap-shifts, availability, profile, schedule/shifts), manager/profile, org-admin (employees, managers), **shared/notifications** |
| ⬜ Raw `HttpClient` | 17 | §4 inventory below |

> **Correction to the old snapshot:** `notifications.service.ts` **already uses `ApiClient`**
> (it injects `ApiClient`, not `HttpClient` — the old §3 regex matched its doc comments).
> The former "task #1" is **done**. Do not redo it. The real task-1 scope is only the
> `MarkOneNotificationPathParams` path-param schema (§5 below) plus Bruno files.

### The missing 60, grouped by domain (this is the real backlog)

Each domain = one PR. Ordered by suggested attack order.

| # | Domain | Ops | Frontend service(s) unblocked | Effort |
|---|---|---|---|---|
| 1 | notifications path-params (`/…/notifications/{id}` PATCH ×4 roles) | 4 | — (already on client) | 30 min |
| 2 | org-admin profile (`GET/PUT /org-admin/profile`) | 2 | `org-admin/profile/profile.service.ts` | S |
| 3 | org-admin organization (`GET/PUT /org-admin/organization`) | 2 | `org-admin/organization/organization.service.ts`, legacy `app/services/organization.service.ts` | S |
| 4 | manager employees (`GET/POST /manager/employees`, `PUT/PATCH/DELETE …/{employeeId}`) | 5 | `manager/employees/employees.service.ts` | M |
| 5 | manager employee-availability read (`GET …/{employeeId}/availability`, `…/availability/overrides`, `PATCH …/{employeeId}`) | 3 | `manager/schedule/employee-availability.service.ts` | S |
| 6 | manager locations (`GET /manager/locations`) | 1 | `manager/shifts-needed/locations.service.ts` | S |
| 7 | manager shifts (`GET/POST /manager/shifts`, `PUT/DELETE …/{shiftId}`) | 4 | `manager/schedule/shifts.service.ts`, `org-admin/schedule/shifts.service.ts` | M |
| 8 | manager shifts-needed (`GET/POST`, `PUT/DELETE …/{shiftId}`) | 4 | `manager/shifts-needed/shifts-needed.service.ts` | M |
| 9 | manager schedule (generate, publish, drafts, meta) | 4 | `manager/schedule/schedule.service.ts` | M |
| 10 | org-admin locations (CRUD + employee/manager assignment, 10 ops) | 10 | `org-admin/locations/locations.service.ts`, `managers/manager-locations.service.ts`, `employees/employee-locations.service.ts` | L |
| 11 | org-admin shifts (`GET /org-admin/shifts`) | 1 | `org-admin/schedule/shifts.service.ts` | S |
| 12 | web-admin profile (`GET/PUT /web-admin/profile`) | 2 | `web-admin/profile/profile.service.ts` | S |
| 13 | web-admin employees (`GET/PATCH /web-admin/employees`) | 2 | `app/services/web-admin-employees.service.ts` | M |
| 14 | organizations root (`GET/POST /organizations`, `GET/PUT/PATCH/DELETE …/{orgId}`) | 6 | legacy `app/services/org-admins.service.ts` + org-list screens | M |
| 15 | web-admin org-admins (`GET/POST/PATCH/DELETE /web-admin/organizations/{orgId}/org-admins[/…]`) | 4 | folded from #14's screens | M |
| 16 | web-admin impersonate (users, context, `{proxy+}` — 6+ ops) | 6 | `web-admin/impersonate/impersonate.service.ts` | L (see gotcha) |
| 17 | web-admin generate-dummy-data (`POST /web-admin/generate-dummy-data`) | 1 | `web-admin/generate-dummy-data.service.ts` | S |
| — | `GET /health` | — | excluded: infra-only caller | — |

Notes on order: #1–#5 are quick wins that shrink the diff fast and keep momentum; #7–#9 are
the scheduling heart of the app and unblock the most valuable screens; #16 (impersonate) is
last among feature work because `{proxy+}` needs a deliberate decision (§6).

## 4. Raw-HttpClient services to migrate (17)

Each migrates onto `ApiClient` in the same PR where its domain's contracts land (never before).

- **org-admin:** `profile/profile.service.ts` (#2), `organization/organization.service.ts` (#3),
  `locations/locations.service.ts` + `managers/manager-locations.service.ts` +
  `employees/employee-locations.service.ts` (#10), `schedule/shifts.service.ts` (#7/#11)
- **manager:** `employees/employees.service.ts` (#4), `schedule/employee-availability.service.ts` (#5),
  `shifts-needed/locations.service.ts` (#6), `schedule/shifts.service.ts` (#7),
  `shifts-needed/shifts-needed.service.ts` (#8), `schedule/schedule.service.ts` (#9)
- **web-admin:** `profile/profile.service.ts` (#12), `impersonate/impersonate.service.ts` (#16),
  `generate-dummy-data/generate-dummy-data.service.ts` (#17)
- **legacy `app/services/`:** `organization.service.ts` (#3), `web-admin-employees.service.ts` (#13),
  `org-admins.service.ts` (#14) — consider folding these into their feature folders while touching them

Infra exclusions (leave raw): `app.config.ts` (HttpClient provisioning/interceptors), `*.spec.ts`
(update mocks only as each service moves), `core/api/**` itself, and the `getHealth` caller.

## 5. Immediate next actions

1. ~~Add the sync script~~ — ✅ done (`node contracts/scripts/contracts-sync.mjs`, §1).
   First run **surfaced a real pre-existing bug** the manual flow never typechecked:
   `web-admin/profile/db.ts(30)` passed index-signature-less `WebAdminMetadata` to
   `getMetadataRecord<T extends Record<string, unknown>>`. Fixed by bridging through
   `Record<string, unknown>` (same pattern as `web-admin/shared/db.ts`). Chain is green.
2. **Use the stepped agent protocol in §10.** Each step is one self-contained agent
   session that ends with a green `node contracts/scripts/contracts-sync.mjs` and a
   single reviewable commit. When you are ready, say `ok start step N` and the agent
   executes that step, updates the tracker below, and commits.
3. After each step merges, rerun the §7 discovery probes and refresh the §3 inventory
   numbers.

## 6. Agent prompt template — copy per task

Paste this + the file paths listed into a fresh agent session for each domain:

> Migrate the **<domain>** slice of DalTime to contract-driven types, using
> `contracts/checklist.md` as the reference doc.
>
> Architecture: Zod schemas live in `contracts/src/schemas/<role>/`, registered via
> `registerOperation()` in that role's `index.ts` barrel. Generated outputs —
> `contracts/openapi.json`, `backend/vendor/contracts/`, `frontend/src/app/core/generated/api.d.ts`
> — are DERIVED; never hand-edit them. Routes are declared in
> `infra/template.yaml` (Path:/Method:), not in backend code.
>
> Do, in order:
> 1. Read `backend/src/functions/<role>/<feature>/` (handler, service, db) and the frontend
>    service `<service file>` to extract the real request/response shapes.
> 2. Write/refine Zod schemas in `contracts/src/schemas/<role>/<feature>.ts` mirroring
>    an existing finished slice, e.g. `contracts/src/schemas/employee/profile.ts`.
> 3. Register the ops in the role barrel `index.ts`.
> 4. Wire backend validation with the schema via
>    `backend/src/functions/shared/contract-validation.ts`; delete the handler's local types.
> 5. Run `node contracts/scripts/contracts-sync.mjs` from repo root; it must exit clean
>    (it regenerates all outputs and typechecks both backend and frontend).
> 6. Migrate frontend call sites to `ApiClient` using `ApiSchema<'X'>`; remove raw HttpClient
>    from that service.
> 7. Add a Bruno request under `bruno/<role>/<feature>/`.
>
> When done, report: the operationIds added, files changed, and any shape mismatches you
> found between backend DB records and the existing hand-written frontend models
> (those mismatches are bugs you just surfaced — list them, don't silently pick one side).

## 7. Discovery probes — rerun these to refresh any section

Probes are read-only; safe to run any time. Rerun after each merged PR and update §3.

### 7.1 Operations in the spec

```bash
jq -r '.paths | to_entries[] | .key as $p | .value | to_entries[]
  | select(.key | test("^(get|post|put|patch|delete)$"))
  | [.value.operationId // "-", .key, $p] | join(" | ")' contracts/openapi.json | sort -t'|' -k3
```

### 7.2 Route drift — template vs spec (THE master probe)

```bash
# real routes (non-OPTIONS), method<TAB>path, normalized
rg -N "Method: (GET|POST|PUT|PATCH|DELETE)" infra/template.yaml -r '$1' | tr 'A-Z' 'a-z' > /tmp/m.txt
rg -N "Path: /" infra/template.yaml -r '' | sed 's/^ *//' > /tmp/p.txt
paste /tmp/m.txt /tmp/p.txt | sort -u | sed 's|^/||' > /tmp/routes-real.txt

# method+path pairs in the spec
jq -r '.paths | to_entries[] | .key as $p | .value | to_entries[]
  | select(.key|test("^(get|post|put|patch|delete)$")) | .key + "\t" + $p' contracts/openapi.json \
  | sed 's|^/||' | sort -u > /tmp/spec-real.txt

comm -23 /tmp/routes-real.txt /tmp/spec-real.txt   # ← still missing (the work)
```

> Gotcha discovered 2026-09-20: pairing Path/Method with a naive awk grabs
> `BuildMethod: esbuild` lines and reports phantom `esbuild/...` routes (+60 noise).
> The two-grep + paste method above is immune. If the count ever looks ~2× too big,
> you're hitting this.

### 7.3 Frontend raw-HttpClient inventory

```bash
rg -n "HttpClient\b|http\.(get|post|put|patch|delete)\(" frontend/src -g '*.ts' \
  | rg -v '\.spec\.' | rg -v 'app\.config\.ts' | rg -v 'core/api/'
```
> Exclude **doc comments** that merely mention HttpClient (that's how notifications.service.ts
> got miscounted). When in doubt, check what the service actually injects.

### 7.4 Services already on the client

```bash
rg -l "core/api/api-client" frontend/src -g '*.ts' | rg -v '\.spec\.'
```

### 7.5 Hand-written request/response type files still alive

```bash
rg -n "^(export )?(interface|type) \w+(Request|Response|Payload|Dto)\b" \
  backend/src frontend/src -g '!node_modules'
```

### 7.6 Schema adoption audit

```bash
rg -o "export (const|type) (\w+)" contracts/src -r '$2' -g '*.ts' --no-filename \
  | sort -u > /tmp/contract-exports.txt
rg -U -o "import(?:\s+type)?\s*\{[^}]*\}\s*from\s*['\"]@daltime/contracts" backend/src -g '*.ts' \
  --no-filename | sed 's/import//g; s/type//g; s/from.*//; s/[{}]//g' \
  | tr ',' '\n' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//; /^$/d' | sort -u > /tmp/be-imports.txt
rg -o "ApiSchema<'([^']+)'>" frontend/src -r '$1' -g '*.ts' --no-filename \
  | sort -u > /tmp/fe-aliases.txt

echo "--- exports never imported by backend:";   comm -23 /tmp/contract-exports.txt /tmp/be-imports.txt
echo "--- frontend aliases with no export:";      comm -13 /tmp/contract-exports.txt /tmp/fe-aliases.txt
```

### 7.7 Importer check BEFORE deleting a hand-written type file

```bash
rg -l "core/models/<name>\.model" frontend/src -g '*.ts'    # use -l, keep filenames
```
Delete only when this returns zero (or alias every importer in the same PR).

## 8. Guardrails to add (Wave 5, after domains land)

- [ ] **CI drift check** — fail if committed openapi.json is stale:
  ```bash
  npm run generate -w contracts && git diff --exit-code -- contracts/openapi.json
  ```
  (Already exists as `npm run check -w contracts` — wire it into `.github/workflows/ci.yml`.)
- [ ] **Lint ban on HttpClient outside the client** (flip warn → error once inventory hits 0):
  ```js
  "no-restricted-imports": ["error", {
    paths: [{ name: "@angular/common/http",
              message: "Use core/api/api-client (contracts-generated types)." }]
  }]
  ```
- [ ] Update `contracts/README.md` status section — it still says "spec in progress".

## 9. Gotchas (append as you learn)

- Routes live ONLY in `infra/template.yaml`. Searching `backend/src` for them finds nothing.
- The §7.2 awk pairing bug: `BuildMethod: esbuild` lines poison naive Path/Method pairing.
- `rg "import\s*\{"` misses `import type` and multiline imports — use §7.6's `-U` pattern.
- `rg --no-filename` hides importer filenames — use `rg -l` for deletion checks (§7.7).
- `notifications.service.ts` doc-comments mention `HttpClient` while injecting `ApiClient` —
  grep hits ≠ raw usage. Verify the `inject()` call before listing a service.
- `ApiSchema` names can exist as generated components with no contracts export
  (e.g. `SwapShift` via composition) — that's fine, not an error.
- Ref counts from substring search are upper bounds: bare `/x` matches `/x/{id}` children.
- **Decision pending — `{proxy+}` wildcard routes** (impersonate, swap-shifts proxy,
  schedule proxy): `zod-openapi` needs concrete paths. Decide per-route: enumerate the real
  subpaths explicitly (preferred, self-documenting) or keep the proxy undocumented and let the
  impersonation interceptor handle rewriting. Enumerate where the subpaths are knowable.
- **Decision pending — standardize `ErrorResponse`/`errorResponses` on every op** during Wave 3
  (infra exists in `contracts/src/schemas/common.ts`; adopt as you create each domain).

## 10. Agent execution protocol — stepped mode

This migration is too large for one agent shot. Work is broken into discrete steps below.
When you are ready, say **`ok start step N`** and the agent will execute that step, update
this tracker, run the verification chain, and commit the work.

### 10.1 Step tracker

| Step | Domain | Ops | Frontend service(s) | Branch name | Status | Commit | Notes |
|---|---|---|---|---|---|---|---|
| 1 | notifications path-params | 4 | — (already on `ApiClient`) | `contracts/notifications-path-params` | ✅ done | `e98f428` | renamed path-param schema `NotificationIdParam` → exported `MarkOneNotificationPathParams` (+`.min(1)`), wired handler via `parseWithContract`; Bruno files already present; sync green |
| 2 | org-admin profile | 2 | `org-admin/profile/profile.service.ts` | `contracts/org-admin-profile` | ✅ done | `e4639ac` | added get/updateOrgAdminProfile; handler validates via `UpdateOrgAdminProfileBody`; deleted hand-written org-admin-profile.model.ts; Bruno added |
| 3 | org-admin organization | 2 | `org-admin/organization/organization.service.ts`, legacy `app/services/organization.service.ts` | `contracts/org-admin-organization` | ✅ done | `809d02f` | added get/updateOrgAdminOrganization; handler validates via `UpdateOrgAdminOrganizationBody`; only feature service migrated (legacy `/organizations` service + shared model stay for step 14); Bruno added |
| 4 | manager employees | 5 | `manager/employees/employees.service.ts` | `contracts/manager-employees` | ✅ done | `67e2d95` | added list/create/update/disable/enableManagerEmployee; handler+service validate via contract schemas (Create/UpdateManagerEmployeeBody), dropped redundant service/validation.ts checks; hand-written employee.model.ts kept (org-admin steps still import it); Bruno added |
| 5 | manager employee-availability read | 3 | `manager/schedule/employee-availability.service.ts` | `contracts/manager-employee-availability` | ✅ done | `0579372` | added 2 ops (getManagerEmployeeAvailability, getManagerEmployeeAvailabilityOverrides) — the checklist's "3 ops incl. PATCH" was stale; the PATCH already landed in step 4. Migrated service to ApiClient. **Shape mismatch:** contract `WeeklySchedule` generates as `Record<string, DayAvailability>` (Zod record loses enum keys) vs strict `WeeklySchedule` model — widened `effectiveDayAvail` param to match wire truth. hand-written model kept (schedule.ts still imports DayOfWeek/DayAvailability/WeeklySchedule). Bruno added |
| 6 | manager locations | 1 | `manager/shifts-needed/locations.service.ts` | `contracts/manager-locations` | ✅ done | `0f0235b` | added listManagerLocations; ManagerLocationResponse from LocationApiFields matches hand-written ManagerLocation model exactly; model kept (org-admin locations/managers steps + schedule utils still import it); Bruno added |
| 7 | manager shifts | 4 | `manager/schedule/shifts.service.ts`, `org-admin/schedule/shifts.service.ts` | `contracts/manager-shifts` | ✅ done | `78e6e4c` | added list/create/update/deleteManagerShift; handler-factory now wired with Create/UpdateManagerShiftBody schemas; migrated only ManagerShiftsService — org-admin/schedule/shifts.service.ts (`/org-admin/shifts`) is step 11, untouched; hand-written shift.model.ts kept (many schedule screens still import it); Bruno create/update/delete added (list existed) |
| 8 | manager shifts-needed | 4 | `manager/shifts-needed/shifts-needed.service.ts` | `contracts/manager-shifts-needed` | ✅ done | `3aafc5c` | added list/create/update/deleteManagerShiftNeeded; handler-factory wired with Create/UpdateManagerShiftNeededBody; migrated service to ApiClient; hand-written manager-shift-needed.model.ts kept (schedule.ts imports it); Bruno x4 added |
| 9 | manager schedule | 4 | `manager/schedule/schedule.service.ts` | `contracts/manager-schedule` | ⬜ pending | — |  |
| 10 | org-admin locations | 10 | `org-admin/locations/locations.service.ts`, `managers/manager-locations.service.ts`, `employees/employee-locations.service.ts` | `contracts/org-admin-locations` | ⬜ pending | — | largest single step; may be split if needed |
| 11 | org-admin shifts | 1 | `org-admin/schedule/shifts.service.ts` | `contracts/org-admin-shifts` | ⬜ pending | — |  |
| 12 | web-admin profile | 2 | `web-admin/profile/profile.service.ts` | `contracts/web-admin-profile` | ⬜ pending | — |  |
| 13 | web-admin employees | 2 | `app/services/web-admin-employees.service.ts` | `contracts/web-admin-employees` | ⬜ pending | — |  |
| 14 | organizations root | 6 | legacy `app/services/org-admins.service.ts` + org-list screens | `contracts/organizations-root` | ⬜ pending | — |  |
| 15 | web-admin org-admins | 4 | folded from #14's screens | `contracts/web-admin-org-admins` | ⬜ pending | — |  |
| 16 | web-admin generate-dummy-data | 1 | `web-admin/generate-dummy-data/generate-dummy-data.service.ts` | `contracts/web-admin-generate-dummy-data` | ⬜ pending | — |  |
| 17 | web-admin impersonate | 6+ | `web-admin/impersonate/impersonate.service.ts` | `contracts/web-admin-impersonate` | ⬜ pending | — | `{proxy+}` decision required |

### 10.2 Per-step agent protocol

When the user says `ok start step N`:

1. **Read this file** and confirm the step by replying with the step number, domain, and branch name from §10.1.
2. **Run the §7 discovery probes** for that domain to refresh ground truth (optional but recommended).
3. **Execute the migration** for the listed operations using the prompt template in §6, scoped strictly to the files listed in this step. Do not scope-creep into other domains.
4. **Run `node contracts/scripts/contracts-sync.mjs`** from repo root. It must exit clean. If it fails, fix the errors and rerun until green.
5. **Run any relevant project tests** for the touched services (frontend unit tests for migrated services, backend tests for touched handlers if they exist).
6. **Update §10.1** in this file: change Status to `✅ done`, fill in Commit with the short SHA, and add notes (operationIds added, shape mismatches found, extra files changed).
7. **Stage, branch, and commit**:
   - `git checkout -b <branch-name>`
   - `git add -A`
   - `git commit -m "contracts(stepN): <domain> — add <N> operations, migrate <service>"`
   - Do **not** push or open a PR unless explicitly asked.
8. **Report back** with: step completed, operationIds added, files changed, shape mismatches surfaced, and the commit SHA.

### 10.3 Definition of done per step

- [ ] All listed operations have Zod schemas + `registerOperation()` entries in the role barrel
- [ ] Backend handlers validate with the schema via `contract-validation.ts`
- [ ] Generated `openapi.json` contains the operations (`node contracts/scripts/contracts-sync.mjs` is green)
- [ ] Listed frontend services use `ApiClient` (zero raw `HttpClient` for migrated routes)
- [ ] Bruno requests added under `bruno/`
- [ ] Obsolete hand-written types deleted in the same commit (only when §7.7 shows zero importers)
- [ ] Relevant tests pass
- [ ] Step tracker in §10.1 updated
- [ ] Work committed to the named branch

### 10.4 Scope boundaries

- One step = one row from §10.1. Do not cross into another step in the same session.
- Do not hand-edit derived files (`openapi.json`, `backend/vendor/contracts`, `frontend/src/app/core/generated/api.d.ts`).
- For the `{proxy+}` routes in **step 17**, pause and ask the user whether to enumerate subpaths explicitly or keep the proxy undocumented; do not silently decide.
- If a step proves too large (e.g., step 10), the agent may pause and ask to split it before continuing.
