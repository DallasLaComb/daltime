# Blueprint: Location Schedule Templates

Managers define reusable shift patterns per location ("templates"), then apply them to a date range to bulk-create ShiftNeeded records. A federal-holiday check step surfaces any US federal holidays in the selected range so the manager can decide whether to skip them.

---

## Route

Integrated into the existing `/manager/shifts-needed` page — no new route. Templates live in a modal panel opened from the page header.

---

## API Dependencies

| Method | Endpoint                                           | Purpose                                        |
| ------ | -------------------------------------------------- | ---------------------------------------------- |
| GET    | `/manager/schedule-templates`                      | List all templates for this manager            |
| POST   | `/manager/schedule-templates`                      | Create a template                              |
| PUT    | `/manager/schedule-templates/{id}`                 | Update a template (name, blocks)               |
| DELETE | `/manager/schedule-templates/{id}`                 | Delete a template                              |
| POST   | `/manager/schedule-templates/{id}/apply`           | Bulk-create ShiftNeeded records from template  |

---

## Models

**`core/models/manager-schedule-template.model.ts`**

```ts
export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export interface TemplateShiftBlock {
  days: DayKey[];       // which days of the week this block applies to
  start_time: string;   // HH:MM
  end_time: string;     // HH:MM
  employee_count: number;
}

export interface ScheduleTemplate {
  template_id: string;
  org_id: string;
  manager_id: string;
  location_id: string;
  location_name: string;
  name: string;
  shift_blocks: TemplateShiftBlock[];
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateBody {
  location_id: string;
  name: string;
  shift_blocks: TemplateShiftBlock[];
}

export type UpdateTemplateBody = Partial<Pick<CreateTemplateBody, 'name' | 'shift_blocks'>>;

export interface ApplyTemplateBody {
  start_date: string;    // YYYY-MM-DD
  end_date: string;      // YYYY-MM-DD
  skip_dates: string[];  // YYYY-MM-DD dates to skip (e.g. holidays)
}

export interface ApplyTemplateResult {
  created: number;
  shifts: import('./manager-shift-needed.model').ShiftNeeded[];
}
```

---

## DynamoDB Schema

Templates use the same single-table pattern as other manager entities.

| Field    | Value                              |
| -------- | ---------------------------------- |
| `PK`     | `ORG#${org_id}`                    |
| `SK`     | `SCHEDULE_TEMPLATE#${template_id}` |
| `GSI1PK` | `MANAGER#${manager_id}`            |
| `GSI1SK` | `TEMPLATE#${template_id}`          |

All template fields (`template_id`, `org_id`, `manager_id`, `location_id`, `location_name`, `name`, `shift_blocks`, `created_at`, `updated_at`) stored at the item level. `shift_blocks` is a DynamoDB List of Maps.

---

## Backend

### Lambda directory

```
backend/src/functions/manager/schedule-templates/
  0-schedule-templates.blueprint.md
  db.ts
  service.ts
  handler.ts
```

### `db.ts` — operations

```ts
listTemplates(managerId: string): Promise<ScheduleTemplate[]>
getTemplate(orgId: string, templateId: string): Promise<ScheduleTemplate | null>
createTemplate(item: ScheduleTemplate): Promise<void>
updateTemplate(orgId, templateId, fields, updatedAt): Promise<ScheduleTemplate | null>
deleteTemplate(orgId: string, templateId: string): Promise<void>
```

- `listTemplates`: `QueryCommand` on `GSI1PK = MANAGER#${managerId}` with `begins_with(GSI1SK, 'TEMPLATE#')`
- All other ops: `GetCommand` / `PutCommand` / `UpdateCommand` / `DeleteCommand` by `PK + SK`

### `service.ts` — validation rules

**`createTemplate` / `updateTemplate`:**
- `name`: required, 1–80 chars
- `location_id`: must exist in caller's org (call `getLocation`)
- `shift_blocks`: array, 1–20 items; each block:
  - `days`: non-empty subset of `['sun','mon','tue','wed','thu','fri','sat']`
  - `start_time` / `end_time`: `HH:MM` format; end must be after start
  - `employee_count`: integer 1–50

**`applyTemplate`:**
- Resolves caller org; verifies template belongs to that manager
- `start_date` / `end_date`: `YYYY-MM-DD`; `end_date >= start_date`; `start_date >= today`
- Date range span: max 366 days
- `skip_dates`: array of valid `YYYY-MM-DD` strings (may be empty)
- Iterates every date in `[start_date, end_date]`, skips dates in `skip_dates`
- For each non-skipped date, finds the `DayKey` for that date; matches shift_blocks whose `days` includes that key
- For each matching block, calls the existing `createShift` logic (re-use from `shifts-needed/service.ts`) — same `PK/SK/GSI1` pattern, same `location_name` lookup (already stored in template, no extra DB call needed)
- Returns `{ created: number, shifts: ShiftNeeded[] }`
- No error if zero shifts generated (valid — entire range may be skipped)

