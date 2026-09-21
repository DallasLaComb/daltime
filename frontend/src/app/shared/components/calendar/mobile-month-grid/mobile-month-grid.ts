import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { buildCalendarWeeks, toDateKey } from '../../../../core/utils/schedule.utils';
import { dayCellLabel, type DayIndicatorKind, type DayIndicators } from '../calendar.utils';

/** Dots shown per cell before collapsing into a "+". */
const MAX_DOTS = 3;

/** Tailwind classes per dot kind. Shifts are solid; unassigned / unfilled are hollow rings. */
const DOT_CLASS: Record<DayIndicatorKind, string> = {
  morning: 'bg-sky-400',
  afternoon: 'bg-amber-400',
  night: 'bg-violet-400',
  unassigned: 'border-[1.5px] border-amber-600 bg-white',
  unfilled: 'border-[1.5px] border-red-500 bg-white',
};

interface GridCell {
  day: number;
  date: Date;
  dateKey: string;
  isToday: boolean;
  isSelected: boolean;
  dots: DayIndicatorKind[];
  overflow: boolean;
  label: string;
}

/**
 * Compact month grid for phones: seven equal columns that always fit the screen (no horizontal scroll).
 * Cells show the day number and up to three indicator dots; tapping a cell emits `dateSelected` so the
 * page can list that day's shifts underneath (the pattern Google Calendar uses on mobile).
 */
@Component({
  selector: 'app-mobile-month-grid',
  templateUrl: './mobile-month-grid.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dt-debug block' },
})
export class MobileMonthGridComponent {
  /** Any date inside the month to render. */
  readonly month = input.required<Date>();
  readonly selected = input<Date | null>(null);
  readonly indicators = input<DayIndicators>(new Map());

  readonly dateSelected = output<Date>();

  protected readonly weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  protected readonly dotClass = DOT_CLASS;

  /** Legend entries for the hollow-ring dots, shown only when the month actually contains them. */
  protected readonly legend = computed(() => {
    const present = new Set<DayIndicatorKind>();
    for (const kinds of this.indicators().values()) for (const kind of kinds) present.add(kind);
    return (
      [
        { kind: 'unassigned', label: 'No employee' },
        { kind: 'unfilled', label: 'Not scheduled' },
      ] as const
    ).filter((item) => present.has(item.kind));
  });

  protected readonly weeks = computed((): (GridCell | null)[][] => {
    const month = this.month();
    const todayKey = toDateKey(new Date());
    const selectedKey = this.selected() ? toDateKey(this.selected()!) : null;
    const indicators = this.indicators();

    return buildCalendarWeeks(month).map((week) =>
      week.map((day) => {
        if (day === null) return null;
        const date = new Date(month.getFullYear(), month.getMonth(), day);
        const dateKey = toDateKey(date);
        const kinds = indicators.get(dateKey) ?? [];
        return {
          day,
          date,
          dateKey,
          isToday: dateKey === todayKey,
          isSelected: dateKey === selectedKey,
          dots: kinds.slice(0, MAX_DOTS),
          overflow: kinds.length > MAX_DOTS,
          label: dayCellLabel(date, kinds),
        };
      }),
    );
  });
}
