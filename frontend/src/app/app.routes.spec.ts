/**
 * Tests for app.routes.ts — focused on the /employee → /employee/schedule redirect
 * introduced in story #303 (Replace employee Dashboard tab with Schedule as default
 * landing view).
 *
 * Tier split:
 *  - Unit: direct inspection of the routes array (no Angular TestBed, zero overhead).
 *  - Integration: Router navigation with mocked auth.
 *
 * The NG04014 finding from the previous test run has been resolved: the bare 'employee'
 * redirect entry no longer carries canMatch or data — those were removed because Angular
 * prohibits canMatch and redirectTo on the same route.  Auth and role enforcement is
 * fully handled by the guards on the destination employee/schedule route.
 *
 * Integration tests now use the live `routes` array directly (no corrected copy needed).
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth';
import { ImpersonationService } from './core/services/impersonation.service';
import type { UserRole } from './core/auth/user-role.model';
import type { ImpersonateContext } from './core/services/impersonation.service';
import type { Route } from '@angular/router';

// ── Unit: Route config structure ──────────────────────────────────────────────

describe('app.routes — unit: /employee redirect config (story #303)', () => {
  it('has a redirectTo entry for the bare "employee" path', () => {
    const employeeRedirect = routes.find((r) => r.path === 'employee' && 'redirectTo' in r);
    expect(employeeRedirect).toBeDefined();
    expect(employeeRedirect?.redirectTo).toBe('employee/schedule');
  });

  it('redirect uses pathMatch: "full" to avoid interfering with child routes', () => {
    const employeeRedirect = routes.find((r) => r.path === 'employee' && 'redirectTo' in r);
    expect(employeeRedirect?.pathMatch).toBe('full');
  });

  it('redirect entry has no canMatch guards (NG04014 fix: redirectTo and canMatch cannot coexist)', () => {
    const employeeRedirect = routes.find((r) => r.path === 'employee' && 'redirectTo' in r) as
      | Route
      | undefined;
    expect(employeeRedirect?.canMatch).toBeUndefined();
  });

  it('redirect entry has no data property (guards were removed along with data)', () => {
    const employeeRedirect = routes.find((r) => r.path === 'employee' && 'redirectTo' in r) as
      | Route
      | undefined;
    expect(employeeRedirect?.data).toBeUndefined();
  });

  it('the /employee/schedule route still exists (not accidentally deleted)', () => {
    const scheduleRoute = routes.find((r) => r.path === 'employee/schedule');
    expect(scheduleRoute).toBeDefined();
    expect(scheduleRoute?.loadComponent).toBeDefined();
  });

  it('/employee/schedule route has canMatch guards with Employee role', () => {
    const scheduleRoute = routes.find((r) => r.path === 'employee/schedule') as Route | undefined;
    expect(scheduleRoute?.canMatch).toBeDefined();
    expect((scheduleRoute?.canMatch ?? []).length).toBeGreaterThan(0);
    expect(scheduleRoute?.data?.['roles']).toEqual(['Employee']);
  });

  it('the /employee/profile route still exists', () => {
    const profileRoute = routes.find((r) => r.path === 'employee/profile');
    expect(profileRoute).toBeDefined();
    expect(profileRoute?.loadComponent).toBeDefined();
  });

  it('the /employee/availability route still exists', () => {
    const availabilityRoute = routes.find((r) => r.path === 'employee/availability');
    expect(availabilityRoute).toBeDefined();
  });

  it('there is no loadComponent on the bare "employee" path (old dashboard component is gone)', () => {
    const bareEmployee = routes.find((r) => r.path === 'employee');
    expect((bareEmployee as { loadComponent?: unknown }).loadComponent).toBeUndefined();
  });

  it('there is exactly one entry with path "employee" (no duplicate routes)', () => {
    const employeeEntries = routes.filter((r) => r.path === 'employee');
    expect(employeeEntries).toHaveLength(1);
  });
});

// ── Integration: Router navigation with mocked auth ───────────────────────────
//
// These tests use the live `routes` array directly.  The NG04014 bug that previously
// required a corrected local copy has been fixed — canMatch and data were removed from
// the /employee redirect entry.  The destination /employee/schedule route retains its
// own canMatch guards so auth/role enforcement is unaffected.

/** Build a minimal AuthService mock for the given authenticated role. */
function buildAuthMock(role: UserRole | null) {
  return {
    isAuthenticatedSignal: () => role !== null,
    roleSignal: () => role,
    authReady: () => true,
    accessToken: null,
    idToken: null,
    orgId: signal(null),
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

/** Build a minimal ImpersonationService mock. */
function buildImpersonationMock(ctx: ImpersonateContext | null = null) {
  return {
    viewingAs: signal(ctx),
    startImpersonation: () => {},
    endImpersonation: () => {},
  };
}

/** Configure TestBed with the live routes and mocked auth for the given role. */
async function setupRouter(role: UserRole | null, impersonating: ImpersonateContext | null = null) {
  await TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: AuthService, useValue: buildAuthMock(role) },
      { provide: ImpersonationService, useValue: buildImpersonationMock(impersonating) },
    ],
  }).compileComponents();
  return TestBed.inject(Router);
}

