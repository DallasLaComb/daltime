import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import type { ManagerLocation } from '../../../core/models/manager-location.model';
import type { ShiftNeeded } from '../../../core/models/manager-shift-needed.model';
import {
  ButtonComponent,
  EmptyStateComponent,
  ErrorAlertComponent,
  LoadingSpinnerComponent,
} from '@common-daltime';
import { ManagerLocationsService } from './locations.service';
import { ManagerShiftsNeededService } from './shifts-needed.service';
import { ScheduleTemplatesService } from './schedule-templates.service';
import type {
  ScheduleTemplate,
  CreateScheduleTemplateBody,
  UpdateScheduleTemplateBody,
  ApplyScheduleTemplateBody,
} from './schedule-templates.service';
import { getFederalHolidaysInRange, type FederalHoliday } from '../../../core/utils/us-federal-holidays';
import {
  formatMonthLabel,
  formatShortDateLabel,
  addMonths,
  toMonthKey,
} from '../../../core/utils/schedule.utils';

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

interface TemplateBlockForm {
  days: DayKey[];
  start_time: string;
  end_time: string;
  employee_count: number;
}

interface ShiftGroup {
  dateLabel: string;
  date: string;
  shifts: ShiftNeeded[];
}

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DAYS_DISPLAY = [
  { key: 'mon' as DayKey, label: 'Mon' },
  { key: 'tue' as DayKey, label: 'Tue' },
  { key: 'wed' as DayKey, label: 'Wed' },
  { key: 'thu' as DayKey, label: 'Thu' },
  { key: 'fri' as DayKey, label: 'Fri' },
  { key: 'sat' as DayKey, label: 'Sat' },
  { key: 'sun' as DayKey, label: 'Sun' },
];

function getNextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return toMonthKey(d);
}

function getCurrentMonth(): string {
  return toMonthKey(new Date());
}

