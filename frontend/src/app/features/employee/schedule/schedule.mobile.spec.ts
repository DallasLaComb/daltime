import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { EmployeeScheduleComponent } from './schedule';
import { EmployeeShiftsService } from './shifts.service';
import { Viewport } from '../../../core/services/viewport';
import { APP_TEST_PROVIDERS } from '../../../../test-setup';
import type { Shift } from '../../../core/models/shift.model';
import { toDateKey, toMonthKey } from '../../../core/utils/schedule.utils';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    shift_id: `shift-${Math.random()}`,
    org_id: 'org-1',
    manager_id: 'mgr-1',
    employee_id: 'emp-1',
    employee_name: 'Jane Smith',
    location_id: 'loc-1',
    location_name: 'Downtown Branch',
    date: toDateKey(new Date()),
    start_time: '09:00',
    end_time: '17:00',
    type: 'morning',
    status: 'published',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function swipe(target: Element, fromX: number, toX: number): void {
  const start = { clientX: fromX, clientY: 300 } as Touch;
  const end = { clientX: toX, clientY: 305 } as Touch;
  const startEvent = new Event('touchstart', { bubbles: true });
  Object.assign(startEvent, { touches: [start], changedTouches: [start] });
  const endEvent = new Event('touchend', { bubbles: true });
  Object.assign(endEvent, { touches: [], changedTouches: [end] });
  target.dispatchEvent(startEvent);
  target.dispatchEvent(endEvent);
}

describe('EmployeeScheduleComponent — phone layout', () => {
  const today = new Date();
  // Another day in the current month that is not today.
  const otherDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() === 15 ? 16 : 15,
  );

  let fixture: ComponentFixture<EmployeeScheduleComponent>;
  let service: {
    listByDate: ReturnType<typeof vi.fn>;
    listByWeek: ReturnType<typeof vi.fn>;
    listByMonth: ReturnType<typeof vi.fn>;
    listAvailableShifts: ReturnType<typeof vi.fn>;
  };

  const q = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  const qa = (testid: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testid}"]`));

  async function create(monthShifts: Shift[] = [], weekShifts: Shift[] = []): Promise<void> {
    service = {
      listByDate: vi.fn().mockReturnValue(of([])),
      listByWeek: vi.fn().mockReturnValue(of(weekShifts)),
      listByMonth: vi.fn().mockReturnValue(of(monthShifts)),
      listAvailableShifts: vi.fn().mockReturnValue(of([])),
    };
    await TestBed.configureTestingModule({
      imports: [EmployeeScheduleComponent],
      providers: [
        ...APP_TEST_PROVIDERS,
        { provide: EmployeeShiftsService, useValue: service },
        { provide: Viewport, useValue: { isMobile: signal(true) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EmployeeScheduleComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function openView(view: 'week' | 'month'): Promise<void> {
    q(`view-toggle-${view}`)!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  describe('month view', () => {
    it('shows the compact grid and today’s shifts instead of the desktop list', async () => {
      await create([
        makeShift({ location_name: 'Today Cafe' }),
        makeShift({ date: toDateKey(otherDay), location_name: 'Other Cafe' }),
      ]);
      await openView('month');

      expect(q('mobile-month-grid')).toBeTruthy();
      expect(qa('date-group-label')).toHaveLength(0);
      expect(q('mobile-agenda')!.textContent).toContain('Today Cafe');
      expect(q('mobile-agenda')!.textContent).not.toContain('Other Cafe');
    });

    it('switches the agenda when a day is tapped, without refetching', async () => {
      await create([
        makeShift({ location_name: 'Today Cafe' }),
        makeShift({ date: toDateKey(otherDay), location_name: 'Other Cafe' }),
      ]);
      await openView('month');
      const callsBefore = service.listByMonth.mock.calls.length;

      q(`mobile-day-cell-${otherDay.getDate()}`)!.click();
      fixture.detectChanges();

      expect(q('mobile-agenda')!.textContent).toContain('Other Cafe');
      expect(q('mobile-agenda')!.textContent).not.toContain('Today Cafe');
      expect(service.listByMonth.mock.calls.length).toBe(callsBefore);
    });

    it('shows the grid with an empty agenda when the month has no shifts', async () => {
      await create([]);
      await openView('month');

      expect(q('mobile-month-grid')).toBeTruthy();
      expect(q('mobile-agenda')!.textContent).toContain('No shifts scheduled');
    });

    it('marks days that have shifts with dots', async () => {
      await create([makeShift({ date: toDateKey(otherDay), type: 'night' })]);
      await openView('month');

      const withShift = q(`mobile-day-cell-${otherDay.getDate()}`)!;
      expect(withShift.getAttribute('aria-label')).toContain('1 shift');
      expect(withShift.querySelectorAll('.h-1\\.5.w-1\\.5')).toHaveLength(1);
    });
  });

  describe('week view', () => {
    it('renders a vertical list of seven days with no horizontal scroll container', async () => {
      await create([], [makeShift({ location_name: 'Today Cafe' })]);
      await openView('week');

      expect(qa('mobile-day-section')).toHaveLength(7);
      expect(q('mobile-day-list')).toBeTruthy();
      expect(fixture.nativeElement.querySelector('.overflow-x-auto')).toBeNull();
      expect(fixture.nativeElement.innerHTML).not.toContain('min-w-[560px]');
    });

    it('puts each shift under its own day and says "No shifts" on empty days', async () => {
      await create([], [makeShift({ location_name: 'Today Cafe' })]);
      await openView('week');

      expect(qa('shift-card')).toHaveLength(1);
      expect(qa('week-day-empty')).toHaveLength(6);
      const todaySection = qa('mobile-day-section').find(
        (s) => s.querySelector('[aria-current="date"]') !== null,
      );
      expect(todaySection?.textContent).toContain('Today Cafe');
    });
  });

  describe('swipe navigation', () => {
    it('swiping left goes to the next month and right goes back', async () => {
      await create([]);
      await openView('month');
      const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      const area = q('swipe-area')!;

      swipe(area, 300, 120);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(service.listByMonth).toHaveBeenLastCalledWith(toMonthKey(next));

      swipe(area, 100, 280);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(service.listByMonth).toHaveBeenLastCalledWith(toMonthKey(today));
    });
  });
});
