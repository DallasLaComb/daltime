import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ManagerSchedule } from './schedule';
import { ManagerShiftsService } from './shifts.service';
import { ManagerScheduleService } from './schedule.service';
import { ManagerEmployeeAvailabilityService } from './employee-availability.service';
import { ManagerEmployeesService } from '../employees/employees.service';
import { ManagerLocationsService } from '../shifts-needed/locations.service';
import { ManagerShiftsNeededService } from '../shifts-needed/shifts-needed.service';
import { Viewport } from '../../../core/services/viewport';
import { APP_TEST_PROVIDERS } from '../../../../test-setup';
import type { Shift } from '../../../core/models/shift.model';
import type { ShiftNeeded } from '../../../core/models/manager-shift-needed.model';
import type { EmployeeResponse } from '../../../core/models/employee.model';
import type { EmployeeAvailabilityBundle } from './employee-availability.service';
import { toDateKey } from '../../../core/utils/schedule.utils';

const TODAY = toDateKey(new Date());

function makeShift(overrides: Partial<Shift> = {}): Shift {
  return {
    shift_id: `shift-${Math.random()}`,
    org_id: 'org-1',
    manager_id: 'mgr-1',
    employee_id: 'emp-1',
    employee_name: 'Alice Smith',
    location_id: 'loc-1',
    location_name: 'Main Floor',
    date: TODAY,
    start_time: '09:00',
    end_time: '17:00',
    type: 'morning',
    status: 'published',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const UNFILLED_TODAY = {
  shift_id: 'sn-1',
  org_id: 'org-1',
  manager_id: 'mgr-1',
  location_id: 'loc-1',
  date: TODAY,
  start_time: '18:00',
  end_time: '22:00',
  employee_count: 1,
} as unknown as ShiftNeeded;

describe('ManagerSchedule — phone layout', () => {
  let fixture: ComponentFixture<ManagerSchedule>;

  const q = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  const qa = (testid: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testid}"]`));

  async function create(
    shifts: Shift[],
    shiftsNeeded: ShiftNeeded[] = [],
    opts: {
      employees?: EmployeeResponse[];
      bundles?: Map<string, EmployeeAvailabilityBundle>;
    } = {},
  ): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ManagerSchedule],
      providers: [
        ...APP_TEST_PROVIDERS,
        { provide: Viewport, useValue: { isMobile: signal(true) } },
        { provide: ManagerShiftsService, useValue: { list: () => of(shifts) } },
        { provide: ManagerShiftsNeededService, useValue: { list: () => of(shiftsNeeded) } },
        { provide: ManagerEmployeesService, useValue: { getAll: () => of(opts.employees ?? []) } },
        { provide: ManagerLocationsService, useValue: { list: () => of([]) } },
        {
          provide: ManagerScheduleService,
          useValue: { getMeta: () => of({ draftCount: 0, maxDrafts: 10 }) },
        },
        {
          provide: ManagerEmployeeAvailabilityService,
          useValue: { getAllBundles: () => of(opts.bundles ?? new Map()) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ManagerSchedule);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function openView(view: 'week' | 'day' | 'availability'): Promise<void> {
    q(`view-${view}`)!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('has a single Add Shift button (in the title row on phones)', async () => {
    await create([]);
    expect(qa('add-shift')).toHaveLength(1);
  });

  it('month view: compact grid with no horizontal-scroll wrapper or 110px cells', async () => {
    await create([makeShift()]);

    expect(q('mobile-month-grid')).toBeTruthy();
    expect(qa('day-cell-1')).toHaveLength(0); // desktop cells are not rendered
    expect(fixture.nativeElement.innerHTML).not.toContain('min-w-[490px]');
  });

  it('month view: lists the selected day’s shifts and unfilled slots beneath the grid', async () => {
    await create([makeShift({ employee_id: 'emp-1' })], [UNFILLED_TODAY]);

    const agenda = q('mobile-agenda')!;
    expect(agenda.querySelectorAll('[data-testid="shift-card"]')).toHaveLength(1);
    expect(agenda.querySelectorAll('[data-testid="unfilled-card"]')).toHaveLength(1);
  });

  it('month view: shows a red ring dot for unfilled slots and a solid dot for shifts', async () => {
    await create([makeShift()], [UNFILLED_TODAY]);
    const cell = q(`mobile-day-cell-${new Date().getDate()}`)!;

    expect(cell.getAttribute('aria-label')).toContain('1 shift, 1 not scheduled');
    expect(cell.querySelectorAll('.h-1\\.5.w-1\\.5')).toHaveLength(2);
    expect(cell.querySelector('.border-red-500')).toBeTruthy();
  });

  it('month view: "+ Add" creates a shift for the selected day', async () => {
    await create([]);
    const comp = fixture.componentInstance as unknown as { openCreateModal: (d?: string) => void };
    const spy = vi.spyOn(comp, 'openCreateModal');

    q('add-shift-for-day')!.click();

    expect(spy).toHaveBeenCalledWith(TODAY);
  });

  it('month view: tapping a shift card opens the edit flow (same action as the desktop chip)', async () => {
    await create([makeShift({ employee_id: 'emp-1' })]);
    const comp = fixture.componentInstance as unknown as { openEditModal: (s: Shift) => void };
    const spy = vi.spyOn(comp, 'openEditModal');

    q('mobile-agenda')!.querySelector<HTMLElement>('[data-testid="shift-card"]')!.click();

    expect(spy).toHaveBeenCalledOnce();
  });

  it('week view: vertical list of 7 days, no horizontal scroll', async () => {
    await create([makeShift()], [UNFILLED_TODAY]);
    await openView('week');

    expect(qa('mobile-day-section')).toHaveLength(7);
    expect(fixture.nativeElement.querySelector('.overflow-x-auto')).toBeNull();
    expect(fixture.nativeElement.innerHTML).not.toContain('min-w-[560px]');
    // today's header counts the shift plus the unfilled slot
    const todayHeader = qa('mobile-day-header').find((h) => h.getAttribute('aria-current'));
    expect(todayHeader?.textContent).toContain('2 shifts');
  });

  it('filters are collapsed behind a toggle on phones and expand on tap', async () => {
    await create([]);

    expect(q('filters-toggle')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#filter-employee')).toBeNull();

    q('filters-toggle')!.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#filter-employee')).toBeTruthy();
  });

  describe('availability tab', () => {
    const alex = { employee_id: 'e1', first_name: 'Alex', last_name: 'Rivera' } as EmployeeResponse;
    const sam = { employee_id: 'e2', first_name: 'Sam', last_name: 'Lee' } as EmployeeResponse;
    const bundles = new Map<string, EmployeeAvailabilityBundle>([
      [
        'e1',
        {
          employeeId: 'e1',
          overrides: null,
          availability: {
            schedule: {
              monday: { available: true, slots: [{ from: '09:00', to: '17:00' }] },
              tuesday: {
                available: true,
                slots: [
                  { from: '06:00', to: '10:00' },
                  { from: '18:00', to: '22:30' },
                ],
              },
              wednesday: { available: false },
            },
          },
        } as unknown as EmployeeAvailabilityBundle,
      ],
    ]);

    it('renders one card per employee instead of the 560px matrix', async () => {
      await create([], [], { employees: [alex, sam], bundles });
      await openView('availability');

      expect(qa('availability-card')).toHaveLength(2);
      expect(fixture.nativeElement.querySelector('.overflow-x-auto')).toBeNull();
      expect(fixture.nativeElement.innerHTML).not.toContain('min-w-[560px]');
    });

    it('hides period navigation and shift filters, which do not apply to recurring availability', async () => {
      await create([], [], { employees: [alex], bundles });
      expect(q('prev-period')).toBeTruthy();
      expect(q('filters-toggle')).toBeTruthy();

      await openView('availability');

      expect(q('prev-period')).toBeNull();
      expect(q('filters-toggle')).toBeNull();
    });

    it('shows a glanceable Mon–Sun strip with available days highlighted', async () => {
      await create([], [], { employees: [alex], bundles });
      await openView('availability');

      const pips = qa('availability-day-pip');
      expect(pips).toHaveLength(7);
      expect(pips.map((p) => p.getAttribute('data-available'))).toEqual([
        'true', // Mon
        'true', // Tue
        'false',
        'false',
        'false',
        'false',
        'false',
      ]);
    });

    it('says so when an employee has not submitted availability', async () => {
      await create([], [], { employees: [sam], bundles });
      await openView('availability');

      const card = qa('availability-card')[0];
      expect(card.textContent).toContain('No availability submitted');
      expect(card.querySelectorAll('[data-testid="availability-day-pip"]')).toHaveLength(0);
    });

    it('expands to per-day time ranges (including multiple slots) and collapses again', async () => {
      await create([], [], { employees: [alex], bundles });
      await openView('availability');
      expect(q('availability-details')).toBeNull();

      q('availability-card-toggle')!.click();
      fixture.detectChanges();

      const details = q('availability-details')!;
      expect(details.textContent).toContain('9a–5p');
      expect(details.textContent).toContain('6a–10a');
      expect(details.textContent).toContain('6p–10:30p');
      expect(q('availability-card-toggle')!.getAttribute('aria-expanded')).toBe('true');

      q('availability-card-toggle')!.click();
      fixture.detectChanges();
      expect(q('availability-details')).toBeNull();
    });
  });
});
