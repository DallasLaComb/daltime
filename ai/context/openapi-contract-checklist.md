# OpenAPI Contract Migration — File Checklist

Companion to [`ai/context/openapi-contract-goal.md`](openapi-contract-goal.md). Read that file first for _why_ and _what "done" means_; this file is the enumerated _what_, so a migration pass can't accidentally skip a slice. For _how_ to migrate a slice, follow the recipe in [`openapi-contract-blueprint.md`](openapi-contract-blueprint.md).

**Progress: 5 / 152.** The foundation (`contracts/` package, generation, CI drift check, typed frontend client) is built, and `manager/profile` is migrated end-to-end as the pilot.

**Scope:** every file that currently defines or consumes an API request/response shape, or issues a DynamoDB query — i.e. backend `handler.ts`/`service.ts`/`db.ts`/`model.ts` per vertical slice, backend `shared/models/`, frontend `core/models/`, and frontend `*.service.ts`. Config files, build tooling, tests, and pure-presentation components are intentionally excluded — see `openapi-contract-goal.md`'s "Non-goals" for why the scope stops here. This list was generated directly from the repo tree, not written from memory — re-run the `find` commands below if the tree has changed since:

```bash
find backend/src/functions -type f | sort
find frontend/src/app/core/models -type f | sort
find frontend/src/app -iname "*.service.ts" | sort
```

## How to use this checklist

- Check a box only when that file's contract surface (request/response shape, and DynamoDB query if it has one) is fully registered in the generated OpenAPI contract with the file-path/purpose/query metadata required by the goal doc, **and** the file itself sources its types from the generated contract instead of a hand-written duplicate.
- Don't check a box for partial work (e.g. "types migrated but validation not wired up" is not done).
- Work role-by-role, slice-by-slice — a slice is done when every file in its group is checked.
- `model.ts` / `shared/models/**/*.model.ts` entries are the actual duplicated type definitions being replaced — treat these as the highest-priority items per slice, since `handler.ts`/`service.ts`/`db.ts` mostly just consume them.

---

## Backend — `backend/src/functions/`

### employee

**availability-overrides**

- [ ] `employee/availability-overrides/handler.ts`
- [ ] `employee/availability-overrides/service.ts`
- [ ] `employee/availability-overrides/db.ts`

**availability**

- [ ] `employee/availability/handler.ts`
- [ ] `employee/availability/service.ts`
- [ ] `employee/availability/db.ts`

**available-shifts**

- [ ] `employee/available-shifts/handler.ts`
- [ ] `employee/available-shifts/service.ts`
- [ ] `employee/available-shifts/db.ts`

**profile**

- [ ] `employee/profile/handler.ts`
- [ ] `employee/profile/service.ts`
- [ ] `employee/profile/db.ts`

**shifts**

- [ ] `employee/shifts/handler.ts`
- [ ] `employee/shifts/service.ts`
- [ ] `employee/shifts/db.ts`

**swap-shifts**

- [ ] `employee/swap-shifts/handler.ts`
- [ ] `employee/swap-shifts/service.ts`
- [ ] `employee/swap-shifts/db.ts`

### manager

**employees**

- [ ] `manager/employees/handler.ts`
- [ ] `manager/employees/service.ts`
- [ ] `manager/employees/db.ts`

**locations**

- [ ] `manager/locations/handler.ts`
- [ ] `manager/locations/service.ts`
- [ ] `manager/locations/db.ts`

**profile**

- [x] `manager/profile/handler.ts`
- [x] `manager/profile/service.ts`
- [x] `manager/profile/db.ts`

**schedule**

- [ ] `manager/schedule/handler.ts`
- [ ] `manager/schedule/service.ts`
- [ ] `manager/schedule/db.ts`

**shifts-needed**

- [ ] `manager/shifts-needed/handler.ts`
- [ ] `manager/shifts-needed/service.ts`
- [ ] `manager/shifts-needed/db.ts`

**shifts**

- [ ] `manager/shifts/handler.ts`
- [ ] `manager/shifts/service.ts`
- [ ] `manager/shifts/db.ts`

### org-admin

**employee-locations**