describe('app.routes — integration: /employee redirect for authenticated Employee (story #303)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('navigating to /employee as Employee resolves to /employee/schedule', async () => {
    const router = await setupRouter('Employee');
    await router.navigate(['/employee']);
    expect(router.url).toBe('/employee/schedule');
  });

  it('navigating directly to /employee/schedule as Employee stays at /employee/schedule', async () => {
    const router = await setupRouter('Employee');
    await router.navigate(['/employee/schedule']);
    expect(router.url).toBe('/employee/schedule');
  });

  it('navigating to /employee/profile as Employee resolves correctly (not 404)', async () => {
    const router = await setupRouter('Employee');
    await router.navigate(['/employee/profile']);
    expect(router.url).toBe('/employee/profile');
  });

  it('navigating to /employee/availability as Employee resolves correctly', async () => {
    const router = await setupRouter('Employee');
    await router.navigate(['/employee/availability']);
    expect(router.url).toBe('/employee/availability');
  });
});

describe('app.routes — integration: /employee/schedule blocked for non-Employee roles (story #303)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('navigating to /employee/schedule as Manager redirects to /unauthorized', async () => {
    const router = await setupRouter('Manager');
    await router.navigate(['/employee/schedule']);
    expect(router.url).toBe('/unauthorized');
  });

  it('navigating to /employee/schedule as OrgAdmin redirects to /unauthorized', async () => {
    const router = await setupRouter('OrgAdmin');
    await router.navigate(['/employee/schedule']);
    expect(router.url).toBe('/unauthorized');
  });
});

describe('app.routes — integration: /employee blocked for unauthenticated users (story #303)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('navigating to /employee while unauthenticated redirects to /login', async () => {
    const router = await setupRouter(null);
    // /employee redirects to /employee/schedule (no guards on redirect entry)
    // then /employee/schedule's authGuard fires and redirects to /login
    await router.navigate(['/employee']);
    expect(router.url).toBe('/login');
  });

  it('navigating to /employee/schedule while unauthenticated redirects to /login', async () => {
    const router = await setupRouter(null);
    await router.navigate(['/employee/schedule']);
    expect(router.url).toBe('/login');
  });
});

describe('app.routes — integration: WebAdmin impersonating Employee (story #303)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  const employeeCtx: ImpersonateContext = {
    userId: 'wa-imp-1',
    role: 'Employee',
    displayName: 'Imp Employee',
    email: 'imp@test.com',
    orgId: 'org-002',
    sessionId: 'test-session-id',
    expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  };

  it('WebAdmin impersonating Employee can navigate to /employee/schedule', async () => {
    const router = await setupRouter('WebAdmin', employeeCtx);
    await router.navigate(['/employee/schedule']);
    expect(router.url).toBe('/employee/schedule');
  });

  it('WebAdmin impersonating Employee navigating to /employee gets redirected to /employee/schedule', async () => {
    const router = await setupRouter('WebAdmin', employeeCtx);
    await router.navigate(['/employee']);
    expect(router.url).toBe('/employee/schedule');
  });
});