### `handler.ts` — routing

```
GET    /manager/schedule-templates              → service.listTemplates
POST   /manager/schedule-templates              → service.createTemplate
PUT    /manager/schedule-templates/{id}         → service.updateTemplate
DELETE /manager/schedule-templates/{id}         → service.deleteTemplate
POST   /manager/schedule-templates/{id}/apply   → service.applyTemplate
```

### SAM template additions

Two new `AWS::Serverless::Function` resources (one for list/create, one for get/update/delete/apply), each with a `LogGroup`. Add `TABLE_NAME` and `USER_POOL_ID` to `backend/env.local.json` for both.

---

## Frontend

### New utility

**`core/utils/us-federal-holidays.ts`**

Pure function — no external API, no network call. Computes US federal holidays (actual calendar dates, not observed) for any year.

```ts
export interface FederalHoliday {
  date: string;  // YYYY-MM-DD
  name: string;
}

export function getFederalHolidaysInRange(startDate: string, endDate: string): FederalHoliday[]
```

Holidays computed:
| Name | Rule |
|------|------|
| New Year's Day | Jan 1 |
| MLK Jr. Day | 3rd Monday of January |
| Presidents' Day | 3rd Monday of February |
| Memorial Day | Last Monday of May |
| Juneteenth | Jun 19 |
| Independence Day | Jul 4 |
| Labor Day | 1st Monday of September |
| Columbus Day | 2nd Monday of October |
| Veterans Day | Nov 11 |
| Thanksgiving | 4th Thursday of November |
| Christmas Day | Dec 25 |

Returns only holidays whose date falls in `[startDate, endDate]`.

### New service

**`features/manager/shifts-needed/schedule-templates.service.ts`**

```ts
list(): Observable<ScheduleTemplate[]>
create(body: CreateTemplateBody): Observable<ScheduleTemplate>
update(id: string, body: UpdateTemplateBody): Observable<ScheduleTemplate>
remove(id: string): Observable<void>
apply(id: string, body: ApplyTemplateBody): Observable<ApplyTemplateResult>
```

All calls target the `/manager/schedule-templates` base URL with auth header.

### Component changes — `ManagerShiftsNeededComponent`

#### New signals

```ts
// Templates panel
readonly templatesPanelOpen = signal(false);
readonly templates = signal<ScheduleTemplate[]>([]);
readonly templatesLoading = signal(false);
readonly templatesError = signal<string | null>(null);

// Template create/edit form (inside panel)
readonly editingTemplate = signal<ScheduleTemplate | null>(null);
readonly tplFormOpen = signal(false);
readonly tplFormName = signal('');
readonly tplFormLocationId = signal('');
readonly tplFormBlocks = signal<TemplateShiftBlock[]>([]);
readonly tplFormSaving = signal(false);
readonly tplFormError = signal<string | null>(null);
readonly tplDeletingId = signal<string | null>(null);

// Apply wizard (3-step modal)
readonly applyWizardOpen = signal(false);
readonly applyTemplateId = signal<string | null>(null);
readonly applyStep = signal<1 | 2 | 3>(1);
readonly applyStartDate = signal('');
readonly applyEndDate = signal('');
readonly applyHolidays = signal<FederalHoliday[]>([]);    // holidays detected in range
readonly applySkipDates = signal<Set<string>>(new Set()); // dates toggled OFF by manager
readonly applyPreviewCount = signal<number | null>(null); // estimated shifts count
readonly applySubmitting = signal(false);
readonly applyError = signal<string | null>(null);
readonly applyResult = signal<string | null>(null);       // success message after apply
```

#### Key behaviors

**Templates panel** (opened via "Templates" button in header):
- On open: call `scheduleTemplatesService.list()`, populate `templates()`
- List is grouped by location name for readability
- Each template row: name, location, brief summary of blocks (e.g. "Mon–Fri · 2 blocks"), Edit and Delete buttons
- Delete: immediate call, no confirm modal; removes from local state
- Edit: opens template form pre-populated with template data
- "New Template" button opens blank template form

**Template form** (inline in panel):
- Location select (from existing `locations()` signal — no extra load)
- Name input
- Shift blocks: a repeating section, minimum 1 block
  - Each block: Day-of-week checkboxes (Mon–Sun), Start time, End time, # Employees
  - "Add Block" button adds a blank block; "Remove" on each block
- Save / Cancel