- [ ] `org-admin/employee-locations/handler.ts`
- [ ] `org-admin/employee-locations/service.ts`
- [ ] `org-admin/employee-locations/db.ts`

**employees**

- [ ] `org-admin/employees/handler.ts`
- [ ] `org-admin/employees/service.ts`
- [ ] `org-admin/employees/db.ts`

**locations**

- [ ] `org-admin/locations/handler.ts`
- [ ] `org-admin/locations/service.ts`
- [ ] `org-admin/locations/db.ts`

**manager-locations**

- [ ] `org-admin/manager-locations/handler.ts`
- [ ] `org-admin/manager-locations/service.ts`
- [ ] `org-admin/manager-locations/db.ts`

**managers**

- [ ] `org-admin/managers/handler.ts`
- [ ] `org-admin/managers/service.ts`
- [ ] `org-admin/managers/db.ts`

**organization**

- [ ] `org-admin/organization/handler.ts`
- [ ] `org-admin/organization/service.ts`
- [ ] `org-admin/organization/db.ts`

**profile**

- [ ] `org-admin/profile/handler.ts`
- [ ] `org-admin/profile/service.ts`
- [ ] `org-admin/profile/db.ts`

**shifts**

- [ ] `org-admin/shifts/handler.ts`
- [ ] `org-admin/shifts/service.ts`
- [ ] `org-admin/shifts/db.ts`

### web-admin

**employees**

- [ ] `web-admin/employees/handler.ts`
- [ ] `web-admin/employees/service.ts`
- [ ] `web-admin/employees/db.ts`

**generate-dummy-data**

- [ ] `web-admin/generate-dummy-data/handler.ts`
- [ ] `web-admin/generate-dummy-data/service.ts`
- [ ] `web-admin/generate-dummy-data/db.ts`
- [ ] `web-admin/generate-dummy-data/model.ts`

**impersonate**

- [ ] `web-admin/impersonate/handler.ts`
- [ ] `web-admin/impersonate/service.ts`
- [ ] `web-admin/impersonate/db.ts`
- [ ] `web-admin/impersonate/route-registry.ts` — not a per-operation file, but defines which routes impersonation can act on; review against the completed contract once every slice is migrated
- [ ] `web-admin/impersonate/synthesize-event.ts` — synthesizes a Lambda event for impersonated calls; confirm it stays consistent with whatever request-shape validation the contract introduces

**org-admins**

- [ ] `web-admin/org-admins/handler.ts`
- [ ] `web-admin/org-admins/service.ts`
- [ ] `web-admin/org-admins/db.ts`

**organizations**

- [ ] `web-admin/organizations/handler.ts`
- [ ] `web-admin/organizations/service.ts`
- [ ] `web-admin/organizations/db.ts`

**profile**

- [ ] `web-admin/profile/handler.ts`
- [ ] `web-admin/profile/service.ts`
- [ ] `web-admin/profile/db.ts`
- [ ] `web-admin/profile/model.ts`

**shared (web-admin only)**

- [ ] `web-admin/shared/db.ts`

### shared (cross-role)

**models — the actual duplicated type definitions (highest priority)**

- [ ] `shared/models/employee/availability.model.ts`
- [ ] `shared/models/employee/swap-shift.model.ts`
- [ ] `shared/models/manager/location.model.ts`
- [ ] `shared/models/manager/shift-needed.model.ts`
- [ ] `shared/models/manager/shift.model.ts`
- [ ] `shared/models/notifications/notification.model.ts`
- [ ] `shared/models/org-admin/employee.model.ts`
- [ ] `shared/models/org-admin/manager.model.ts`
- [ ] `shared/models/org-admin/user-location.model.ts`
- [ ] `shared/models/web-admin/employee.model.ts`
- [ ] `shared/models/web-admin/org-admin-user.model.ts`
- [ ] `shared/models/web-admin/organization.model.ts`
- [ ] `shared/models/web-admin/web-admin.model.ts`

**health**

- [ ] `shared/health/handler.ts`

**notifications**

- [ ] `shared/notifications/handler.ts`
- [ ] `shared/notifications/service.ts`
- [ ] `shared/notifications/db.ts`

