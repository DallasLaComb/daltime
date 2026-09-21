import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Shift, ShiftType } from '../../../core/models/shift.model';
import { EmployeeShiftsService } from './shifts.service';
import { Viewport } from '../../../core/services/viewport';
import {
  ButtonComponent,
  LoadingSpinnerComponent,
  ErrorAlertComponent,
  EmptyStateComponent,
  MobileMonthGridComponent,
  MobileDayListComponent,
  SwipeNavDirective,
  buildDayIndicators,
  resolveSelectedDate,
  type MobileDayGroup,
} from '@common-daltime';
import {
  SHIFT_BORDER_STYLES,
  SHIFT_BADGE_STYLES,
  toDateKey,
  toMonthKey,
  buildViewLabel,
  buildWeekDays,
  formatLongDateLabel,
  getWeekStart,
} from '../../../core/utils/schedule.utils';
import type { ViewMode } from '../../../core/utils/schedule.utils';

/** A group of shifts for a single date, used by the month view. */
interface ShiftGroup {
  date: string;
  dateLabel: string;
  shifts: Shift[];
}

/** A single column in the week view — one per calendar day. */
interface WeekDay {
  date: Date;
  dateKey: string;
  dayLabel: string; // e.g. "Mon 16"
  isToday: boolean;
  shifts: Shift[];
}

