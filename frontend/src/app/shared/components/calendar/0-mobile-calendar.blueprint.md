# Mobile Calendar — Blueprint

Status: **Approved and implemented (phases 1–6).**

## 1. Problem

On a phone the manager, org-admin and employee schedule pages force horizontal scrolling:

| View         | Where                        | Cause                                                                                                                  |
| ------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Month        | manager, org-admin           | 7-column grid with `min-w-[490px]` inside `overflow-x-auto`; cells are 110px tall and hold text chips at `text-[10px]` |
| Week         | manager, org-admin, employee | 7-column grid with `min-w-[560px]` inside `overflow-x-auto`                                                            |
| Availability | manager                      | employee × day matrix, `min-w-[560px]`                                                                                 |

A phone is ~390 px wide. Sideways scrolling inside a page that also scrolls vertically feels broken, and 10 px
text in 55 px cells is not tappable (below the 44 px touch-target rule from Capacitor phase 6).

## 2. What the research says

- Mobile calendars favor an **agenda (chronological list)** as the primary surface; a full grid becomes too small
  to act on below ~360 px. Users should be able to move between the "micro" (today) and "macro" (this month), with swipe
  between days/weeks. ([Eleken](https://www.eleken.co/blog-posts/calendar-ui),
  [UX Patterns](https://uxpatterns.dev/patterns/data-display/calendar))
- **Google Calendar mobile** keeps events in a consistent vertical flow, moves through time with swipe, and its month
  view is a compact grid you can open to half a screen, with the day's events listed beneath it — the grid is for
  orientation and picking a date, not for reading event details.
  ([Computerworld](https://www.computerworld.com/article/1722623/google-calendar-android.html),
  [9to5Google](https://9to5google.com/2025/08/07/google-calendar-material-3-expressive-redesign/))
- Month cells show **indicators (dots), not text**; dense days show "+N more" instead of overflowing. Do not rely on color
  alone (pair with icon/pattern), keep touch targets large, and give today / selected / has-events clear, distinct states.
  ([Eleken](https://www.eleken.co/blog-posts/calendar-ui), [Bricx](https://bricxlabs.com/blogs/calendar-ui-examples))
- For shift-scheduling products specifically, the mobile pattern is a **list of my shifts** with calendar views for
  context; wide employee × day matrices are a desktop/manager tool.
  ([myshyft](https://www.myshyft.com/blog/schedule-visualization-tools/))

## 3. Proposed design

**Rule: below the `md` breakpoint (< 768 px) nothing scrolls sideways. At ≥ 768 px every page is unchanged.**

### 3.1 Month view (phone)

```
 ‹   September 2026   ›   [Today]
 S  M  T  W  T  F  S          <- 7 equal columns, 100% width, no min-width
       1  2  3  4  5
       •  ••    •
 6  7  8  9 10 11 12
 ...
 ─────────────────────────────
 Wed, Sep 16          3 shifts   [+ Add]   <- manager/org-admin only
 ┌ 7:00 AM – 3:00 PM  Alex R.  ● Morning ┐
 ┌ 3:00 PM – 11:00 PM Jamie L. ● Night   ┐
 ┌ Not scheduled 9–5            ▲ Fill   ┐
```

- Grid cells are ≥ 44 px tall squares-ish: day number + up to 3 dots (color = shift type; amber = no employee/draft,
  red = unfilled slot) + "+" when > 3. Today = filled circle; selected = ring; other-month days dimmed.
- **Tapping a day selects it** and shows that day's agenda directly under the grid (same shift cards as today's Day view,
  same tap actions: edit shift, fill slot). On phone, "create a shift" moves from _tap the cell_ to an explicit
  **+ Add shift** button in the agenda header (a cell tap now means "select").
- Defaults: selected day = today if in the visible month, else the 1st.

### 3.2 Week view (phone)

A **vertical list of the 7 days** (sticky day headers, each with that day's shift cards; empty days show a one-line
"No shifts"). Optional 7-chip date strip on top for jump-to-day. No grid, no horizontal scroll.

### 3.3 Day view (phone)

Already vertical — keep, but tighten padding for a 390 px screen.

### 3.4 Chrome (all three views, phone)

- Sticky header: period label with 44 px prev / next buttons and Today. View switch (Day / Week / Month) as a
  full-width segmented control with 44 px targets. Filters collapse into a "Filters" disclosure with an active count badge.
- **Swipe left/right on the content moves prev/next period** (never triggers while scrolling vertically; buttons remain
  for accessibility).

### 3.5 Desktop / tablet (≥ 768 px)

Existing grids, chips, modals and tests are untouched.

## 4. Implementation approach

One shared building block set, used by all three pages, instead of three divergent copies.

| New                                                   | Purpose                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/services/viewport.ts` — `Viewport` service      | `isMobile` **signal** from `matchMedia('(max-width: 767px)')`; injectable + overridable in tests (same pattern as `IS_NATIVE_PLATFORM`). Pages `@if (viewport.isMobile())` so only one tree is in the DOM (no duplicate `data-testid`s). |
| `shared/components/calendar/mobile-month-grid`        | Compact dot grid. Inputs: month date, `dayIndicators` map (`dateKey → {type/status dots}`), selected date. Output: `dateSelected`. Signals only, OnPush, `class="dt-debug"` root.                                                        |
| `shared/components/calendar/mobile-swipe` (directive) | `(swipedPrev)` / `(swipedNext)` from touch events with a horizontal-dominance + distance threshold.                                                                                                                                      |
| `shared/components/calendar/mobile-day-list`          | Week agenda: day headers + projected shift-card template (content projection so each role keeps its own card/actions).                                                                                                                   |
| `core/utils/schedule.utils.ts` additions              | `buildDayIndicators()` (pure, unit-tested).                                                                                                                                                                                              |

Page changes (templates only wrap the existing desktop markup in `@else`):

- `features/manager/schedule`, `features/org-admin/schedule`: month + week get a mobile branch; add `selectedDate` signal.
- `features/employee/schedule`: week gets the day-list; month view gets the dot grid + selected-day agenda
  (it is currently a grouped list — keep that list as the agenda content).
- `ScheduleBaseComponent` gains `selectedDate`, `selectDate()`, and swipe handlers.
- Tailwind only, no component CSS, `<app-button>` for actions, `data-testid` on every interactive element.

## 5. Out of scope (decide below)

- **Manager "Availability" tab** (employee × day matrix). It is inherently 2-D; on phone it should become a per-employee
  list. Proposed as a follow-up phase, not part of the first cut.
- Time-grid day/week views (hour-by-hour columns). Shift data is a few long blocks, not many short meetings.
- Drag-and-drop rescheduling, pinch zoom.

## 6. Phases

1. `Viewport` service + `buildDayIndicators` + tests.
2. `mobile-month-grid`, swipe directive, day-list component + specs.
3. Employee schedule (read-only, lowest risk) → verify on simulator.
4. Manager schedule (edit/fill/create flows) → verify on simulator.
5. Org-admin schedule.
6. (optional) Availability tab as a per-employee list.

**AI verification:** `npm test`, `npm run lint`, `npm run build`, iOS simulator screenshots at 390 px width of each
view on each page; confirm `document.documentElement.scrollWidth <= innerWidth` (no horizontal overflow); desktop
specs unchanged and passing. **Human gate:** use it on the physical phone.

## 7. Decisions (resolved with the user)

1. Week view on phone → **vertical day list** (not a date strip).
2. Manager Availability tab → **follow-up phase**, then requested and delivered (phase 6, below).

## 8. Completion notes

**Done (phases 1–5):** `Viewport` service (+spec), `calendar.utils` (dot indicators, selected-day resolution), `mobile-month-grid`,
`mobile-day-list`, `appSwipeNav` (each with a spec), and the phone layouts on the employee, manager and org-admin schedule pages.
Desktop (≥ 768 px) markup is unchanged; existing specs pass untouched.

**Deviations from the plan above:**

- Other-month days are blank cells, not dimmed dates (`buildCalendarWeeks` only yields the current month).
- `buildDayIndicators` lives in `shared/components/calendar/calendar.utils.ts`, not `schedule.utils.ts`.
- Month-grid cells are raw `<button>`s (custom day-number + dots control) — the same exception the existing shift chips use.
- The manager/org-admin day-view card list was extracted into an `ng-template #dayBody` and reused for the day view, the phone month
  agenda and the phone week list (one markup, three places). Phone padding is tighter (`px-3 py-3`, `w-14` time column) with `sm:`
  restoring the old values.
- Phone chrome additions beyond the plan: `ScheduleFiltersComponent` collapses behind a "Filters (n)" button on phones; the view toggle,
  nav buttons, status chips and selects are ≥ 44 px tall on phones; the manager's Generate/Publish controls render **below** the
  calendar on phones (above it on desktop) so the calendar is the first thing on screen; the desktop "Color key" is hidden on phones
  (the month grid shows its own legend for hollow rings when present); page subtitles are hidden on phones.
- Swipe is active only when `Viewport.isMobile()`.

**Verification:** `npm test` (618 pass), `npm run lint`, `npm run build` clean. Visually checked at 390 px in iOS Simulator Safari using a
throwaway preview route with fake data (removed): employee month + week, manager month + week — no horizontal scroll, dots, "+" overflow,
legend, agenda and week list render as designed. Not yet checked on a physical device or Android.

**Phase 6 — Availability tab (manager):** on phones the employee × day matrix becomes one card per employee: a Mon–Sun strip of
circles (green = available) that expands on tap into each day's time ranges (multiple slots supported). Cards say "No availability
submitted" when there is no schedule. Because availability is a recurring weekly schedule, the period navigation and shift filters are
hidden on phones for this tab only. Desktop keeps the matrix. Covered by 5 specs in `manager/schedule/schedule.mobile.spec.ts`; checked
at 390 px in the iOS Simulator.

**Known limits / follow-ups:**

- Month navigation uses `setMonth()` on the current date, so stepping from a 31st into a shorter month can skip a month
  (pre-existing in all three pages; not changed here).
- Tapping a day in the manager/org-admin phone month grid selects it; creating a shift there is via **+ Add** (was tap-the-cell).
