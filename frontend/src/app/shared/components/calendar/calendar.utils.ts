import type { Shift, ShiftType } from '../../../core/models/shift.model';
import { toMonthKey } from '../../../core/utils/schedule.utils';

/**
 * What a single dot in a month-grid cell stands for.
 * Shift types are solid dots; `unassigned` (a shift with no employee) and `unfilled`
 * (a needed slot nobody is scheduled for) are hollow rings so they never rely on color alone.
 */
export type DayIndicatorKind = ShiftType | 'unassigned' | 'unfilled';

/** dateKey (YYYY-MM-DD) → one entry per shift/slot on that day, in start-time order. */
export type DayIndicators = ReadonlyMap<string, readonly DayIndicatorKind[]>;

export function indicatorKindFor(shift: Shift): DayIndicatorKind {
  return shift.employee_id === '' ? 'unassigned' : shift.type;
}

/**
 * Builds the per-day dot list for the mobile month grid.
 *
 * @param shiftsByDate  shifts already grouped by `date`
 * @param unfilledByDate optional count of unfilled slots per date (manager / org-admin only)
 */
export function buildDayIndicators(
  shiftsByDate: ReadonlyMap<string, readonly Shift[]>,
  unfilledByDate?: ReadonlyMap<string, number>,
): DayIndicators {
  const result = new Map<string, DayIndicatorKind[]>();

  for (const [date, shifts] of shiftsByDate) {
    const kinds = [...shifts]
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .map(indicatorKindFor);
    if (kinds.length > 0) result.set(date, kinds);
  }

  for (const [date, count] of unfilledByDate ?? []) {
    if (count <= 0) continue;
    const kinds = result.get(date) ?? [];
    result.set(date, [...kinds, ...new Array<DayIndicatorKind>(count).fill('unfilled')]);
  }

  return result;
}

/**
 * Which day the month view's agenda should show.
 * Keeps the user's pick while it is inside the visible month; otherwise falls back to today
 * (if visible) or the 1st, so navigating months never leaves the agenda empty or stale.
 */
export function resolveSelectedDate(
  selected: Date | null,
  visibleMonth: Date,
  today: Date = new Date(),
): Date {
  const monthKey = toMonthKey(visibleMonth);
  if (selected && toMonthKey(selected) === monthKey) return selected;
  if (toMonthKey(today) === monthKey) return today;
  return new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
}

/** Parses `YYYY-MM-DD` as a local date (never UTC, which shifts the day in western time zones). */
export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Screen-reader label for a month-grid cell, e.g. "Wednesday, September 16, 2 shifts". */
export function dayCellLabel(date: Date, indicators: readonly DayIndicatorKind[]): string {
  const dateLabel = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const unfilled = indicators.filter((k) => k === 'unfilled').length;
  const shifts = indicators.length - unfilled;
  const parts = [`${shifts} ${shifts === 1 ? 'shift' : 'shifts'}`];
  if (unfilled > 0) parts.push(`${unfilled} not scheduled`);
  return indicators.length === 0 ? `${dateLabel}, no shifts` : `${dateLabel}, ${parts.join(', ')}`;
}
