import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { OrgAdminSchedule } from './schedule';
import { OrgAdminShiftsService } from './shifts.service';
import { EmployeesService } from '../employees/employees.service';
import { OrgAdminLocationsService } from '../locations/locations.service';
import { Viewport } from '../../../core/services/viewport';
import { APP_TEST_PROVIDERS } from '../../../../test-setup';
import type { Shift } from '../../../core/models/shift.model';
import { toDateKey } from '../../../core/utils/schedule.utils';

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    shift_id: `shift-${Math.random()}`,
    org_id: 'org-1',
    manager_id: 'mgr-1',
    employee_id: 'emp-1',
    employee_name: 'Alice Smith',
    location_id: 'loc-1',
    location_name: 'Main Floor',
    date: toDateKey(new Date()),
    start_time: '09:00',
    end_time: '17:00',
    type: 'morning',
    status: 'published',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('OrgAdminSchedule — phone layout', () => {
  let fixture: ComponentFixture<OrgAdminSchedule>;

  const q = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  const qa = (testid: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testid}"]`));

  async function create(shifts: Shift[]): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OrgAdminSchedule],
      providers: [
        ...APP_TEST_PROVIDERS,
        { provide: Viewport, useValue: { isMobile: signal(true) } },
        { provide: OrgAdminShiftsService, useValue: { list: () => of(shifts) } },
        { provide: EmployeesService, useValue: { getAll: () => of([]) } },
        { provide: OrgAdminLocationsService, useValue: { getAll: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgAdminSchedule);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function openView(view: 'month' | 'week'): Promise<void> {
    q(`view-${view}`)!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('month view: compact grid plus the selected day’s read-only shift list', async () => {
    await create([makeShift()]);
    await openView('month');

    expect(q('mobile-month-grid')).toBeTruthy();
    expect(fixture.nativeElement.innerHTML).not.toContain('min-w-[490px]');
    expect(q('mobile-agenda')!.textContent).toContain('09:00');
    // org-admin is read-only: no create button
    expect(q('add-shift-for-day')).toBeNull();
  });

  it('week view: vertical list of 7 days, no horizontal scroll', async () => {
    await create([makeShift()]);
    await openView('week');

    expect(qa('mobile-day-section')).toHaveLength(7);
    expect(fixture.nativeElement.querySelector('.overflow-x-auto')).toBeNull();
  });

  it('swiping left moves to the next period', async () => {
    await create([]);
    await openView('month');
    const before = fixture.nativeElement.textContent;

    const area = q('swipe-area')!;
    const start = { clientX: 300, clientY: 300 } as Touch;
    const end = { clientX: 100, clientY: 305 } as Touch;
    const down = new Event('touchstart', { bubbles: true });
    Object.assign(down, { touches: [start], changedTouches: [start] });
    const up = new Event('touchend', { bubbles: true });
    Object.assign(up, { touches: [], changedTouches: [end] });
    area.dispatchEvent(down);
    area.dispatchEvent(up);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toBe(before);
  });
});
