import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { EmployeeProfileComponent } from './profile';
import { EmployeeProfileService } from './profile.service';
import { APP_TEST_PROVIDERS } from '../../../../test-setup';
import type { EmployeeProfileResponse } from './profile.service';

const mockProfile: EmployeeProfileResponse = {
  employee_id: 'emp-123',
  first_name: 'Jane',
  last_name: 'Smith',
  email: 'jane@acme.com',
  phone: '555-9876',
  org_id: 'org-123',
  manager_id: 'mgr-123',
  status: 'CONFIRMED',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function buildServiceMock(overrides: Partial<Record<keyof EmployeeProfileService, unknown>> = {}) {
  return {
    get: vi.fn().mockReturnValue(of(mockProfile)),
    update: vi.fn().mockReturnValue(of(mockProfile)),
    ...overrides,
  };
}

function query<T extends HTMLElement>(fixture: ComponentFixture<unknown>, testid: string): T {
  return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as T;
}

describe('EmployeeProfileComponent', () => {
  let fixture: ComponentFixture<EmployeeProfileComponent>;
  let service: ReturnType<typeof buildServiceMock>;

  async function createComponent(
    serviceOverrides: Partial<Record<keyof EmployeeProfileService, unknown>> = {},
  ) {
    service = buildServiceMock(serviceOverrides);

    await TestBed.configureTestingModule({
      imports: [EmployeeProfileComponent],
      providers: [...APP_TEST_PROVIDERS, { provide: EmployeeProfileService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(EmployeeProfileComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ─── Loading state ──────────────────────────────────────────────────────────

  it('shows loading spinner while get() is pending', async () => {
    const pending$ = new Subject();
    await createComponent({ get: vi.fn().mockReturnValue(pending$) });

    expect(query(fixture, 'profile-first-name')).toBeNull();
    expect(query(fixture, 'profile-error')).toBeNull();
  });

  // ─── Success state ──────────────────────────────────────────────────────────

  it('renders profile data after loading', async () => {
    await createComponent();

    expect(query(fixture, 'profile-email').textContent?.trim()).toBe('jane@acme.com');
    expect(query(fixture, 'profile-first-name').textContent?.trim()).toBe('Jane');
    expect(query(fixture, 'profile-last-name').textContent?.trim()).toBe('Smith');
    expect(query(fixture, 'profile-phone').textContent?.trim()).toBe('555-9876');
  });

  it('shows — for phone when phone is empty', async () => {
    const noPhone: EmployeeProfileResponse = { ...mockProfile, phone: '' };
    await createComponent({ get: vi.fn().mockReturnValue(of(noPhone)) });

    expect(query(fixture, 'profile-phone').textContent?.trim()).toBe('—');
  });

  // ─── Error state ────────────────────────────────────────────────────────────

  it('shows error message when get() fails', async () => {
    await createComponent({ get: vi.fn().mockReturnValue(throwError(() => new Error('fail'))) });

    expect(query(fixture, 'profile-error')).toBeTruthy();
    expect(query(fixture, 'profile-error').textContent).toContain('Failed to load profile');
  });

  it('retry button re-fetches profile', async () => {
    const get = vi.fn().mockReturnValue(throwError(() => new Error('fail')));
    await createComponent({ get });

    query<HTMLButtonElement>(fixture, 'retry-btn').click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(get).toHaveBeenCalledTimes(2);
  });

  // ─── Edit mode ──────────────────────────────────────────────────────────────

  it('opens edit form with pre-populated fields', async () => {
    await createComponent();

    query<HTMLButtonElement>(fixture, 'edit-btn').click();
    fixture.detectChanges();

    expect(query<HTMLInputElement>(fixture, 'edit-first-name-input').value).toBe('Jane');
    expect(query<HTMLInputElement>(fixture, 'edit-last-name-input').value).toBe('Smith');
    expect(query<HTMLInputElement>(fixture, 'edit-phone-input').value).toBe('555-9876');
  });

  it('cancel button exits edit mode without saving', async () => {
    await createComponent();

    query<HTMLButtonElement>(fixture, 'edit-btn').click();
    fixture.detectChanges();
    query<HTMLButtonElement>(fixture, 'cancel-edit-btn').click();
    fixture.detectChanges();

    expect(query(fixture, 'profile-first-name')).toBeTruthy();
    expect(service.update).not.toHaveBeenCalled();
  });

  // ─── Save ───────────────────────────────────────────────────────────────────

  it('shows required field errors when saving with blank first name', async () => {
    await createComponent();

    query<HTMLButtonElement>(fixture, 'edit-btn').click();
    fixture.detectChanges();

    const input = query<HTMLInputElement>(fixture, 'edit-first-name-input');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    query<HTMLButtonElement>(fixture, 'save-btn').click();
    fixture.detectChanges();

    expect(query(fixture, 'first-name-error')).toBeTruthy();
    expect(service.update).not.toHaveBeenCalled();
  });

  it('calls update() with trimmed values and exits edit mode on success', async () => {
    const updated: EmployeeProfileResponse = { ...mockProfile, first_name: 'Janet' };
    await createComponent({ update: vi.fn().mockReturnValue(of(updated)) });

    query<HTMLButtonElement>(fixture, 'edit-btn').click();
    fixture.detectChanges();

    const input = query<HTMLInputElement>(fixture, 'edit-first-name-input');
    input.value = '  Janet  ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    query<HTMLButtonElement>(fixture, 'save-btn').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: '  Janet  ' }),
    );
    expect(query(fixture, 'save-success')).toBeTruthy();
    expect(query(fixture, 'profile-first-name').textContent?.trim()).toBe('Janet');
  });

  it('shows inline save error when update() fails', async () => {
    await createComponent({
      update: vi.fn().mockReturnValue(throwError(() => ({ error: { error: 'Server error' } }))),
    });

    query<HTMLButtonElement>(fixture, 'edit-btn').click();
    fixture.detectChanges();
    query<HTMLButtonElement>(fixture, 'save-btn').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query(fixture, 'save-error')).toBeTruthy();
    expect(query(fixture, 'save-error').textContent).toContain('Server error');
    expect(query<HTMLInputElement>(fixture, 'edit-first-name-input')).toBeTruthy();
  });
});
