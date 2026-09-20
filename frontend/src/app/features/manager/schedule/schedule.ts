import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { forkJoin } from 'rxjs';
import type { Shift, ShiftType, CreateShiftBody } from '../../../core/models/shift.model';
import type { ShiftNeeded } from '../../../core/models/manager-shift-needed.model';
import type {
  DayAvailability,
  DayOfWeek,
  WeeklySchedule,
} from '../../../core/models/employee-availability.model';
import { toDateKey, toMonthKey, buildViewLabel } from '../../../core/utils/schedule.utils';
import { ScheduleBaseComponent } from '../../../core/utils/schedule-base';
import { ManagerShiftsService } from './shifts.service';
import { ManagerScheduleService } from './schedule.service';
import { ManagerEmployeesService } from '../employees/employees.service';
import { ManagerLocationsService } from '../shifts-needed/locations.service';
import { ManagerShiftsNeededService } from '../shifts-needed/shifts-needed.service';
import { ManagerEmployeeAvailabilityService } from './employee-availability.service';
import type { EmployeeAvailabilityBundle } from './employee-availability.service';
import { DatePipe } from '@angular/common';
import {
  ButtonComponent,
  LoadingSpinnerComponent,
  ErrorAlertComponent,
  EmptyStateComponent,
  ScheduleFiltersComponent,
  ScheduleViewToggleComponent,
  ScheduleNavComponent,
} from '@common-daltime';

export type ViewMode = 'day' | 'week' | 'month' | 'availability' | 'fill-shift';

export interface UnfilledSlot {
  shiftNeeded: ShiftNeeded;
  /** How many more employees are needed for this slot */
  remaining: number;
}

const DOW_NAMES: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