@Component({
  selector: 'app-manager-shifts-needed',
  imports: [ButtonComponent, EmptyStateComponent, ErrorAlertComponent, LoadingSpinnerComponent],
  templateUrl: './shifts-needed.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManagerShiftsNeededComponent {
  private readonly shiftsService = inject(ManagerShiftsNeededService);
  private readonly locationsService = inject(ManagerLocationsService);
  private readonly templatesService = inject(ScheduleTemplatesService);

  // ── Exposed constants for template ──────────────────────────────────────────
  readonly DAYS_DISPLAY = DAYS_DISPLAY;

  // ── Month navigation ─────────────────────────────────────────────────────────
  readonly targetMonth = signal(getNextMonth());
  readonly shifts = signal<ShiftNeeded[]>([]);
  readonly locations = signal<ManagerLocation[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // ── Add / Edit shift form ─────────────────────────────────────────────────────
  readonly formOpen = signal(false);
  readonly editingShift = signal<ShiftNeeded | null>(null);
  readonly formDate = signal('');
  readonly formStartTime = signal('');
  readonly formEndTime = signal('');
  readonly formEmployeeCount = signal(1);
  readonly formLocationId = signal('');
  readonly formNotes = signal('');
  readonly formSubmitted = signal(false);
  readonly formSaving = signal(false);
  readonly formError = signal<string | null>(null);

  readonly deletingShiftId = signal<string | null>(null);
  readonly deleteError = signal<string | null>(null);

  // ── Templates panel ──────────────────────────────────────────────────────────
  readonly templatesPanelOpen = signal(false);
  readonly templates = signal<ScheduleTemplate[]>([]);
  readonly templatesLoading = signal(false);
  readonly templatesError = signal<string | null>(null);

  // Template create/edit form (inside panel)
  readonly editingTemplate = signal<ScheduleTemplate | null>(null);
  readonly tplFormOpen = signal(false);
  readonly tplFormName = signal('');
  readonly tplFormLocationId = signal('');
  readonly tplFormBlocks = signal<TemplateBlockForm[]>([]);
  readonly tplFormSubmitted = signal(false);
  readonly tplFormSaving = signal(false);
  readonly tplFormError = signal<string | null>(null);
  readonly tplDeletingId = signal<string | null>(null);

  // ── Apply wizard ─────────────────────────────────────────────────────────────
  readonly applyWizardOpen = signal(false);
  readonly applyTemplateTarget = signal<ScheduleTemplate | null>(null);
  readonly applyStep = signal<1 | 2 | 3>(1);
  readonly applyStartDate = signal('');
  readonly applyEndDate = signal('');
  readonly applyHolidays = signal<FederalHoliday[]>([]);
  readonly applySkipDates = signal<Set<string>>(new Set());
  readonly applyStep1Submitted = signal(false);
  readonly applySubmitting = signal(false);
  readonly applyError = signal<string | null>(null);
  readonly applyResult = signal<string | null>(null);

  // ── Computed ─────────────────────────────────────────────────────────────────
  readonly monthLabel = computed(() => formatMonthLabel(this.targetMonth()));
  readonly canGoPrev = computed(() => this.targetMonth() > getCurrentMonth());

  readonly shiftGroups = computed<ShiftGroup[]>(() => {
    const map = new Map<string, ShiftNeeded[]>();
    for (const s of this.shifts()) {
      const group = map.get(s.date) ?? [];
      group.push(s);
      map.set(s.date, group);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({
        date,
        dateLabel: formatShortDateLabel(date),
        shifts: [...items].sort((a, b) => a.start_time.localeCompare(b.start_time)),
      }));
  });

  readonly templatesByLocation = computed(() => {
    const groups = new Map<string, { locationName: string; templates: ScheduleTemplate[] }>();
    for (const t of this.templates()) {
      if (!groups.has(t.location_id)) {
        groups.set(t.location_id, { locationName: t.location_name, templates: [] });
      }
      groups.get(t.location_id)!.templates.push(t);
    }
    return Array.from(groups.values()).sort((a, b) =>
      a.locationName.localeCompare(b.locationName),
    );
  });

  readonly applyTotalSteps = computed(() => (this.applyHolidays().length > 0 ? 3 : 2));

  readonly applyPreviewCount = computed(() => {
    const template = this.applyTemplateTarget();
    const start = this.applyStartDate();
    const end = this.applyEndDate();
    if (!template || !start || !end || end < start) return null;

    const skipSet = this.applySkipDates();
    let count = 0;
    let cursor = new Date(`${start}T12:00:00Z`);
    const endDate = new Date(`${end}T12:00:00Z`);

    while (cursor <= endDate) {
      const dateStr = cursor.toISOString().slice(0, 10);
      if (!skipSet.has(dateStr)) {
        const dayKey = DAY_KEYS[cursor.getUTCDay()];
        count += template.shift_blocks.filter((b) =>
          (b.days as string[]).includes(dayKey),
        ).length;
      }
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    return count;
  });

  constructor() {
    this.loadAll();
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  loadAll(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      shifts: this.shiftsService.list(this.targetMonth()),
      locations: this.locationsService.list(),
    }).subscribe({
      next: ({ shifts, locations }) => {
        this.shifts.set(shifts);
        this.locations.set(locations);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load data. Please try again.');
        this.loading.set(false);
      },
    });
  }

  prevMonth(): void {
    if (!this.canGoPrev()) return;
    this.targetMonth.set(addMonths(this.targetMonth(), -1));
    this.loadShifts();
  }

  nextMonth(): void {
    this.targetMonth.set(addMonths(this.targetMonth(), 1));
    this.loadShifts();
  }

  private loadShifts(): void {
    this.loading.set(true);
    this.error.set(null);
    this.shiftsService.list(this.targetMonth()).subscribe({
      next: (shifts) => {
        this.shifts.set(shifts);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load shifts. Please try again.');
        this.loading.set(false);
      },
    });
  }

  // ── Shift add/edit ────────────────────────────────────────────────────────────

  openAddForm(): void {
    this.editingShift.set(null);
    this.formDate.set('');
    this.formStartTime.set('');
    this.formEndTime.set('');
    this.formEmployeeCount.set(1);
    this.formLocationId.set(this.locations()[0]?.location_id ?? '');
    this.formNotes.set('');
    this.formSubmitted.set(false);
    this.formError.set(null);
    this.formOpen.set(true);
  }

  openEditForm(shift: ShiftNeeded): void {
    this.editingShift.set(shift);
    this.formDate.set(shift.date);
    this.formStartTime.set(shift.start_time);
    this.formEndTime.set(shift.end_time);
    this.formEmployeeCount.set(shift.employee_count);
    this.formLocationId.set(shift.location_id);
    this.formNotes.set(shift.notes ?? '');
    this.formSubmitted.set(false);
    this.formError.set(null);
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
    this.editingShift.set(null);
  }

  saveShift(): void {
    this.formSubmitted.set(true);

    const date = this.formDate();
    const startTime = this.formStartTime();
    const endTime = this.formEndTime();
    const locationId = this.formLocationId();
    const employeeCount = this.formEmployeeCount();

    if (!date || !startTime || !endTime || !locationId || employeeCount < 1) return;

    this.formSaving.set(true);
    this.formError.set(null);

    const body = {
      date,
      start_time: startTime,
      end_time: endTime,
      employee_count: employeeCount,
      location_id: locationId,
      ...(this.formNotes().trim() ? { notes: this.formNotes().trim() } : {}),
    };

    const editing = this.editingShift();
    const request$ = editing
      ? this.shiftsService.update(editing.shift_id, body)
      : this.shiftsService.create(body);

    request$.subscribe({
      next: (saved) => {
        if (editing) {
          this.shifts.update((list) =>
            list.map((s) => (s.shift_id === saved.shift_id ? saved : s)),
          );
        } else {
          this.shifts.update((list) => [...list, saved]);
        }
        this.formSaving.set(false);
        this.closeForm();
      },
      error: (err: { error?: { error?: string } }) => {
        this.formSaving.set(false);
        this.formError.set(err?.error?.error ?? 'Failed to save shift');
      },
    });
  }

  deleteShift(shift: ShiftNeeded): void {
    this.deletingShiftId.set(shift.shift_id);
    this.deleteError.set(null);
    this.shiftsService.remove(shift.shift_id).subscribe({
      next: () => {
        this.shifts.update((list) => list.filter((s) => s.shift_id !== shift.shift_id));
        this.deletingShiftId.set(null);
      },
      error: () => {
        this.deletingShiftId.set(null);
        this.deleteError.set('Failed to delete shift. Please try again.');
      },
    });
  }

  // ── Templates panel ──────────────────────────────────────────────────────────

  openTemplatesPanel(): void {
    this.templatesPanelOpen.set(true);
    this.tplFormOpen.set(false);
    if (this.templates().length === 0) {
      this.loadTemplates();
    }
  }

  closeTemplatesPanel(): void {
    this.templatesPanelOpen.set(false);
    this.tplFormOpen.set(false);
    this.editingTemplate.set(null);
  }

  private loadTemplates(): void {
    this.templatesLoading.set(true);
    this.templatesError.set(null);
    this.templatesService.list().subscribe({
      next: (list) => {
        this.templates.set(list);
        this.templatesLoading.set(false);
      },
      error: () => {
        this.templatesError.set('Failed to load templates. Please try again.');
        this.templatesLoading.set(false);
      },
    });
  }

  openAddTemplate(): void {
    this.editingTemplate.set(null);
    this.tplFormName.set('');
    this.tplFormLocationId.set(this.locations()[0]?.location_id ?? '');
    this.tplFormBlocks.set([{ days: [], start_time: '', end_time: '', employee_count: 1 }]);
    this.tplFormSubmitted.set(false);
    this.tplFormError.set(null);
    this.tplFormOpen.set(true);
  }

  openEditTemplate(t: ScheduleTemplate): void {
    this.editingTemplate.set(t);
    this.tplFormName.set(t.name);
    this.tplFormLocationId.set(t.location_id);
    this.tplFormBlocks.set(
      t.shift_blocks.map((b) => ({
        days: [...b.days] as DayKey[],
        start_time: b.start_time,
        end_time: b.end_time,
        employee_count: b.employee_count,
      })),
    );
    this.tplFormSubmitted.set(false);
    this.tplFormError.set(null);
    this.tplFormOpen.set(true);
  }

  closeTemplateForm(): void {
    this.tplFormOpen.set(false);
    this.editingTemplate.set(null);
  }

  addTemplateBlock(): void {
    this.tplFormBlocks.update((blocks) => [
      ...blocks,
      { days: [], start_time: '', end_time: '', employee_count: 1 },
    ]);
  }

  removeTemplateBlock(idx: number): void {
    this.tplFormBlocks.update((blocks) => blocks.filter((_, i) => i !== idx));
  }

  toggleBlockDay(idx: number, day: DayKey): void {
    this.tplFormBlocks.update((blocks) =>
      blocks.map((b, i) => {
        if (i !== idx) return b;
        const days = b.days.includes(day)
          ? b.days.filter((d) => d !== day)
          : ([...b.days, day] as DayKey[]);
        return { ...b, days };
      }),
    );
  }

  updateBlockTime(idx: number, field: 'start_time' | 'end_time', value: string): void {
    this.tplFormBlocks.update((blocks) =>
      blocks.map((b, i) => (i === idx ? { ...b, [field]: value } : b)),
    );
  }

  updateBlockCount(idx: number, value: number): void {
    this.tplFormBlocks.update((blocks) =>
      blocks.map((b, i) => (i === idx ? { ...b, employee_count: value } : b)),
    );
  }

  blockDaysValid(block: TemplateBlockForm): boolean {
    return block.days.length > 0;
  }

  blockTimesValid(block: TemplateBlockForm): boolean {
    return !!(block.start_time && block.end_time && block.end_time > block.start_time);
  }

  blockHasDay(block: TemplateBlockForm, day: DayKey): boolean {
    return block.days.includes(day);
  }

  saveTemplate(): void {
    this.tplFormSubmitted.set(true);

    const name = this.tplFormName().trim();
    const locationId = this.tplFormLocationId();
    const blocks = this.tplFormBlocks();
    const editing = this.editingTemplate();

    if (!name) return;
    if (!editing && !locationId) return;
    if (blocks.length === 0) return;
    for (const b of blocks) {
      if (!this.blockDaysValid(b) || !this.blockTimesValid(b)) return;
    }

    this.tplFormSaving.set(true);
    this.tplFormError.set(null);

    const shiftBlocks = blocks.map((b) => ({
      days: b.days,
      start_time: b.start_time,
      end_time: b.end_time,
      employee_count: b.employee_count,
    }));

    if (editing) {
      const body: UpdateScheduleTemplateBody = { name, shift_blocks: shiftBlocks };
      this.templatesService.update(editing.template_id, body).subscribe({
        next: (updated) => {
          this.templates.update((list) =>
            list.map((t) => (t.template_id === updated.template_id ? updated : t)),
          );
          this.tplFormSaving.set(false);
          this.closeTemplateForm();
        },
        error: (err: { error?: { error?: string } }) => {
          this.tplFormSaving.set(false);
          this.tplFormError.set(err?.error?.error ?? 'Failed to save template');
        },
      });
    } else {
      const body: CreateScheduleTemplateBody = {
        location_id: locationId,
        name,
        shift_blocks: shiftBlocks,
      };
      this.templatesService.create(body).subscribe({
        next: (created) => {
          this.templates.update((list) => [...list, created]);
          this.tplFormSaving.set(false);
          this.closeTemplateForm();
        },
        error: (err: { error?: { error?: string } }) => {
          this.tplFormSaving.set(false);
          this.tplFormError.set(err?.error?.error ?? 'Failed to save template');
        },
      });
    }
  }

  deleteTemplate(t: ScheduleTemplate): void {
    this.tplDeletingId.set(t.template_id);
    this.templatesService.remove(t.template_id).subscribe({
      next: () => {
        this.templates.update((list) => list.filter((x) => x.template_id !== t.template_id));
        this.tplDeletingId.set(null);
      },
      error: () => {
        this.tplDeletingId.set(null);
      },
    });
  }

  // ── Apply wizard ─────────────────────────────────────────────────────────────

  openApplyWizard(t: ScheduleTemplate): void {
    this.closeTemplatesPanel();
    this.applyTemplateTarget.set(t);
    this.applyStep.set(1);
    this.applyStartDate.set('');
    this.applyEndDate.set('');
    this.applyHolidays.set([]);
    this.applySkipDates.set(new Set());
    this.applyStep1Submitted.set(false);
    this.applyError.set(null);
    this.applyWizardOpen.set(true);
  }

  closeApplyWizard(): void {
    this.applyWizardOpen.set(false);
    this.applyTemplateTarget.set(null);
    this.applySubmitting.set(false);
    this.applyError.set(null);
  }

  advanceApplyStep1(): void {
    this.applyStep1Submitted.set(true);
    const start = this.applyStartDate();
    const end = this.applyEndDate();
    if (!start || !end || end < start) return;

    const holidays = getFederalHolidaysInRange(start, end);
    this.applyHolidays.set(holidays);

    // Default all holidays to "closed" (skipped)
    const skipSet = new Set<string>(holidays.map((h) => h.date));
    this.applySkipDates.set(skipSet);

    this.applyStep.set(holidays.length > 0 ? 2 : 3);
  }

  backApplyStep(): void {
    const current = this.applyStep();
    if (current === 2) this.applyStep.set(1);
    else if (current === 3) this.applyStep.set(this.applyHolidays().length > 0 ? 2 : 1);
  }

  advanceApplyToStep3(): void {
    this.applyStep.set(3);
  }

  toggleApplySkipDate(date: string): void {
    this.applySkipDates.update((s) => {
      const next = new Set(s);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }

  isHolidaySkipped(date: string): boolean {
    return this.applySkipDates().has(date);
  }

  today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  maxEndDate(): string {
    const start = this.applyStartDate();
    if (!start) return '';
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 365);
    return d.toISOString().slice(0, 10);
  }

  confirmApply(): void {
    const template = this.applyTemplateTarget();
    if (!template) return;

    this.applySubmitting.set(true);
    this.applyError.set(null);

    const body: ApplyScheduleTemplateBody = {
      start_date: this.applyStartDate(),
      end_date: this.applyEndDate(),
      skip_dates: Array.from(this.applySkipDates()),
    };

    this.templatesService.apply(template.template_id, body).subscribe({
      next: (result) => {
        this.applySubmitting.set(false);
        this.closeApplyWizard();
        this.applyResult.set(
          `${result.created} shift${result.created === 1 ? '' : 's'} created from template "${template.name}"`,
        );
        this.loadShifts();
      },
      error: (err: { error?: { error?: string } }) => {
        this.applySubmitting.set(false);
        this.applyError.set(err?.error?.error ?? 'Failed to apply template');
      },
    });
  }

  dismissApplyResult(): void {
    this.applyResult.set(null);
  }

  // ── Display helpers ──────────────────────────────────────────────────────────

  blockSummary(t: ScheduleTemplate): string {
    const count = t.shift_blocks.length;
    return `${count} block${count === 1 ? '' : 's'}`;
  }

  dayRangeLabel(days: readonly string[]): string {
    const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const labels: Record<string, string> = {
      mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
    };
    return [...days]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((d) => labels[d] ?? d)
      .join(', ');
  }

  employeeLabel(count: number): string {
    return count === 1 ? '1 employee' : `${count} employees`;
  }

  // ── Track-by helpers ─────────────────────────────────────────────────────────

  trackByShiftId(_: number, s: ShiftNeeded): string {
    return s.shift_id;
  }

  trackByDate(_: number, g: ShiftGroup): string {
    return g.date;
  }

  trackByLocationId(_: number, l: ManagerLocation): string {
    return l.location_id;
  }

  trackByTemplateId(_: number, t: ScheduleTemplate): string {
    return t.template_id;
  }

  trackByIndex(idx: number): number {
    return idx;
  }

  trackByHolidayDate(_: number, h: FederalHoliday): string {
    return h.date;
  }
}