**Apply wizard — Step 1 (Date Range):**
- Shows selected template name + location
- Start date picker (min = today)
- End date picker (min = start date, max = start + 365 days)
- Live preview: computed count of shifts that would be generated (pure frontend calculation based on template blocks × matching dates in range — shown as "~N shifts across D dates")

**Apply wizard — Step 2 (Holiday Check):**
- Only shown if `getFederalHolidaysInRange(start, end)` returns ≥ 1 holiday
- Header: "Your date range includes federal holidays. Are you open on these days?"
- Each holiday: a toggle row — `[Holiday Name] · [Date]` with `Open` / `Closed` toggle (default: Closed / skip)
- Manager can flip any holiday to "Open" to include it
- "Closed" holidays are added to `applySkipDates`
- If no holidays in range: step 2 is skipped, wizard goes directly from step 1 to step 3

**Apply wizard — Step 3 (Confirm):**
- Summary: "This will create N shifts at [Location] from [start] to [end]"
- If skip_dates non-empty: "Skipping [k] date(s): [comma-separated list]"
- Confirm button → POST to `/apply` → on success: close wizard, reload shifts for `targetMonth()`, show inline success banner ("42 shifts created")
- On error: show error in wizard, stay open

#### Computed: `applyPreviewCount`

Pure calculation in the component (no API call):
```ts
readonly applyPreviewCount = computed(() => {
  const template = templates().find(t => t.template_id === applyTemplateId());
  if (!template || !applyStartDate() || !applyEndDate()) return null;
  // iterate dates in range, count matching blocks, subtract skip_dates
  ...
});
```

---

## Page layout changes

```
┌────────────────────────────────────────────────────────────┐
│  [<] October 2026 [>]    [Templates]  [Manage Locations]   │
│                                              [+ Add Shift]  │
├────────────────────────────────────────────────────────────┤
│ [apply result banner — shown after successful apply]        │
├────────────────────────────────────────────────────────────┤
│  ... existing shift groups ...                              │
└────────────────────────────────────────────────────────────┘
```

**Templates panel** renders as a full-width modal (same pattern as the existing Locations modal). **Apply wizard** renders as a centered overlay modal with step indicator ("Step 1 of 3" / "Step 1 of 2" when no holidays).

---

## Files

```
contracts/src/entities/
  schedule-template.ts          ← new entity: ScheduleTemplateRecord + ScheduleTemplateApiFields (Zod)

contracts/src/schemas/manager/
  schedule-templates.ts         ← new: all Zod schemas + registerRoleOperation calls for all 5 endpoints
  index.ts                      ← add: export * from './schedule-templates.js'

backend/src/functions/manager/schedule-templates/
  0-schedule-templates.blueprint.md
  db.ts
  service.ts
  handler.ts                    ← imports types from @daltime/contracts

frontend/src/app/core/models/
  manager-schedule-template.model.ts   ← re-exports / wraps generated types from @daltime/contracts

frontend/src/app/core/utils/
  us-federal-holidays.ts
  us-federal-holidays.spec.ts

frontend/src/app/features/manager/shifts-needed/
  schedule-templates.service.ts
  schedule-templates.service.spec.ts
  (shifts-needed.ts and shifts-needed.html — updated in place)
```

### Contract generation steps (run after adding contract files)

```bash
# 1. Rebuild openapi.json from the registered Zod operations
cd contracts && npm run generate

# 2. Regenerate frontend TypeScript types from the new openapi.json
cd frontend && npm run contracts:types
```

Both steps must be committed in the same PR as the feature code. The backend handler imports body/response types from `@daltime/contracts`; the frontend service imports the same types via the generated `api.d.ts`.

---

## Constraints

- No NgModules, no BehaviorSubject — signals only; `ChangeDetectionStrategy.OnPush`
- Tailwind only — no inline styles, no component CSS
- All buttons via `<app-button>`; all interactive elements have `data-testid`
- `trackBy` on all `@for` loops
- ESM `.js` extensions on all backend imports
- Federal holiday computation is pure frontend — no external API, no Lambda cost
- `applyTemplate` backend operation is atomic per-shift (individual `PutCommand` calls in a loop); no DynamoDB Transaction needed since partial creation is acceptable (the manager can delete and re-apply)
- Max date range of 366 days enforced on both frontend (end date picker max) and backend (validation)

---

## What is NOT in scope

- Flexible time-window matching (e.g., "5am–8am or 9am") — manual override via existing edit
- Monthly recurrence patterns — the date range picker handles this naturally (pick a 4-week range for monthly, 52 weeks for a full year)
- Auto-assignment — templates only create ShiftNeeded records; the existing Generate Draft + Fill Shift flows handle employee assignment
- Template sharing across managers — templates are manager-scoped
