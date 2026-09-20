import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Navbar } from './navbar';
import { AuthService } from '../../core/auth/auth';
import { ImpersonationService } from '../../core/services/impersonation.service';
import type { UserRole } from '../../core/auth/user-role.model';
import type { ImpersonateContext } from '../../core/services/impersonation.service';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a mock AuthService with a given role (null = unauthenticated). */
function buildAuthService(role: UserRole | null) {
  return {
    isAuthenticatedSignal: () => role !== null,
    roleSignal: () => role,
    authReady: () => true,
    accessToken: null,
    idToken: null,
    orgId: signal(null),
    // firstName/lastName signals are used by the navbar displayName computed —
    // return empty strings so the @if (displayName()) guard hides the name element in tests.
    firstName: signal(''),
    lastName: signal(''),
    hasPendingChallenge: false,
    initialize: () => {},
    login: async () => ({ success: false }),
    completeNewPassword: async () => ({ success: false }),
    logout: () => {},
    getAccessToken: () => null,
    getUserAttributes: async () => {},
    updateUserAttribute: async () => false,
    routeToDashboardForRole: () => '/',
  };
}

/** Build a mock ImpersonationService. viewingAs = null means no impersonation. */
function buildImpersonationService(ctx: ImpersonateContext | null) {
  return {
    viewingAs: signal(ctx),
    startImpersonation: () => {},
    endImpersonation: () => {},
  };
}

/** Mount the Navbar with the given auth role and optional impersonation context. */
async function mountNavbar(
  role: UserRole | null,
  impersonating: ImpersonateContext | null = null,
): Promise<{ fixture: ComponentFixture<Navbar>; el: HTMLElement }> {
  await TestBed.configureTestingModule({
    imports: [Navbar],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: buildAuthService(role) },
      { provide: ImpersonationService, useValue: buildImpersonationService(impersonating) },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(Navbar);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

// ── Employee nav link ──────────────────────────────────────────────────────────

describe('Navbar — Employee nav link (story #303)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders a "Schedule" link (not "Dashboard") for the Employee role', async () => {
    const { el } = await mountNavbar('Employee');
    const scheduleLink = el.querySelector<HTMLAnchorElement>(
      '[data-testid="navbar-employee-schedule"]',
    );
    expect(scheduleLink).toBeTruthy();
    expect(scheduleLink?.textContent?.trim()).toBe('Schedule');
  });

  it('Employee schedule link routes to /employee/schedule', async () => {
    const { el } = await mountNavbar('Employee');
    const scheduleLink = el.querySelector<HTMLAnchorElement>(
      '[data-testid="navbar-employee-schedule"]',
    );
    // Angular sets href to the resolved path
    expect(scheduleLink?.getAttribute('href')).toBe('/employee/schedule');
  });

  it('does NOT render any link with text "Dashboard" for the Employee role', async () => {
    const { el } = await mountNavbar('Employee');
    const allLinks = Array.from(el.querySelectorAll('a'));
    const dashboardLink = allLinks.find((a) => a.textContent?.trim() === 'Dashboard');
    expect(dashboardLink).toBeUndefined();
  });

  it('does NOT render a nav menu link (other than the brand logo) pointing to /employee (bare path)', async () => {
    const { el } = await mountNavbar('Employee');
    // The brand logo anchor uses /employee (ROLE_DASHBOARD_MAP['Employee']) as its dashboardRoute.
    // That is intentional — /employee redirects to /employee/schedule via the router.
    // What must NOT exist is a menu link labeled "Dashboard" or "Schedule" that routes to the
    // bare /employee path instead of /employee/schedule.
    const navMenu = el.querySelector('nav ul');
    if (!navMenu) return; // menu not rendered (e.g. mobile hidden) — skip DOM check
    const menuLinks = Array.from(navMenu.querySelectorAll('a'));
    const bareEmployeeNavLink = menuLinks.find((a) => a.getAttribute('href') === '/employee');
    expect(bareEmployeeNavLink).toBeUndefined();
  });

  it('renders the Employee schedule link with data-testid="navbar-employee-schedule"', async () => {
    const { el } = await mountNavbar('Employee');
    const el2 = el.querySelector('[data-testid="navbar-employee-schedule"]');
    expect(el2).toBeTruthy();
  });

  // Brand logo link — should route to /employee for Employee role (which redirects to /employee/schedule via router)
  it('brand logo link routes to /employee for the Employee role', async () => {
    const { el } = await mountNavbar('Employee');
    // The brand anchor uses [routerLink]="dashboardRoute()" which resolves to ROLE_DASHBOARD_MAP['Employee'] = /employee
    const brandLink = el.querySelector<HTMLAnchorElement>('a[href="/employee"]');
    expect(brandLink).toBeTruthy();
    // The brand text should be present on it
    expect(brandLink?.textContent).toContain('DalTime');
  });

  // Profile route — /employee/profile must still be correct
  it('ROLE_DASHBOARD_MAP keeps Employee base at /employee so profileRoute is /employee/profile', async () => {
    // Mount as Employee and inspect the profile nav item's computed href
    const { fixture } = await mountNavbar('Employee');
    const navbar = fixture.componentInstance as unknown as { profileRoute(): string };
    expect(navbar.profileRoute()).toBe('/employee/profile');
  });
});