function dayOfWeek(date: string): DayOfWeek {
  const [y, m, d] = date.split('-').map(Number);
  return DOW_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function toMins(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function effectiveDayAvail(
  date: string,
  schedule: Record<string, DayAvailability> | null | undefined,
  overrides: Record<string, DayAvailability> | null | undefined,
): DayAvailability | null {
  if (overrides?.[date]) return overrides[date];
  if (!schedule) return null;
  return schedule[dayOfWeek(date)] ?? null;
}

function isAvailableFor(
  avail: DayAvailability | null,
  startTime: string,
  endTime: string,
): boolean {
  if (!avail?.available || !avail.slots?.length) return false;
  return avail.slots.some(
    (s) => toMins(s.from) <= toMins(startTime) && toMins(s.to) >= toMins(endTime),
  );
}

function weekBounds(date: string): { startKey: string; endKey: string } {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const dow = day.getUTCDay(); // 0 = Sunday
  const sunday = new Date(day);
  sunday.setUTCDate(day.getUTCDate() - dow);
  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    startKey: sunday.toISOString().slice(0, 10),
    endKey: saturday.toISOString().slice(0, 10),
  };
}

function weeklyHoursForEmployee(employeeId: string, targetDate: string, shifts: Shift[]): number {
  const { startKey, endKey } = weekBounds(targetDate);
  return shifts
    .filter((s) => s.employee_id === employeeId && s.date >= startKey && s.date <= endKey)
    .reduce((total, s) => total + (toMins(s.end_time) - toMins(s.start_time)) / 60, 0);
}

@Component({
  selector: 'app-manager-schedule',
  imports: [
    DatePipe,
    ButtonComponent,
    LoadingSpinnerComponent,
    ErrorAlertComponent,
    EmptyStateComponent,
    ScheduleFiltersComponent,
    ScheduleViewToggleComponent,
    ScheduleNavComponent,
  ],
  templateUrl: './schedule.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManagerSchedule extends ScheduleBaseComponent implements OnInit {
  private readonly shiftsService = inject(ManagerShiftsService);
  private readonly scheduleService = inject(ManagerScheduleService);
  private readonly employeesService = inject(ManagerEmployeesService);
  private readonly locationsService = inject(ManagerLocationsService);
  private readonly shiftsNeededService = inject(ManagerShiftsNeededService);
  private readonly availabilityService = inject(ManagerEmployeeAvailabilityService);

  protected override readonly viewMode = signal<ViewMode>('month');

  protected readonly allShiftsNeeded = signal<ShiftNeeded[]>([]);
  protected readonly availabilityBundles = signal<Map<string, EmployeeAvailabilityBundle>>(
    new Map(),
  );

  // ── Modal state ──────────────────────────────────────────────────────────────
  protected readonly modalOpen = signal(false);
  protected readonly editingShift = signal<Shift | null>(null);
  protected readonly formDate = signal('');
  protected readonly formEmployeeId = signal('');
  protected readonly formLocationId = signal('');
  protected readonly formStartTime = signal('');
  protected readonly formEndTime = signal('');
  protected readonly formType = signal<ShiftType>('morning');
  protected readonly modalSaving = signal(false);
  protected readonly modalError = signal<string | null>(null);
  protected readonly showDeleteConfirm = signal(false);

  protected readonly generating = signal(false);
  protected readonly publishing = signal(false);
  protected readonly scheduleActionResult = signal<string | null>(null);

  protected readonly draftRunCount = signal(0);
  protected readonly maxDraftRuns = signal(10);
  protected readonly draftLimitReached = computed(
    () => this.draftRunCount() >= this.maxDraftRuns(),
  );

  // ── Feature #166: Unfilled shifts-needed ─────────────────────────────────────

  protected readonly unfilledSlots = computed<UnfilledSlot[]>(() => {
    const shifts = this.allShifts();
    const result: UnfilledSlot[] = [];
    for (const sn of this.allShiftsNeeded()) {
      const filled = shifts.filter(
        (s) =>
          s.date === sn.date &&
          s.location_id === sn.location_id &&
          s.start_time === sn.start_time &&
          s.end_time === sn.end_time &&
          s.employee_id !== '',
      ).length;
      const remaining = sn.employee_count - filled;
      if (remaining > 0) result.push({ shiftNeeded: sn, remaining });
    }
    return result;
  });

  protected readonly unfilledByDate = computed(() => {
    const map = new Map<string, UnfilledSlot[]>();
    for (const slot of this.unfilledSlots()) {
      const existing = map.get(slot.shiftNeeded.date) ?? [];
      map.set(slot.shiftNeeded.date, [...existing, slot]);
    }
    return map;
  });

  // ── Feature #165: Availability view ──────────────────────────────────────────

  protected readonly DAYS_DISPLAY: { key: DayOfWeek; label: string }[] = [
    { key: 'monday', label: 'Mon' },
    { key: 'tuesday', label: 'Tue' },
    { key: 'wednesday', label: 'Wed' },
    { key: 'thursday', label: 'Thu' },
    { key: 'friday', label: 'Fri' },
    { key: 'saturday', label: 'Sat' },
    { key: 'sunday', label: 'Sun' },
  ];

  protected readonly availabilityRows = computed(() =>
    this.employees().map((emp) => {
      const bundle = this.availabilityBundles().get(emp.employee_id);
      return { employee: emp, bundle: bundle ?? null };
    }),
  );

  protected readonly showUnavailableCandidates = signal(false);

  // ── Fill-shift tab ────────────────────────────────────────────────────────────

  protected readonly selectedUnfilledSlot = signal<UnfilledSlot | null>(null);
  /** Holds the existing Shift record when the Fill Shift view was opened from an amber (unassigned) chip. */
  protected readonly selectedEmptyShift = signal<Shift | null>(null);
  protected readonly fillShiftReturnMode = signal<Exclude<ViewMode, 'fill-shift'>>('month');
  protected readonly fillShiftSaving = signal(false);
  protected readonly fillShiftError = signal<string | null>(null);
  protected readonly fillShiftSuccess = signal<string | null>(null);

  protected readonly fillShiftRemaining = computed(() => {
    // When in existing-shift mode (amber chip), there is exactly 1 slot to fill.
    if (this.selectedEmptyShift()) return 1;
    const slot = this.selectedUnfilledSlot();
    if (!slot) return 0;
    const sn = slot.shiftNeeded;
    return Math.max(
      0,
      sn.employee_count -
        this.allShifts().filter(
          (s) =>
            s.date === sn.date &&
            s.location_id === sn.location_id &&
            s.start_time === sn.start_time &&
            s.end_time === sn.end_time,
        ).length,
    );
  });

  protected readonly fillShiftCandidates = computed(() => {
    const date = this.formDate();
    const start = this.formStartTime();
    const end = this.formEndTime();
    if (!date || !start || !end) return [];
    const shiftHours = (toMins(end) - toMins(start)) / 60;
    return this.employees()
      .map((emp) => {
        const bundle = this.availabilityBundles().get(emp.employee_id);
        const avail = effectiveDayAvail(
          date,
          bundle?.availability?.schedule,
          bundle?.overrides?.overrides,
        );
        const availableSlots = bundle?.availability?.schedule?.[dayOfWeek(date)]?.slots ?? null;
        const available = isAvailableFor(avail, start, end);
        const weekHours = weeklyHoursForEmployee(emp.employee_id, date, this.allShifts());
        const wouldExceed = weekHours + shiftHours > 39;
        return { employee: emp, available, availableSlots, weekHours, wouldExceed };
      })
      .sort((a, b) => {
        if (a.available !== b.available) return a.available ? -1 : 1;
        return a.weekHours - b.weekHours;
      });
  });

  protected readonly hasDrafts = computed(() => this.allShifts().some((s) => s.status === 'draft'));
  protected readonly draftCount = computed(
    () => this.allShifts().filter((s) => s.status === 'draft').length,
  );
  protected readonly publishedCount = computed(
    () => this.allShifts().filter((s) => s.status === 'published').length,
  );

  protected readonly viewLabel = computed(() =>
    buildViewLabel(this.currentDate(), this.viewMode() as 'day' | 'week' | 'month'),
  );

  ngOnInit(): void {
    this.loadAll();
  }

  private loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    const month = toMonthKey(this.currentDate());
    forkJoin({
      shifts: this.shiftsService.list(month),
      employees: this.employeesService.getAll(),
      locations: this.locationsService.list(),
      shiftsNeeded: this.shiftsNeededService.list(month),
      meta: this.scheduleService.getMeta(month),
    }).subscribe({
      next: ({ shifts, employees, locations, shiftsNeeded, meta }) => {
        this.allShifts.set(shifts);
        this.employees.set(employees);
        this.locations.set(locations);
        this.allShiftsNeeded.set(shiftsNeeded);
        this.draftRunCount.set(meta.draftCount);
        this.maxDraftRuns.set(meta.maxDrafts);
        this.loading.set(false);
        this.loadAvailability(employees.map((e) => e.employee_id));
      },
      error: () => {
        this.error.set('Failed to load schedule. Please try again.');
        this.loading.set(false);
      },
    });
  }

  private loadAvailability(employeeIds: string[]): void {
    this.availabilityService.getAllBundles(employeeIds).subscribe({
      next: (bundles) => this.availabilityBundles.set(bundles),
    });
  }

  protected override loadShifts(): void {
    const month = toMonthKey(this.currentDate());
    forkJoin({
      shifts: this.shiftsService.list(month),
      shiftsNeeded: this.shiftsNeededService.list(month),
      meta: this.scheduleService.getMeta(month),
    }).subscribe({
      next: ({ shifts, shiftsNeeded, meta }) => {
        this.allShifts.set(shifts);
        this.allShiftsNeeded.set(shiftsNeeded);
        this.draftRunCount.set(meta.draftCount);
        this.maxDraftRuns.set(meta.maxDrafts);
      },
      error: () => this.error.set('Failed to refresh shifts.'),
    });
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  // ── Modal ────────────────────────────────────────────────────────────────────

  protected openCreateModal(prefillDate?: string): void {
    this.editingShift.set(null);
    this.formDate.set(prefillDate ?? toDateKey(this.currentDate()));
    this.formEmployeeId.set('');
    this.formLocationId.set(this.locations()[0]?.location_id ?? '');
    this.formStartTime.set('09:00');
    this.formEndTime.set('17:00');
    this.formType.set('morning');
    this.modalError.set(null);
    this.showDeleteConfirm.set(false);
    this.modalOpen.set(true);
  }

  protected openFillShiftView(slot: UnfilledSlot): void {
    const sn = slot.shiftNeeded;
    this.selectedUnfilledSlot.set(slot);
    this.formDate.set(sn.date);
    this.formEmployeeId.set('');
    this.formLocationId.set(sn.location_id);
    this.formStartTime.set(sn.start_time);
    this.formEndTime.set(sn.end_time);
    const hour = Number.parseInt(sn.start_time.split(':')[0], 10);
    let formType: 'morning' | 'afternoon' | 'night';
    if (hour < 12) {
      formType = 'morning';
    } else if (hour < 17) {
      formType = 'afternoon';
    } else {
      formType = 'night';
    }
    this.formType.set(formType);
    this.fillShiftError.set(null);
    this.fillShiftSuccess.set(null);
    this.fillShiftReturnMode.set(
      this.viewMode() === 'fill-shift'
        ? this.fillShiftReturnMode()
        : (this.viewMode() as Exclude<ViewMode, 'fill-shift'>),
    );
    this.viewMode.set('fill-shift');
  }

  /**
   * Opens the Fill Shift view for an existing Shift record that has no assigned employee
   * (amber chip — scheduler ran but found no candidate, or shift was created without one).
   * Instead of creating a new Shift on assign, this path PATCHes the existing record.
   */
  protected openFillShiftViewForExistingShift(shift: Shift): void {
    this.selectedEmptyShift.set(shift);
    this.formDate.set(shift.date);
    this.formEmployeeId.set('');
    this.formLocationId.set(shift.location_id);
    this.formStartTime.set(shift.start_time);
    this.formEndTime.set(shift.end_time);
    const hour = Number.parseInt(shift.start_time.split(':')[0], 10);
    this.formType.set(hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'night');
    this.fillShiftError.set(null);
    this.fillShiftSuccess.set(null);
    this.fillShiftReturnMode.set(
      this.viewMode() === 'fill-shift'
        ? this.fillShiftReturnMode()
        : (this.viewMode() as Exclude<ViewMode, 'fill-shift'>),
    );
    this.viewMode.set('fill-shift');
  }

  protected closeFillShiftView(): void {
    this.viewMode.set(this.fillShiftReturnMode());
    this.selectedUnfilledSlot.set(null);
    // Clear existing-shift state so fill view resets on next open.
    this.selectedEmptyShift.set(null);
    this.fillShiftError.set(null);
    this.fillShiftSuccess.set(null);
  }

  protected assignFromFillView(employeeId: string): void {
    // When an amber (unassigned) Shift record was clicked, PATCH it instead of creating a new one.
    const emptyShift = this.selectedEmptyShift();
    if (emptyShift) {
      this.fillShiftSaving.set(true);
      this.fillShiftError.set(null);
      this.fillShiftSuccess.set(null);
      this.shiftsService.update(emptyShift.shift_id, { employee_id: employeeId }).subscribe({
        next: (updated) => {
          this.fillShiftSaving.set(false);
          // Replace the old unassigned record in-memory with the updated one.
          this.allShifts.update((s) =>
            s.map((sh) => (sh.shift_id === updated.shift_id ? updated : sh)),
          );
          this.closeFillShiftView();
        },
        error: (err: { error?: { message?: string } }) => {
          this.fillShiftSaving.set(false);
          this.fillShiftError.set(err?.error?.message ?? 'Failed to assign employee');
        },
      });
      return;
    }

    // ShiftNeeded (red chip) path — create a new Shift record for the unfilled slot.
    const sn = this.selectedUnfilledSlot()?.shiftNeeded;
    if (!sn) return;
    this.fillShiftSaving.set(true);
    this.fillShiftError.set(null);
    this.fillShiftSuccess.set(null);
    const body: CreateShiftBody = {
      employee_id: employeeId,
      location_id: sn.location_id,
      date: sn.date,
      start_time: sn.start_time,
      end_time: sn.end_time,
      type: this.formType(),
    };
    this.shiftsService.create(body).subscribe({
      next: (shift) => {
        this.fillShiftSaving.set(false);
        this.allShifts.update((s) => [...s, shift]);
        const emp = this.employees().find((e) => e.employee_id === employeeId);
        const name = emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
        if (this.fillShiftRemaining() === 0) {
          this.closeFillShiftView();
        } else {
          this.fillShiftSuccess.set(
            `${name} assigned. ${this.fillShiftRemaining()} slot${this.fillShiftRemaining() === 1 ? '' : 's'} remaining.`,
          );
        }
      },
      error: () => {
        this.fillShiftSaving.set(false);
        this.fillShiftError.set('Failed to assign shift. Please try again.');
      },
    });
  }

  protected openEditModal(shift: Shift): void {
    this.editingShift.set(shift);
    this.formDate.set(shift.date);
    this.formEmployeeId.set(shift.employee_id);
    this.formLocationId.set(shift.location_id);
    this.formStartTime.set(shift.start_time);
    this.formEndTime.set(shift.end_time);
    this.formType.set(shift.type);
    this.modalError.set(null);
    this.showDeleteConfirm.set(false);
    this.modalOpen.set(true);
  }

  /**
   * Routes a shift-chip click to the correct action based on assignment state.
   * Amber shifts (employee_id === '') open the Fill Shift view so the manager can
   * pick an employee from the availability/OT-risk list. Assigned shifts open the
   * standard edit modal so the manager can update times, location, or delete.
   */
  protected openShiftAction(shift: Shift): void {
    if (shift.employee_id === '') {
      this.openFillShiftViewForExistingShift(shift);
    } else {
      this.openEditModal(shift);
    }
  }

  protected closeModal(): void {
    this.modalOpen.set(false);
  }

  protected saveShift(): void {
    if (
      !this.formDate() ||
      !this.formEmployeeId() ||
      !this.formLocationId() ||
      !this.formStartTime() ||
      !this.formEndTime()
    ) {
      this.modalError.set('All fields are required.');
      return;
    }

    const body: CreateShiftBody = {
      employee_id: this.formEmployeeId(),
      location_id: this.formLocationId(),
      date: this.formDate(),
      start_time: this.formStartTime(),
      end_time: this.formEndTime(),
      type: this.formType(),
    };

    this.modalSaving.set(true);
    this.modalError.set(null);

    const editing = this.editingShift();
    const request = editing
      ? this.shiftsService.update(editing.shift_id, body)
      : this.shiftsService.create(body);

    request.subscribe({
      next: () => {
        this.modalOpen.set(false);
        this.modalSaving.set(false);
        this.loadShifts();
      },
      error: () => {
        this.modalError.set('Failed to save shift. Please try again.');
        this.modalSaving.set(false);
      },
    });
  }

  protected confirmDelete(): void {
    this.showDeleteConfirm.set(true);
  }

  protected cancelDelete(): void {
    this.showDeleteConfirm.set(false);
  }

  protected deleteShift(): void {
    const shift = this.editingShift();
    if (!shift) return;
    this.modalSaving.set(true);
    this.shiftsService.remove(shift.shift_id).subscribe({
      next: () => {
        this.modalOpen.set(false);
        this.modalSaving.set(false);
        this.allShifts.update((shifts) => shifts.filter((s) => s.shift_id !== shift.shift_id));
      },
      error: () => {
        this.modalError.set('Failed to delete shift. Please try again.');
        this.modalSaving.set(false);
      },
    });
  }

  // ── Generate / Publish ───────────────────────────────────────────────────────

  protected generateDraft(): void {
    this.generating.set(true);
    this.scheduleActionResult.set(null);
    const month = toMonthKey(this.currentDate());
    this.scheduleService.generateDraft(month).subscribe({
      next: (result) => {
        this.generating.set(false);
        this.draftRunCount.set(result.draftCount);
        this.maxDraftRuns.set(result.maxDrafts);
        const remaining = result.maxDrafts - result.draftCount;
        const runLabel = `Run ${result.draftCount}/${result.maxDrafts}`;
        let msg: string;
        if (result.created === 0 && result.unfilled === 0) {
          msg = `${runLabel}: all slots already filled — no new shifts created.`;
        } else if (result.unfilled > 0) {
          const slotPlural = result.unfilled === 1 ? '' : 's';
          const runPlural = remaining === 1 ? '' : 's';
          msg = `${runLabel}: ${result.created} shifts assigned, ${result.unfilled} slot${slotPlural} still unfilled. ${remaining} run${runPlural} remaining.`;
        } else {
          const shiftPlural = result.created === 1 ? '' : 's';
          const runPlural = remaining === 1 ? '' : 's';
          msg = `${runLabel}: ${result.created} shift${shiftPlural} assigned. ${remaining} run${runPlural} remaining.`;
        }
        this.scheduleActionResult.set(msg);
        this.loadShifts();
      },
      error: (err) => {
        this.generating.set(false);
        const detail = err?.error?.message as string | undefined;
        this.scheduleActionResult.set(
          detail?.includes('Maximum')
            ? detail
            : 'Failed to generate draft schedule. Please try again.',
        );
      },
    });
  }

  protected publishSchedule(): void {
    this.publishing.set(true);
    this.scheduleActionResult.set(null);
    const month = toMonthKey(this.currentDate());
    this.scheduleService.publish(month).subscribe({
      next: (result) => {
        this.publishing.set(false);
        this.scheduleActionResult.set(
          `Schedule published: ${result.published} shifts are now visible to employees.`,
        );
        this.loadShifts();
      },
      error: () => {
        this.publishing.set(false);
        this.scheduleActionResult.set('Failed to publish schedule. Please try again.');
      },
    });
  }

  protected toDateKey(d: Date): string {
    return toDateKey(d);
  }

  // ── Availability view helpers ────────────────────────────────────────────────

  protected dayAvailForEmployee(
    bundle: EmployeeAvailabilityBundle | null,
    dayKey: DayOfWeek,
  ): DayAvailability | null {
    return bundle?.availability?.schedule?.[dayKey] ?? null;
  }

  protected setFormType(event: Event): void {
    this.formType.set((event.target as HTMLSelectElement).value as ShiftType);
  }
}