@Component({
  selector: 'app-employee-schedule',
  imports: [
    NgTemplateOutlet,
    ButtonComponent,
    LoadingSpinnerComponent,
    ErrorAlertComponent,
    EmptyStateComponent,
    MobileMonthGridComponent,
    MobileDayListComponent,
    SwipeNavDirective,
  ],
  templateUrl: './schedule.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeScheduleComponent {
  private readonly shiftsService = inject(EmployeeShiftsService);

  /** Phones get an agenda-style layout (no horizontal scrolling); ≥ 768px keeps the grids. */
  protected readonly viewport = inject(Viewport);

  /** Expose style maps to the template for shift card theming. */
  protected readonly shiftBorderStyles = SHIFT_BORDER_STYLES;
  protected readonly shiftBadgeStyles = SHIFT_BADGE_STYLES;

  // ── View state ─────────────────────────────────────────────────────────────

  /** Active calendar view. Defaults to day view so the employee sees today immediately. */
  protected readonly viewMode = signal<ViewMode>('day');

  /** The date the user is currently navigated to. All view modes use this as an anchor. */
  protected readonly currentDate = signal<Date>(new Date());

  /**
   * Day the user tapped in the phone month grid. Kept separate from `currentDate` because changing
   * `currentDate` re-fetches; selecting a day inside the loaded month must not.
   */
  private readonly selectedDate = signal<Date | null>(null);

  // ── Own-shifts state ───────────────────────────────────────────────────────

  /** Own shifts returned by the API for the current view/date. */
  protected readonly shifts = signal<Shift[]>([]);

  /** True while the own-shifts request is in flight. */
  protected readonly loading = signal(true);

  /** Error message if the own-shifts request failed. */
  protected readonly error = signal<string | null>(null);

  // ── Available-shifts state (day view only) ─────────────────────────────────

  /** Shifts from other employees that are available for pickup on the current day. */
  protected readonly availableShifts = signal<Shift[]>([]);

  /** True while the available-shifts request is in flight (day view only). */
  protected readonly availableShiftsLoading = signal(false);

  /** Error message if the available-shifts request failed (not shown to user — section is silently hidden). */
  protected readonly availableShiftsError = signal<string | null>(null);

  // ── Derived labels ──────────────────────────────────────────────────────────

  /**
   * Human-readable label for the navigation header.
   * Computed from viewMode + currentDate so it updates reactively.
   */
  protected readonly viewLabel = computed(() =>
    buildViewLabel(this.currentDate(), this.viewMode()),
  );

  /**
   * Long date label for the day-view empty-state description.
   * e.g. "Thursday, June 19"
   */
  protected readonly dayLabel = computed(() => {
    const d = this.currentDate();
    return formatLongDateLabel(toDateKey(d));
  });

  /** True when the selected day-view date is today. */
  protected readonly isViewingToday = computed(
    () => toDateKey(this.currentDate()) === toDateKey(new Date()),
  );

  /**
   * True when the period anchored on currentDate does NOT include today.
   * Controls visibility of the "Today" button in the nav.
   */
  protected readonly showTodayButton = computed(() => {
    const today = new Date();
    const d = this.currentDate();
    const mode = this.viewMode();
    if (mode === 'day') return toDateKey(d) !== toDateKey(today);
    if (mode === 'week') {
      // Week spans from weekStart (Sun) to weekStart+6. Today is in range if its key is in the set.
      const weekStart = getWeekStart(d);
      for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(day.getDate() + i);
        if (toDateKey(day) === toDateKey(today)) return false;
      }
      return true;
    }
    // Month view: compare YYYY-MM prefix
    return toMonthKey(d) !== toMonthKey(today);
  });

  // ── Month-view grouped data ─────────────────────────────────────────────────

  /**
   * Shifts grouped by date for month view rendering.
   * Sorted by date asc, then start_time asc within each group.
   */
  protected readonly grouped = computed((): ShiftGroup[] => {
    const map = new Map<string, Shift[]>();
    for (const shift of this.shifts()) {
      const existing = map.get(shift.date) ?? [];
      map.set(shift.date, [...existing, shift]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, dayShifts]) => ({
        date,
        dateLabel: formatLongDateLabel(date),
        shifts: [...dayShifts].sort((a, b) => a.start_time.localeCompare(b.start_time)),
      }));
  });

  // ── Week-view column data ───────────────────────────────────────────────────

  /**
   * 7 WeekDay objects (Sun–Sat) with shifts pre-filtered into each column.
   * Re-computed whenever shifts or currentDate change.
   */
  protected readonly weekColumns = computed((): WeekDay[] => {
    const today = new Date();
    const todayKey = toDateKey(today);
    const days = buildWeekDays(this.currentDate());
    const ownShifts = this.shifts();
    return days.map((day) => {
      const dateKey = toDateKey(day);
      return {
        date: day,
        dateKey,
        dayLabel: `${day.toLocaleString('default', { weekday: 'short' })} ${day.getDate()}`,
        isToday: dateKey === todayKey,
        shifts: ownShifts
          .filter((s) => s.date === dateKey)
          .sort((a, b) => a.start_time.localeCompare(b.start_time)),
      };
    });
  });

  /** True when there are no shifts anywhere in the current week. Used to show empty state. */
  protected readonly weekIsEmpty = computed(() => this.shifts().length === 0);

  // ── Phone layouts (month grid + agenda, week day list) ─────────────────────

  /** Own shifts keyed by date, each day sorted by start time. */
  private readonly shiftsByDate = computed(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of this.shifts()) {
      map.set(shift.date, [...(map.get(shift.date) ?? []), shift]);
    }
    for (const dayShifts of map.values()) {
      dayShifts.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return map;
  });

  /** Dots for the phone month grid. */
  protected readonly dayIndicators = computed(() => buildDayIndicators(this.shiftsByDate()));

  /** The day whose shifts are listed under the phone month grid. */
  protected readonly agendaDate = computed(() =>
    resolveSelectedDate(this.selectedDate(), this.currentDate()),
  );

  protected readonly agendaLabel = computed(() =>
    formatLongDateLabel(toDateKey(this.agendaDate())),
  );

  protected readonly agendaShifts = computed(
    () => this.shiftsByDate().get(toDateKey(this.agendaDate())) ?? [],
  );

  /** Section headers for the phone week list (Sun–Sat). */
  protected readonly weekDayGroups = computed((): MobileDayGroup[] =>
    this.weekColumns().map((day) => ({
      dateKey: day.dateKey,
      label: day.date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      isToday: day.isToday,
      count: day.shifts.length,
    })),
  );

  // Typed lookups for the untyped `let-shift` context of the shared shift-row template.
  protected borderClass(type: ShiftType): string {
    return SHIFT_BORDER_STYLES[type];
  }

  protected badgeClass(type: ShiftType): string {
    return SHIFT_BADGE_STYLES[type];
  }

  /** Shifts for one day of the phone week list. */
  protected shiftsOn(dateKey: string): Shift[] {
    return this.shiftsByDate().get(dateKey) ?? [];
  }

  /** Handles a tap on a day in the phone month grid. */
  protected selectDate(date: Date): void {
    this.selectedDate.set(date);
  }

  /** Swipe navigation only applies to the phone layout. */
  protected swipePrev(): void {
    if (this.viewport.isMobile()) this.navigatePrev();
  }

  protected swipeNext(): void {
    if (this.viewport.isMobile()) this.navigateNext();
  }

  // ── Today check for month-view date-group headers ──────────────────────────

  /** Returns true when the given YYYY-MM-DD date string is today. */
  protected isToday(date: string): boolean {
    return date === toDateKey(new Date());
  }

  constructor() {
    /**
     * Re-fetch data whenever viewMode or currentDate change.
     * effect() runs once immediately on construction and again on any signal change,
     * eliminating the need to manually call load() on every navigation action.
     * Must be created in the constructor to have access to the Angular injector context.
     */
    effect(() => {
      this.load(this.viewMode(), this.currentDate());
    });
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  /**
   * Fetches own shifts (and, for day view, available shifts) for the given view/date.
   * Called from the effect() in ngOnInit — never called directly from navigation handlers.
   */
  private load(mode: ViewMode, date: Date): void {
    this.loading.set(true);
    this.error.set(null);
    this.availableShifts.set([]);
    this.availableShiftsError.set(null);

    const dateKey = toDateKey(date);
    const monthKey = toMonthKey(date);
    const weekStartKey = toDateKey(getWeekStart(date));

    const obs =
      mode === 'day'
        ? this.shiftsService.listByDate(dateKey)
        : mode === 'week'
          ? this.shiftsService.listByWeek(weekStartKey)
          : this.shiftsService.listByMonth(monthKey);

    obs.subscribe({
      next: (shifts) => {
        this.shifts.set(shifts);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('[EmployeeSchedule] shifts request failed', {
          mode,
          date: date.toISOString(),
          status: err?.status,
          statusText: err?.statusText,
          url: err?.url,
          error: err?.error,
          errorMessage: err?.error?.message,
          errorName: err?.error?.name,
        });
        console.error('[EmployeeSchedule] raw error object:', err);
        this.error.set('Failed to load your schedule. Please try again.');
        this.loading.set(false);
      },
    });

    // Available shifts are only relevant in day view; skip the call for other modes.
    if (mode === 'day') {
      this.loadAvailableShifts(dateKey);
    }
  }

  /**
   * Fetches available-for-pickup shifts from coworkers for the given date.
   * Called only from load() when in day view. Errors are silently suppressed
   * because the "Available from coworkers" section is hidden when the response is empty.
   */
  private loadAvailableShifts(dateKey: string): void {
    this.availableShiftsLoading.set(true);
    this.shiftsService.listAvailableShifts(dateKey).subscribe({
      next: (shifts) => {
        this.availableShifts.set(shifts);
        this.availableShiftsLoading.set(false);
      },
      error: () => {
        // Silently suppress — the section stays hidden when unavailable.
        this.availableShiftsError.set('unavailable');
        this.availableShiftsLoading.set(false);
      },
    });
  }

  // ── Navigation handlers ─────────────────────────────────────────────────────

  /**
   * Moves the current date backwards by one unit of the active view:
   * day view → -1 day, week view → -7 days, month view → -1 month.
   */
  protected navigatePrev(): void {
    const d = new Date(this.currentDate());
    const mode = this.viewMode();
    if (mode === 'day') {
      d.setDate(d.getDate() - 1);
    } else if (mode === 'week') {
      d.setDate(d.getDate() - 7);
    } else {
      d.setMonth(d.getMonth() - 1);
    }
    this.currentDate.set(d);
  }

  /**
   * Moves the current date forwards by one unit of the active view:
   * day view → +1 day, week view → +7 days, month view → +1 month.
   */
  protected navigateNext(): void {
    const d = new Date(this.currentDate());
    const mode = this.viewMode();
    if (mode === 'day') {
      d.setDate(d.getDate() + 1);
    } else if (mode === 'week') {
      d.setDate(d.getDate() + 7);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
    this.currentDate.set(d);
  }

  /**
   * Resets the current date to today, anchoring all views to the current period.
   * Only shown when the current period doesn't include today.
   */
  protected navigateToday(): void {
    this.currentDate.set(new Date());
  }

  /**
   * Switches the active view mode. Resets to today when switching views so the
   * user always lands on a sensible period rather than an arbitrary past/future date.
   */
  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    this.currentDate.set(new Date());
    this.selectedDate.set(null);
  }

  /** Re-triggers the current view's data load. Used by the error-alert retry button. */
  protected retry(): void {
    this.load(this.viewMode(), this.currentDate());
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────

  /**
   * Converts a 24-hour HH:MM time string to a human-readable 12-hour format.
   * e.g. "14:00" → "2 PM", "09:30" → "9:30 AM".
   */
  protected formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const period = h < 12 ? 'AM' : 'PM';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, '0')} ${period}`;
  }
}
