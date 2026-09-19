import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { EmployeeAvailabilityService } from './availability.service';
import type {
  DayOfWeek,
  DayAvailability,
  TimeSlot,
  WeeklySchedule,
  DateOverrides,
} from './availability.service';
import { ButtonComponent } from '@common-daltime';

interface DayRow {
  key: DayOfWeek;
  label: string;
}

const DAYS: DayRow[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

export interface CalendarDay {
  date: string; // ISO "YYYY-MM-DD"
  dayOfMonth: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasOverride: boolean;
}

function toISODate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayISO(): string {
  const t = new Date();
  return toISODate(t.getFullYear(), t.getMonth(), t.getDate());
}

function defaultSlot(): TimeSlot {
  return { from: '09:00', to: '17:00' };
}

function defaultSchedule(): WeeklySchedule {
  const schedule: Partial<WeeklySchedule> = {};
  for (const { key } of DAYS) {
    schedule[key] = { available: false };
  }
  return schedule as WeeklySchedule;
}

type Tab = 'weekly' | 'specific';

@Component({
  selector: 'app-employee-availability',
  imports: [ButtonComponent, DatePipe],
  templateUrl: './availability.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeAvailabilityComponent {
  private readonly availabilityService = inject(EmployeeAvailabilityService);

  readonly days = DAYS;

  // ── Tab ──────────────────────────────────────────────────────────────────
  readonly activeTab = signal<Tab>('weekly');

  // ── Weekly schedule ───────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly schedule = signal<WeeklySchedule>(defaultSchedule());
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);
  readonly saveSuccess = signal(false);
  readonly lastSaved = signal<string | null>(null);
  readonly submitted = signal(false);

  readonly deadlineBanner = computed((): { month: string; dueDate: string } => {
    const now = new Date();
    const day = now.getDate();
    const targetDate =
      day <= 15
        ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
        : new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const dueMonth =
      day <= 15
        ? new Date(now.getFullYear(), now.getMonth(), 15)
        : new Date(now.getFullYear(), now.getMonth() + 1, 15);
    return {
      month: targetDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
      dueDate: dueMonth.toLocaleString('default', { month: 'long', day: 'numeric' }),
    };
  });

  readonly weeklyErrors = computed((): Record<DayOfWeek, string | null> => {
    if (!this.submitted()) return {} as Record<DayOfWeek, string | null>;
    const errors: Partial<Record<DayOfWeek, string | null>> = {};
    const sched = this.schedule();
    for (const { key } of DAYS) {
      errors[key] = validateDay(sched[key]);
    }
    return errors as Record<DayOfWeek, string | null>;
  });

  readonly hasErrors = computed(() => Object.values(this.weeklyErrors()).some((e) => e !== null));

  // ── Specific-date overrides ────────────────────────────────────────────────
  readonly overridesLoading = signal(true);
  readonly overridesError = signal<string | null>(null);
  readonly overrides = signal<DateOverrides>({});
  readonly overridesSaving = signal(false);
  readonly overridesSaveError = signal<string | null>(null);
  readonly overridesSaveSuccess = signal(false);
  readonly overridesLastSaved = signal<string | null>(null);

  // Calendar navigation
  readonly calendarYear = signal(new Date().getFullYear());
  readonly calendarMonth = signal(new Date().getMonth()); // 0-based
  readonly selectedDate = signal<string | null>(null);

  // Draft for the currently selected date
  readonly draftAvailability = signal<DayAvailability>({ available: false });
  readonly draftSubmitted = signal(false);

  readonly draftError = computed(() => {
    if (!this.draftSubmitted()) return null;
    return validateDay(this.draftAvailability());
  });

  readonly calendarMonthLabel = computed(() =>
    new Date(this.calendarYear(), this.calendarMonth(), 1).toLocaleString('default', {
      month: 'long',
      year: 'numeric',
    }),
  );

  readonly calendarDays = computed((): CalendarDay[] => {
    const year = this.calendarYear();
    const month = this.calendarMonth();
    const today = todayISO();
    const currentOverrides = this.overrides();

    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const cells: CalendarDay[] = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const pm = month === 0 ? 11 : month - 1;
      const py = month === 0 ? year - 1 : year;
      const iso = toISODate(py, pm, d);
      cells.push({
        date: iso,
        dayOfMonth: d,
        isCurrentMonth: false,
        isToday: iso === today,
        hasOverride: !!currentOverrides[iso],
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toISODate(year, month, d);
      cells.push({
        date: iso,
        dayOfMonth: d,
        isCurrentMonth: true,
        isToday: iso === today,
        hasOverride: !!currentOverrides[iso],
      });
    }

    const remainder = cells.length % 7;
    if (remainder !== 0) {
      const nm = month === 11 ? 0 : month + 1;
      const ny = month === 11 ? year + 1 : year;
      for (let d = 1; d <= 7 - remainder; d++) {
        const iso = toISODate(ny, nm, d);
        cells.push({
          date: iso,
          dayOfMonth: d,
          isCurrentMonth: false,
          isToday: iso === today,
          hasOverride: !!currentOverrides[iso],
        });
      }
    }

    return cells;
  });

  readonly sortedOverrideDates = computed(() =>
    Object.keys(this.overrides()).sort((a, b) => a.localeCompare(b)),
  );

  constructor() {
    this.load();
    this.loadOverrides();
  }

  // ── Weekly methods ─────────────────────────────────────────────────────────

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.availabilityService.get().subscribe({
      next: (response) => {
        if ('schedule' in response && response.schedule) {
          this.schedule.set(response.schedule);
          this.lastSaved.set(response.updated_at ?? null);
        } else {
          this.schedule.set(defaultSchedule());
        }
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load availability');
        this.loading.set(false);
      },
    });
  }

  dayAvailability(key: DayOfWeek): DayAvailability {
    return this.schedule()[key];
  }

  toggleDay(key: DayOfWeek): void {
    this.saveSuccess.set(false);
    this.schedule.update((sched) => {
      const current = sched[key];
      return {
        ...sched,
        [key]: current.available
          ? { available: false }
          : { available: true, slots: [defaultSlot()], max_shifts: 1 },
      };
    });
  }

  addSlot(key: DayOfWeek): void {
    this.saveSuccess.set(false);
    this.schedule.update((sched) => {
      const day = sched[key];
      return { ...sched, [key]: { ...day, slots: [...(day.slots ?? []), { from: '', to: '' }] } };
    });
  }

  removeSlot(key: DayOfWeek, index: number): void {
    this.saveSuccess.set(false);
    this.schedule.update((sched) => {
      const day = sched[key];
      const slots = (day.slots ?? []).filter((_, i) => i !== index);
      if (slots.length === 0) return { ...sched, [key]: { available: false } };
      const max_shifts = Math.min(day.max_shifts ?? 1, slots.length);
      return { ...sched, [key]: { ...day, slots, max_shifts } };
    });
  }

  setSlotFrom(key: DayOfWeek, index: number, value: string): void {
    this.saveSuccess.set(false);
    this.schedule.update((sched) => {
      const day = sched[key];
      const slots = (day.slots ?? []).map((s, i) => (i === index ? { ...s, from: value } : s));
      return { ...sched, [key]: { ...day, slots } };
    });
  }

  setSlotTo(key: DayOfWeek, index: number, value: string): void {
    this.saveSuccess.set(false);
    this.schedule.update((sched) => {
      const day = sched[key];
      const slots = (day.slots ?? []).map((s, i) => (i === index ? { ...s, to: value } : s));
      return { ...sched, [key]: { ...day, slots } };
    });
  }

  setMaxShifts(key: DayOfWeek, value: number): void {
    this.saveSuccess.set(false);
    this.schedule.update((sched) => ({ ...sched, [key]: { ...sched[key], max_shifts: value } }));
  }

  slotRange(key: DayOfWeek): number[] {
    const len = this.dayAvailability(key).slots?.length ?? 0;
    return Array.from({ length: len }, (_, i) => i + 1);
  }

  isSlotFromInvalid(key: DayOfWeek, index: number): boolean {
    if (!this.submitted()) return false;
    const slot = this.dayAvailability(key).slots?.[index];
    if (!slot) return false;
    return !slot.from || slot.from >= (slot.to ?? '99:99');
  }

  isSlotToInvalid(key: DayOfWeek, index: number): boolean {
    if (!this.submitted()) return false;
    const slot = this.dayAvailability(key).slots?.[index];
    if (!slot) return false;
    return !slot.to || (slot.from ?? '') >= slot.to;
  }

  save(): void {
    this.submitted.set(true);
    if (this.hasErrors()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.saveSuccess.set(false);
    this.availabilityService.save(this.schedule()).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saveSuccess.set(true);
        this.lastSaved.set(saved.updated_at ?? null);
        this.submitted.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.saveError.set(err?.error?.error ?? 'Failed to save availability');
      },
    });
  }

  // ── Overrides methods ──────────────────────────────────────────────────────

  loadOverrides(): void {
    this.overridesLoading.set(true);
    this.overridesError.set(null);
    this.availabilityService.getOverrides().subscribe({
      next: (response) => {
        if ('overrides' in response && response.overrides) {
          this.overrides.set(response.overrides);
          this.overridesLastSaved.set(response.updated_at ?? null);
        } else {
          this.overrides.set({});
        }
        this.overridesLoading.set(false);
      },
      error: () => {
        this.overridesError.set('Failed to load date overrides');
        this.overridesLoading.set(false);
      },
    });
  }

  prevMonth(): void {
    const m = this.calendarMonth();
    if (m === 0) {
      this.calendarMonth.set(11);
      this.calendarYear.update((y) => y - 1);
    } else {
      this.calendarMonth.update((m2) => m2 - 1);
    }
    this.selectedDate.set(null);
  }

  nextMonth(): void {
    const m = this.calendarMonth();
    if (m === 11) {
      this.calendarMonth.set(0);
      this.calendarYear.update((y) => y + 1);
    } else {
      this.calendarMonth.update((m2) => m2 + 1);
    }
    this.selectedDate.set(null);
  }

  selectDate(iso: string): void {
    this.draftSubmitted.set(false);
    this.overridesSaveSuccess.set(false);
    if (this.selectedDate() === iso) {
      this.selectedDate.set(null);
      return;
    }
    this.selectedDate.set(iso);
    const existing = this.overrides()[iso];
    this.draftAvailability.set(
      existing
        ? { ...existing, slots: existing.slots ? [...existing.slots] : [] }
        : { available: false },
    );
  }

  toggleDraft(): void {
    this.draftAvailability.update((d) =>
      d.available
        ? { available: false }
        : { available: true, slots: [defaultSlot()], max_shifts: 1 },
    );
  }

  addDraftSlot(): void {
    this.draftAvailability.update((d) => ({
      ...d,
      slots: [...(d.slots ?? []), { from: '', to: '' }],
    }));
  }

  removeDraftSlot(index: number): void {
    this.draftAvailability.update((d) => {
      const slots = (d.slots ?? []).filter((_, i) => i !== index);
      if (slots.length === 0) return { available: false };
      const max_shifts = Math.min(d.max_shifts ?? 1, slots.length);
      return { ...d, slots, max_shifts };
    });
  }

  setDraftSlotFrom(index: number, value: string): void {
    this.draftAvailability.update((d) => ({
      ...d,
      slots: (d.slots ?? []).map((s, i) => (i === index ? { ...s, from: value } : s)),
    }));
  }

  setDraftSlotTo(index: number, value: string): void {
    this.draftAvailability.update((d) => ({
      ...d,
      slots: (d.slots ?? []).map((s, i) => (i === index ? { ...s, to: value } : s)),
    }));
  }

  setDraftMaxShifts(value: number): void {
    this.draftAvailability.update((d) => ({ ...d, max_shifts: value }));
  }

  draftSlotRange(): number[] {
    const len = this.draftAvailability().slots?.length ?? 0;
    return Array.from({ length: len }, (_, i) => i + 1);
  }

  isDraftSlotFromInvalid(index: number): boolean {
    if (!this.draftSubmitted()) return false;
    const slot = this.draftAvailability().slots?.[index];
    if (!slot) return false;
    return !slot.from || slot.from >= (slot.to ?? '99:99');
  }

  isDraftSlotToInvalid(index: number): boolean {
    if (!this.draftSubmitted()) return false;
    const slot = this.draftAvailability().slots?.[index];
    if (!slot) return false;
    return !slot.to || (slot.from ?? '') >= slot.to;
  }

  applyDateOverride(): void {
    this.draftSubmitted.set(true);
    if (this.draftError()) return;

    const date = this.selectedDate();
    if (!date) return;

    const draft = this.draftAvailability();
    const updated = {
      ...this.overrides(),
      [date]: { ...draft, slots: draft.slots ? [...draft.slots] : [] },
    };
    this.persistOverrides(updated, () => this.selectedDate.set(null));
  }

  removeOverride(date: string): void {
    const updated = { ...this.overrides() };
    delete updated[date];
    if (this.selectedDate() === date) this.selectedDate.set(null);
    this.persistOverrides(updated);
  }

  private persistOverrides(overrides: DateOverrides, onSuccess?: () => void): void {
    this.overridesSaving.set(true);
    this.overridesSaveError.set(null);
    this.overridesSaveSuccess.set(false);
    this.availabilityService.saveOverrides(overrides).subscribe({
      next: (saved) => {
        this.overridesSaving.set(false);
        this.overrides.set(saved.overrides ?? overrides);
        this.overridesLastSaved.set(saved.updated_at ?? null);
        this.overridesSaveSuccess.set(true);
        this.draftSubmitted.set(false);
        onSuccess?.();
      },
      error: (err) => {
        this.overridesSaving.set(false);
        this.overridesSaveError.set(err?.error?.error ?? 'Failed to save date override');
      },
    });
  }

  formatOverrideDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('default', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  formatTime(t?: string): string {
    if (!t) return '';
    const [h, min] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${String(min).padStart(2, '0')} ${ampm}`;
  }

  formatSlots(day: DayAvailability): string {
    if (!day.available || !day.slots?.length) return 'Unavailable';
    return day.slots.map((s) => `${this.formatTime(s.from)}–${this.formatTime(s.to)}`).join(', ');
  }

  setTab(tab: Tab): void {
    this.activeTab.set(tab);
  }
}

function validateDay(day: DayAvailability): string | null {
  if (!day.available) return null;
  const slots = day.slots ?? [];
  if (slots.length === 0) return 'At least one time slot is required';
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s.from || !s.to) return `Slot ${i + 1}: start and end time required`;
    if (s.from >= s.to) return `Slot ${i + 1}: start must be before end`;
  }
  const ms = day.max_shifts ?? 1;
  if (!Number.isInteger(ms) || ms < 1 || ms > slots.length) {
    return `Max shifts must be between 1 and ${slots.length}`;
  }
  return null;
}