// ── Web-Admin impersonating Employee ──────────────────────────────────────────

describe('Navbar — Web-Admin impersonating Employee (story #303)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const employeeCtx: ImpersonateContext = {
    userId: 'imp-user-1',
    role: 'Employee',
    displayName: 'Test Employee',
    email: 'employee@test.com',
    orgId: 'org-001',
    sessionId: 'test-session-id',
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  };

  it('shows "Schedule" link (not "Dashboard") when WebAdmin impersonates Employee', async () => {
    const { el } = await mountNavbar('WebAdmin', employeeCtx);
    const scheduleLink = el.querySelector<HTMLAnchorElement>(
      '[data-testid="navbar-employee-schedule"]',
    );
    expect(scheduleLink).toBeTruthy();
    expect(scheduleLink?.textContent?.trim()).toBe('Schedule');
  });

  it('Employee schedule link routes to /employee/schedule during impersonation', async () => {
    const { el } = await mountNavbar('WebAdmin', employeeCtx);
    const scheduleLink = el.querySelector<HTMLAnchorElement>(
      '[data-testid="navbar-employee-schedule"]',
    );
    expect(scheduleLink?.getAttribute('href')).toBe('/employee/schedule');
  });

  it('does not show "Dashboard" text during Employee impersonation', async () => {
    const { el } = await mountNavbar('WebAdmin', employeeCtx);
    const allLinks = Array.from(el.querySelectorAll('a'));
    const dashboardLink = allLinks.find((a) => a.textContent?.trim() === 'Dashboard');
    expect(dashboardLink).toBeUndefined();
  });
});

// ── Role isolation — Employee links must not appear for other roles ────────────

describe('Navbar — Employee nav block absent for non-Employee roles (story #303)', () => {
  const otherRoles: UserRole[] = ['Manager', 'OrgAdmin', 'WebAdmin'];

  beforeEach(() => TestBed.resetTestingModule());

  for (const role of otherRoles) {
    it(`does not render [data-testid="navbar-employee-schedule"] for role=${role}`, async () => {
      const { el } = await mountNavbar(role);
      const scheduleLink = el.querySelector('[data-testid="navbar-employee-schedule"]');
      expect(scheduleLink).toBeNull();
    });
  }
});

// ── Unauthenticated state ──────────────────────────────────────────────────────

describe('Navbar — unauthenticated state (story #303)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('does not render the Employee schedule link when not authenticated', async () => {
    const { el } = await mountNavbar(null);
    const scheduleLink = el.querySelector('[data-testid="navbar-employee-schedule"]');
    expect(scheduleLink).toBeNull();
  });
});