**shared infrastructure — not per-operation; review once the pattern is established, check off once each is updated to integrate with the generated contract (e.g. validation) or confirmed not to need changes**

- [ ] `shared/auth.ts`
- [ ] `shared/cognito.ts`
- [ ] `shared/dynamo.ts`
- [ ] `shared/errors.ts`
- [ ] `shared/handler-factories.ts` — likely where generated Zod validation gets wired into every handler; expect this to change early, not last
- [ ] `shared/profile-service.ts`
- [ ] `shared/response.ts`
- [ ] `shared/route-match.ts`
- [ ] `shared/validation.ts` — likely superseded by Zod schema validation; decide whether it's deleted or kept for non-contract validation

---

## Frontend — `frontend/src/app/`

**core/models — the actual duplicated type definitions (highest priority)**

- [ ] `core/models/employee-availability.model.ts`
- [ ] `core/models/employee-profile.model.ts`
- [ ] `core/models/employee.model.ts`
- [ ] `core/models/manager-location.model.ts`
- [x] `core/models/manager-profile.model.ts`
- [ ] `core/models/manager-shift-needed.model.ts`
- [ ] `core/models/manager.model.ts`
- [ ] `core/models/notification.model.ts`
- [ ] `core/models/org-admin-profile.model.ts`
- [ ] `core/models/org-admin-user.model.ts`
- [ ] `core/models/organization.model.ts`
- [ ] `core/models/shift.model.ts`
- [ ] `core/models/swap-shift.model.ts`
- [ ] `core/models/user-location.model.ts`
- [ ] `core/models/web-admin-employee.model.ts`
- [ ] `core/models/web-admin-profile.model.ts`

**services — every HTTP-calling service, by feature**

- [ ] `core/services/impersonation.service.ts`
- [ ] `features/employee/availability/availability.service.ts`
- [ ] `features/employee/profile/profile.service.ts`
- [ ] `features/employee/schedule/shifts.service.ts`
- [ ] `features/employee/swap-shifts/swap-shifts.service.ts`
- [ ] `features/manager/employees/employees.service.ts`
- [x] `features/manager/profile/profile.service.ts`
- [ ] `features/manager/schedule/employee-availability.service.ts`
- [ ] `features/manager/schedule/schedule.service.ts`
- [ ] `features/manager/schedule/shifts.service.ts`
- [ ] `features/manager/shifts-needed/locations.service.ts`
- [ ] `features/manager/shifts-needed/shifts-needed.service.ts`
- [ ] `features/org-admin/employees/employee-locations.service.ts`
- [ ] `features/org-admin/employees/employees.service.ts`
- [ ] `features/org-admin/locations/locations.service.ts`
- [ ] `features/org-admin/managers/manager-locations.service.ts`
- [ ] `features/org-admin/managers/managers.service.ts`
- [ ] `features/org-admin/organization/organization.service.ts`
- [ ] `features/org-admin/profile/profile.service.ts`
- [ ] `features/org-admin/schedule/shifts.service.ts`
- [ ] `features/web-admin/generate-dummy-data/generate-dummy-data.service.ts`
- [ ] `features/web-admin/impersonate/impersonate.service.ts`
- [ ] `features/web-admin/profile/profile.service.ts`
- [ ] `services/org-admins.service.ts`
- [ ] `services/organization.service.ts`
- [ ] `services/web-admin-employees.service.ts`
- [ ] `shared/notifications/notifications.service.ts`

---

## Totals (for tracking progress at a glance)

Verified against the checklist itself (`grep -c '^- \[ \]' ai/context/openapi-contract-checklist.md` → 152) — re-run that after any edit to this file to keep this section honest.

- Backend vertical-slice files (handler/service/db/model, incl. impersonate's extra files and web-admin/shared/db.ts): 83
- Backend shared models (`shared/models/**`): 13
- Backend shared health + notifications: 4
- Backend shared infrastructure (auth/cognito/dynamo/errors/handler-factories/profile-service/response/route-match/validation): 9
- Frontend models (`core/models/**`): 16
- Frontend services (`*.service.ts`): 27

**152 files total.**
