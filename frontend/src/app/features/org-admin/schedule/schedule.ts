import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { forkJoin } from 'rxjs';
import type { Shift } from '../../../core/models/shift.model';
import {
  toDateKey,
  toMonthKey,
  getWeekStart,
  buildViewLabel,
  scheduleExportFilename,
  getVisibleShifts,
} from '../../../core/utils/schedule.utils';
import type { ViewMode } from '../../../core/utils/schedule.utils';
import { ScheduleBaseComponent } from '../../../core/utils/schedule-base';
import { OrgAdminShiftsService } from './shifts.service';
import { EmployeesService } from '../employees/employees.service';
import { OrgAdminLocationsService } from '../locations/locations.service';
import {
  ButtonComponent,
  LoadingSpinnerComponent,
  ErrorAlertComponent,
  EmptyStateComponent,
  ScheduleFiltersComponent,
  ScheduleViewToggleComponent,
  ScheduleNavComponent,
  MobileMonthGridComponent,
  MobileDayListComponent,
  SwipeNavDirective,
} from '@common-daltime';

@Component({
  selector: 'app-org-admin-schedule',
  imports: [
    NgTemplateOutlet,
    ButtonComponent,
    LoadingSpinnerComponent,
    ErrorAlertComponent,
    EmptyStateComponent,
    ScheduleFiltersComponent,
    ScheduleViewToggleComponent,
    ScheduleNavComponent,
    MobileMonthGridComponent,
    MobileDayListComponent,
    SwipeNavDirective,
  ],
  templateUrl: './schedule.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgAdminSchedule extends ScheduleBaseComponent implements OnInit {
  private readonly shiftsService = inject(OrgAdminShiftsService);
  private readonly employeesService = inject(EmployeesService);
  private readonly locationsService = inject(OrgAdminLocationsService);

  protected override readonly viewMode = signal<ViewMode>('month');

  protected readonly viewLabel = computed(() =>
    buildViewLabel(this.currentDate(), this.viewMode()),
  );

  protected readonly visibleShifts = computed((): Shift[] =>
    getVisibleShifts(this.filteredShifts(), this.currentDate(), this.viewMode()),
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
      locations: this.locationsService.getAll(),
    }).subscribe({
      next: ({ shifts, employees, locations }) => {
        this.allShifts.set(shifts);
        this.employees.set(employees);
        this.locations.set(locations);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load schedule. Please try again.');
        this.loading.set(false);
      },
    });
  }

  protected override loadShifts(): void {
    const month = toMonthKey(this.currentDate());
    this.shiftsService.list(month).subscribe({
      next: (shifts) => this.allShifts.set(shifts),
      error: () => this.error.set('Failed to refresh shifts.'),
    });
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  protected getWeekStart(d: Date): Date {
    return getWeekStart(d);
  }

  // ── Exports ──────────────────────────────────────────────────────────────────

  protected exportCsv(): void {
    const shifts = this.visibleShifts();
    const header = ['Date', 'Employee', 'Location', 'Type', 'Start Time', 'End Time'];
    const rows = shifts
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => [
        s.date,
        this.employeeName(s.employee_id),
        this.locationName(s.location_id),
        s.type.charAt(0).toUpperCase() + s.type.slice(1),
        s.start_time,
        s.end_time,
      ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${this.exportFilename()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  protected exportPdf(): void {
    const label = this.viewLabel();
    const shifts = this.visibleShifts();
    const subtitle = `DalTime · Exported ${new Date().toLocaleDateString()} · ${shifts.length} shift${shifts.length === 1 ? '' : 's'}`;
    let body: string;
    if (this.viewMode() === 'month') body = this.buildMonthCalendarHtml();
    else if (this.viewMode() === 'week') body = this.buildWeekCalendarHtml();
    else body = this.buildDayCalendarHtml();

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Schedule — ${label}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#111;background:#fff}.page{padding:20px 24px}.header{margin-bottom:14px}.header h1{font-size:17px;font-weight:700}.header p{font-size:10px;color:#888;margin-top:2px}.month-grid{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}.dow-header{background:#f9fafb;padding:5px 0;text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;border-bottom:1px solid #e5e7eb}.month-cell{min-height:80px;padding:4px 5px;border-right:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;background:#fff}.month-cell.empty{background:#f9fafb}.month-cell.today{background:#eff6ff}.day-num{font-size:9px;font-weight:600;color:#9ca3af;text-align:right;margin-bottom:3px}.chip{border-radius:3px;padding:2px 4px;margin-bottom:2px;font-size:8.5px;line-height:1.3}.chip-name{font-weight:700;display:block}.chip-detail{display:block;opacity:.75}.chip.morning{background:#e0f2fe;color:#0369a1}.chip.afternoon{background:#fef3c7;color:#92400e}.chip.night{background:#ede9fe;color:#5b21b6}.legend{display:flex;gap:14px;margin-top:10px}.legend-item{display:flex;align-items:center;gap:4px;font-size:9px;color:#6b7280}.legend-dot{width:8px;height:8px;border-radius:50%}.legend-dot.morning{background:#38bdf8}.legend-dot.afternoon{background:#fbbf24}.legend-dot.night{background:#a78bfa}</style></head><body><div class="page"><div class="header"><h1>Schedule — ${label}</h1><p>${subtitle}</p></div>${body}<div class="legend"><div class="legend-item"><div class="legend-dot morning"></div>Morning</div><div class="legend-item"><div class="legend-dot afternoon"></div>Afternoon</div><div class="legend-item"><div class="legend-dot night"></div>Night</div></div></div></body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      URL.revokeObjectURL(url);
      return;
    }
    win.addEventListener('load', () => {
      win.focus();
      win.print();
      URL.revokeObjectURL(url);
    });
  }

  private buildMonthCalendarHtml(): string {
    const d = this.currentDate();
    const year = d.getFullYear();
    const month = d.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [
      ...new Array<null>(firstDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const headers = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((h) => `<div class="dow-header">${h}</div>`)
      .join('');
    const monthStr = String(month + 1).padStart(2, '0');
    const cellsHtml = cells
      .map((day) => {
        if (day === null) return `<div class="month-cell empty"></div>`;
        const isToday =
          year === this.today.getFullYear() &&
          month === this.today.getMonth() &&
          day === this.today.getDate();
        const key = `${year}-${monthStr}-${String(day).padStart(2, '0')}`;
        const dayShifts = this.shiftsByDate().get(key) ?? [];
        const chips = dayShifts
          .map(
            (s) =>
              `<div class="chip ${s.type}"><span class="chip-name">${this.shortName(s.employee_id)}</span><span class="chip-detail">${this.shortTime(s.start_time)}–${this.shortTime(s.end_time)} · ${this.shortLocation(s.location_id)}</span></div>`,
          )
          .join('');
        const numHtml = isToday
          ? `<span class="day-num" style="background:#2563eb;color:#fff;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;float:right;font-size:8px">${day}</span>`
          : `<span class="day-num">${day}</span>`;
        return `<div class="month-cell${isToday ? ' today' : ''}">${numHtml}${chips}</div>`;
      })
      .join('');
    return `<div class="month-grid">${headers}${cellsHtml}</div>`;
  }

  private buildWeekCalendarHtml(): string {
    const weekStart = this.getWeekStart(this.currentDate());
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
    const headers = days
      .map((d) => {
        const isT = toDateKey(d) === toDateKey(this.today);
        const num = isT
          ? `<div style="background:#2563eb;color:#fff;border-radius:50%;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;margin:2px auto 0;font-size:11px">${d.getDate()}</div>`
          : `<div style="font-size:13px;font-weight:600;color:#374151;margin-top:2px">${d.getDate()}</div>`;
        return `<div style="background:#f9fafb;padding:7px 4px;text-align:center;border-bottom:1px solid #e5e7eb;border-right:1px solid #e5e7eb"><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#6b7280">${d.toLocaleString('default', { weekday: 'short' })}</div>${num}</div>`;
      })
      .join('');
    const cols = days
      .map((d) => {
        const dayShifts = this.shiftsByDate().get(toDateKey(d)) ?? [];
        const chips = dayShifts
          .map(
            (s) =>
              `<div class="chip ${s.type}"><span class="chip-name">${this.shortName(s.employee_id)}</span><span class="chip-detail">${this.shortTime(s.start_time)}–${this.shortTime(s.end_time)}</span></div>`,
          )
          .join('');
        const isT = toDateKey(d) === toDateKey(this.today);
        return `<div style="min-height:120px;padding:6px 4px;border-right:1px solid #e5e7eb;background:${isT ? '#eff6ff' : '#fff'}">${chips}</div>`;
      })
      .join('');
    return `<div style="display:grid;grid-template-columns:repeat(7,1fr);border:1px solid #e5e7eb;border-radius:6px;overflow:hidden"><div style="display:contents">${headers}</div><div style="display:contents">${cols}</div></div>`;
  }

  private buildDayCalendarHtml(): string {
    const shifts = this.currentDayShifts();
    if (shifts.length === 0)
      return `<div style="border:1px solid #e5e7eb;border-radius:6px;padding:32px;text-align:center;color:#9ca3af;font-size:12px;font-style:italic">No shifts scheduled for this day</div>`;
    const typeColor = (type: string): string => {
      if (type === 'morning') return '#38bdf8';
      if (type === 'afternoon') return '#fbbf24';
      return '#a78bfa';
    };
    const cards = shifts
      .map(
        (s) =>
          `<div style="display:flex;align-items:flex-start;gap:14px;padding:10px 14px;border-bottom:1px solid #f3f4f6;border-left:4px solid ${typeColor(s.type)}"><div style="width:72px;flex-shrink:0;text-align:center"><div style="font-size:11px;font-weight:600;color:#1f2937">${s.start_time}</div><div style="font-size:9px;color:#9ca3af">to</div><div style="font-size:11px;font-weight:600;color:#1f2937">${s.end_time}</div></div><div style="flex:1"><div style="font-weight:600;font-size:11px">${this.employeeName(s.employee_id)}</div><div style="font-size:10px;color:#6b7280;margin-top:1px">${this.locationName(s.location_id)}</div></div></div>`,
      )
      .join('');
    return `<div style="border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">${cards}</div>`;
  }

  private exportFilename(): string {
    return scheduleExportFilename(this.currentDate(), this.viewMode());
  }
}
