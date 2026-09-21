import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Viewport } from '../../../core/services/viewport';
import type { ShiftStatusFilter } from '../../../core/utils/schedule.utils';

export interface ScheduleFilterEmployee {
  employee_id: string;
  first_name: string;
  last_name: string;
}

export interface ScheduleFilterLocation {
  location_id: string;
  name: string;
}

/**
 * Display metadata for each status chip.
 * label — the visible button text
 * key — the ShiftStatusFilter value toggled when this chip is clicked
 * activeClasses — Tailwind classes applied when the chip is selected
 * inactiveClasses — Tailwind classes applied when the chip is not selected
 */
const STATUS_CHIPS: {
  label: string;
  key: ShiftStatusFilter;
  activeClasses: string;
  inactiveClasses: string;
}[] = [
  {
    label: 'Filled',
    key: 'filled',
    activeClasses: 'bg-green-600 text-white border-green-600',
    inactiveClasses: 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50',
  },
  {
    label: 'Unfilled',
    key: 'unfilled',
    activeClasses: 'bg-red-500 text-white border-red-500',
    inactiveClasses: 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50',
  },
];

@Component({
  selector: 'app-schedule-filters',
  templateUrl: './schedule-filters.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dt-debug' },
})
export class ScheduleFiltersComponent {
  employees = input<ScheduleFilterEmployee[]>([]);
  locations = input<ScheduleFilterLocation[]>([]);
  filterEmployee = input<string>('');
  filterLocation = input<string>('');
  filterType = input<string>('');
  hasActiveFilters = input<boolean>(false);

  /**
   * The currently active status chip keys, passed in from the parent signal.
   * An empty Set means the "All" state (no filter applied).
   */
  activeStatusChips = input<Set<ShiftStatusFilter>>(new Set());

  employeeFilterChange = output<Event>();
  locationFilterChange = output<Event>();
  typeFilterChange = output<Event>();
  clearFiltersRequested = output<void>();

  /**
   * Emitted when the status chip selection changes.
   * Carries the full updated Set so the parent can replace its signal value.
   * Named 'statusChipsChange' (not 'change') to avoid the @angular-eslint/no-output-native rule.
   */
  statusChipsChange = output<Set<ShiftStatusFilter>>();

  protected readonly viewport = inject(Viewport);

  /** Phones collapse the filter panel behind a "Filters" button; desktop always shows it. */
  protected readonly expanded = signal(false);

  /** How many filters are currently narrowing the schedule (shown as a badge on the phone toggle). */
  protected readonly activeCount = computed(
    () =>
      (this.filterEmployee() ? 1 : 0) +
      (this.filterLocation() ? 1 : 0) +
      (this.filterType() ? 1 : 0) +
      this.activeStatusChips().size,
  );

  protected toggleExpanded(): void {
    this.expanded.update((open) => !open);
  }

  /** Expose chip metadata to the template so the template stays logic-free. */
  protected readonly statusChips = STATUS_CHIPS;

  /**
   * True when no status chip is active. Used to style the "All" pill.
   */
  protected readonly allActive = computed(() => this.activeStatusChips().size === 0);

  /**
   * Returns whether a given chip key is currently active.
   * Used by the template to decide which style class to apply.
   */
  protected isChipActive(key: ShiftStatusFilter): boolean {
    return this.activeStatusChips().has(key);
  }

  /**
   * Handles a click on the "All" pill.
   * Clears all active status chips, reverting to show-all behaviour.
   */
  protected selectAll(): void {
    this.statusChipsChange.emit(new Set());
  }

  /**
   * Handles a click on a named status chip (Filled / Unfilled).
   * Radio behavior: clicking a chip selects it exclusively. Clicking the
   * already-active chip deselects it, reverting to "All".
   */
  protected toggleChip(key: ShiftStatusFilter): void {
    const current = this.activeStatusChips();
    if (current.size === 1 && current.has(key)) {
      this.statusChipsChange.emit(new Set());
    } else {
      this.statusChipsChange.emit(new Set([key]));
    }
  }
}
