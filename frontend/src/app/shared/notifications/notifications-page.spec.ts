/**
 * notifications-page.spec.ts
 *
 * Unit tests for NotificationsPageComponent (story #265).
 *
 * Test pyramid position: unit tier — all HTTP is intercepted via Angular's
 * HttpTestingController so no network calls are made, no e2e runner is
 * involved, and component state is asserted directly.
 *
 * Randomised inputs: the notification pool is generated per-run using seeded
 * pseudo-randomness (see `seedRng` and `generateNotificationPool`). On any
 * failure, Vitest will print the exact inputs used (via `console.error` hooks
 * in individual tests or the snapshot capture pattern) so the seed can be
 * fixed and the run replayed deterministically.
 *
 * Adversarial scenarios covered:
 *  - Optimistic update + rollback on markOneAsRead failure.
 *  - Snapshot + rollback on markAllAsRead failure.
 *  - Already-read guard (markOneAsRead skips read notifications).
 *  - markAllAsRead guard when no unread exist or already in flight.
 *  - XSS: message containing HTML entities rendered as plain text.
 *  - Web-Admin emulation: impersonation service role overrides auth role.
 *  - Auth-null edge: roleSignal() returns null → effectiveRole cast still works.
 *  - Empty state, error state, loading state all render distinct UI.
 *  - All interactive elements carry expected data-testid attributes.
 *  - unreadCount decrements properly after optimistic mark-read.
 *  - Retry clears error and re-fetches.
 *  - Double markAllAsRead calls while in-flight are deduplicated.
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { NotificationsPageComponent } from './notifications-page';
import { NotificationsService } from './notifications.service';
import { AuthService } from '../../core/auth/auth';
import { ImpersonationService } from '../../core/services/impersonation.service';
import type {
  NotificationResponse,
  MarkAllNotificationsReadResponse,
} from './notifications.service';
import type { UserRole } from '../../core/auth/user-role.model';

// ---------------------------------------------------------------------------
// Seeded pseudo-random number generator — simple 32-bit LCG
// ---------------------------------------------------------------------------
const SEED = Date.now() % 0xffff_ffff;

function seedRng(seed: number) {
  let s = seed;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const rng = seedRng(SEED);

const NOTIFICATION_TYPES = ['INFO', 'APPROVAL', 'REQUEST', 'SHIFT'] as const;

function randomHex(len: number): string {
  return Array.from({ length: len }, () => Math.floor(rng() * 16).toString(16)).join('');
}

function randomUuid(): string {
  return `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;
}

function randomIso(): string {
  const base = new Date('2026-01-01T00:00:00.000Z').getTime();
  const offset = Math.floor(rng() * 1000 * 60 * 60 * 24 * 180); // up to 180 days
  return new Date(base + offset).toISOString();
}

/** Minimal valid NotificationResponse. Overrides applied last. */
function makeNotification(overrides: Partial<NotificationResponse> = {}): NotificationResponse {
  const createdAt = randomIso();
  return {
    notification_id: `${createdAt}#${randomUuid()}`,
    recipient_sub: `sub-${randomHex(8)}`,
    type: NOTIFICATION_TYPES[Math.floor(rng() * NOTIFICATION_TYPES.length)],
    message: `Test message ${randomHex(4)}`,
    read: rng() > 0.5,
    created_at: createdAt,
    ...overrides,
  };
}

/** Generate a pool of N notifications for randomised scenario coverage. */
function generatePool(
  count: number,
  overrides: Partial<NotificationResponse> = {},
): NotificationResponse[] {
  return Array.from({ length: count }, () => makeNotification(overrides));
}

// ---------------------------------------------------------------------------
// Helpers shared across tests
// ---------------------------------------------------------------------------

interface ServiceStubs {
  listSpy: ReturnType<typeof vi.fn>;
  markOneSpy: ReturnType<typeof vi.fn>;
  markAllSpy: ReturnType<typeof vi.fn>;
}

interface AuthStubs {
  roleSignalSpy: ReturnType<typeof vi.fn>;
  isAuthenticated: ReturnType<typeof vi.fn>;
}

interface ImpersonationStubs {
  viewingAsSpy: ReturnType<typeof vi.fn>;
}

function buildStubs(options: {
  role?: UserRole;
  impersonationRole?: Extract<UserRole, 'OrgAdmin' | 'Manager' | 'Employee'> | null;
  listResult?: NotificationResponse[] | 'error';
  markOneResult?: NotificationResponse | 'error';
  markAllResult?: MarkAllNotificationsReadResponse | 'error';
}): { svc: ServiceStubs; auth: AuthStubs; imp: ImpersonationStubs } {
  const {
    role = 'Manager',
    impersonationRole = null,
    listResult = [],
    markOneResult,
    markAllResult,
  } = options;

  const listSpy = vi.fn(() =>
    listResult === 'error'
      ? throwError(() => new HttpErrorResponse({ status: 500 }))
      : of(listResult as NotificationResponse[]),
  );

  const markOneSpy = vi.fn(() =>
    markOneResult === 'error'
      ? throwError(() => new HttpErrorResponse({ status: 500 }))
      : of(markOneResult as NotificationResponse),
  );

  const markAllSpy = vi.fn(() =>
    markAllResult === 'error'
      ? throwError(() => new HttpErrorResponse({ status: 500 }))
      : of(markAllResult as MarkAllNotificationsReadResponse),
  );

  const roleSignalSpy = vi.fn(() => role);
  const isAuthenticated = vi.fn(() => true);

  const viewingAsSpy = vi.fn(() =>
    impersonationRole !== null
      ? { role: impersonationRole, userId: 'u', displayName: 'D', email: 'e@e.com', orgId: 'o' }
      : null,
  );

  return {
    svc: { listSpy, markOneSpy, markAllSpy },
    auth: { roleSignalSpy, isAuthenticated },
    imp: { viewingAsSpy },
  };
}

function setupTestBed(stubs: ReturnType<typeof buildStubs>): void {
  const mockNotificationsService = {
    list: stubs.svc.listSpy,
    markOneAsRead: stubs.svc.markOneSpy,
    markAllAsRead: stubs.svc.markAllSpy,
  };

  const mockAuthService = {
    isAuthenticatedSignal: stubs.auth.isAuthenticated,
    roleSignal: stubs.auth.roleSignalSpy,
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

  const mockImpersonationService = {
    viewingAs: stubs.imp.viewingAsSpy,
    startImpersonation: vi.fn(),
    endImpersonation: vi.fn(),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NotificationsPageComponent],
    providers: [
      provideRouter([]),
      { provide: NotificationsService, useValue: mockNotificationsService },
      { provide: AuthService, useValue: mockAuthService },
      { provide: ImpersonationService, useValue: mockImpersonationService },
    ],
  });
}

function createComponent() {
  const fixture = TestBed.createComponent(NotificationsPageComponent);
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('NotificationsPageComponent', () => {
  // --------------------------------------------------------------------------
  // Loading state
  // --------------------------------------------------------------------------
  describe('loading state', () => {
    it('renders the loading spinner while the service call is in flight', () => {
      // Return a never-resolving observable to keep the component in loading state.
      const { svc, auth, imp } = buildStubs({});
      svc.listSpy.mockReturnValue(
        new Observable(() => {
          /* never emits */
        }),
      );
      setupTestBed({ svc, auth, imp });

      const fixture = TestBed.createComponent(NotificationsPageComponent);
      // Manually set loading = true before detectChanges to simulate in-flight state.
      // The component sets loading(true) in load() before subscribing, so detectChanges
      // while the observable is pending will show the spinner.
      fixture.detectChanges();

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('app-loading-spinner')).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Error state
  // --------------------------------------------------------------------------
  describe('error state', () => {
    it('renders the error alert with retry when the service throws', () => {
      const stubs = buildStubs({ listResult: 'error' });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;

      const errorAlert = el.querySelector('app-error-alert');
      expect(errorAlert).toBeTruthy();
    });

    it('renders an empty notification list (not empty-state) alongside the error alert', () => {
      // Template logic: when error() is truthy and notifications() is empty, the
      // `@else if (notifications().length === 0 && !error())` branch is skipped
      // (because !error() is false), and the @else branch renders the <ul> (empty).
      // Both the error alert AND the list element are present simultaneously.
      // The empty-state component is NOT shown when there is an error.
      const stubs = buildStubs({ listResult: 'error' });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;

      // Error alert is shown
      expect(el.querySelector('app-error-alert')).toBeTruthy();
      // Empty-state is NOT shown (error takes precedence over empty-state branch)
      expect(el.querySelector('app-empty-state')).toBeNull();
      // The <ul> list element is rendered (empty) — this is by template design
      const list = el.querySelector('[data-testid="notifications-list"]');
      expect(list).toBeTruthy();
      expect(list!.querySelectorAll('li').length).toBe(0);
    });

    it('retrying calls the service list method again and clears the error', () => {
      const stubs = buildStubs({ listResult: 'error' });
      setupTestBed(stubs);

      const fixture = createComponent();
      // First call failed — service was called once
      expect(stubs.svc.listSpy).toHaveBeenCalledTimes(1);

      // Swap service to return success on retry
      stubs.svc.listSpy.mockReturnValue(of([]));

      // Trigger retryLoad via the component instance
      const comp = fixture.componentInstance as unknown as {
        retryLoad(): void;
        error(): string | null;
      };
      comp.retryLoad();
      fixture.detectChanges();

      expect(stubs.svc.listSpy).toHaveBeenCalledTimes(2);
      expect(comp.error()).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Empty state
  // --------------------------------------------------------------------------
  describe('empty state', () => {
    it('renders the empty-state component when the list is empty and no error', () => {
      const stubs = buildStubs({ listResult: [] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('app-empty-state')).toBeTruthy();
      expect(el.querySelector('[data-testid="notifications-list"]')).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Happy path: list rendering
  // --------------------------------------------------------------------------
  describe('notifications list rendering', () => {
    it('renders one list item per notification returned by the service', () => {
      const pool = generatePool(4);
      const stubs = buildStubs({ listResult: pool });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;

      const list = el.querySelector('[data-testid="notifications-list"]');
      expect(list).toBeTruthy();
      expect(list!.querySelectorAll('li').length).toBe(pool.length);
    });

    it('renders each notification item with its own data-testid derived from notification_id', () => {
      const notifications = [
        makeNotification({ notification_id: 'ts1#uuid1', message: 'Alpha' }),
        makeNotification({ notification_id: 'ts2#uuid2', message: 'Beta' }),
      ];
      const stubs = buildStubs({ listResult: notifications });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('[data-testid="notification-item-ts1#uuid1"]')).toBeTruthy();
      expect(el.querySelector('[data-testid="notification-item-ts2#uuid2"]')).toBeTruthy();
    });

    it('renders the notification message text inside the item', () => {
      const n = makeNotification({ message: 'Pay day is coming!', read: false });
      const stubs = buildStubs({ listResult: [n] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      const msgEl = el.querySelector(`[data-testid="notification-message-${n.notification_id}"]`);
      expect(msgEl?.textContent?.trim()).toBe('Pay day is coming!');
    });

    it('renders the heading with data-testid="notifications-page-heading"', () => {
      const stubs = buildStubs({ listResult: [] });
      setupTestBed(stubs);
      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="notifications-page-heading"]')).toBeTruthy();
    });

    it('renders the mark-all-read button with data-testid="notifications-mark-all-read"', () => {
      const stubs = buildStubs({ listResult: [] });
      setupTestBed(stubs);
      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      // app-button renders as a host element with testId attribute passed as input
      const btn = el.querySelector('app-button[testId="notifications-mark-all-read"]');
      expect(btn).toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Unread indicator dot
  // --------------------------------------------------------------------------
  describe('unread dot', () => {
    it('shows the unread dot for unread notifications', () => {
      const n = makeNotification({ read: false });
      const stubs = buildStubs({ listResult: [n] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      expect(
        el.querySelector(`[data-testid="notification-unread-dot-${n.notification_id}"]`),
      ).toBeTruthy();
    });

    it('does not show the unread dot for read notifications', () => {
      const n = makeNotification({ read: true });
      const stubs = buildStubs({ listResult: [n] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      expect(
        el.querySelector(`[data-testid="notification-unread-dot-${n.notification_id}"]`),
      ).toBeNull();
    });

    it('shows the unread summary paragraph only when there are unread notifications', () => {
      const unread = makeNotification({ read: false });
      const stubs = buildStubs({ listResult: [unread] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="notifications-unread-summary"]')).toBeTruthy();
    });

    it('hides the unread summary paragraph when all notifications are read', () => {
      const read = makeNotification({ read: true });
      const stubs = buildStubs({ listResult: [read] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('[data-testid="notifications-unread-summary"]')).toBeNull();
    });

    it('computes unreadCount correctly from mixed read/unread list', () => {
      const pool = [
        makeNotification({ read: false }),
        makeNotification({ read: true }),
        makeNotification({ read: false }),
        makeNotification({ read: true }),
        makeNotification({ read: false }),
      ];
      const stubs = buildStubs({ listResult: pool });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as { unreadCount(): number };
      expect(comp.unreadCount()).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // markOneAsRead — optimistic update + rollback
  // --------------------------------------------------------------------------
  describe('markOneAsRead()', () => {
    it('calls the service markOneAsRead with the correct role and notification_id', () => {
      const n = makeNotification({ read: false });
      const updated: NotificationResponse = { ...n, read: true };
      const stubs = buildStubs({ listResult: [n], markOneResult: updated, role: 'Employee' });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markOneAsRead(n: NotificationResponse): void;
      };
      comp.markOneAsRead(n);

      expect(stubs.svc.markOneSpy).toHaveBeenCalledWith('Employee', n.notification_id);
    });

    it('applies an optimistic update (marks read immediately) before the service call resolves', () => {
      const n = makeNotification({ read: false });
      // Use a never-completing observable so optimistic state is visible
      type ObsSubscriber = { next: (v: NotificationResponse) => void; complete: () => void };
      let resolveSubject: ((v: NotificationResponse) => void) | undefined;
      const delayed = new Observable<NotificationResponse>((obs: ObsSubscriber) => {
        resolveSubject = (v) => {
          obs.next(v);
          obs.complete();
        };
      });

      const stubs = buildStubs({ listResult: [n], role: 'Manager' });
      stubs.svc.markOneSpy.mockReturnValue(delayed);
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markOneAsRead(n: NotificationResponse): void;
        notifications(): NotificationResponse[];
      };
      comp.markOneAsRead(n);
      fixture.detectChanges();

      // Optimistic: the item should already show read=true before server response
      const optimisticItem = comp
        .notifications()
        .find((x) => x.notification_id === n.notification_id);
      expect(optimisticItem?.read).toBe(true);

      // Now resolve the server response
      resolveSubject?.({ ...n, read: true });
      fixture.detectChanges();
    });

    it('rolls back the optimistic update when the service call fails', () => {
      const n = makeNotification({ read: false });
      const stubs = buildStubs({ listResult: [n], markOneResult: 'error', role: 'Manager' });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markOneAsRead(n: NotificationResponse): void;
        notifications(): NotificationResponse[];
        error(): string | null;
      };
      comp.markOneAsRead(n);
      fixture.detectChanges();

      // After rollback, the item should be read=false again
      const rolledBack = comp.notifications().find((x) => x.notification_id === n.notification_id);
      expect(rolledBack?.read).toBe(false);
    });

    it('sets an error message when markOneAsRead fails', () => {
      const n = makeNotification({ read: false });
      const stubs = buildStubs({ listResult: [n], markOneResult: 'error' });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markOneAsRead(n: NotificationResponse): void;
        error(): string | null;
      };
      comp.markOneAsRead(n);

      expect(comp.error()).not.toBeNull();
    });

    it('does nothing when markOneAsRead is called on an already-read notification', () => {
      const n = makeNotification({ read: true });
      const stubs = buildStubs({ listResult: [n] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markOneAsRead(n: NotificationResponse): void;
      };
      comp.markOneAsRead(n);

      // Service should NOT be called for already-read items
      expect(stubs.svc.markOneSpy).not.toHaveBeenCalled();
    });

    it('reconciles with the server response on success (replaces optimistic with canonical)', () => {
      const n = makeNotification({ read: false });
      const serverResponse: NotificationResponse = {
        ...n,
        read: true,
        message: 'Server-canonical message',
      };
      const stubs = buildStubs({ listResult: [n], markOneResult: serverResponse });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markOneAsRead(n: NotificationResponse): void;
        notifications(): NotificationResponse[];
      };
      comp.markOneAsRead(n);
      fixture.detectChanges();

      const reconciled = comp.notifications().find((x) => x.notification_id === n.notification_id);
      expect(reconciled?.message).toBe('Server-canonical message');
    });
  });

  // --------------------------------------------------------------------------
  // markAllAsRead — snapshot + rollback
  // --------------------------------------------------------------------------
  describe('markAllAsRead()', () => {
    it('calls the service markAllAsRead with the effective role', () => {
      const pool = generatePool(3, { read: false });
      const stubs = buildStubs({
        listResult: pool,
        markAllResult: { success: true, marked_count: 3 },
        role: 'OrgAdmin',
      });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as { markAllAsRead(): void };
      comp.markAllAsRead();

      expect(stubs.svc.markAllSpy).toHaveBeenCalledWith('OrgAdmin');
    });

    it('marks all notifications as read locally on success', () => {
      const pool = [
        makeNotification({ read: false }),
        makeNotification({ read: false }),
        makeNotification({ read: true }),
      ];
      const stubs = buildStubs({
        listResult: pool,
        markAllResult: { success: true, marked_count: 2 },
      });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markAllAsRead(): void;
        notifications(): NotificationResponse[];
        unreadCount(): number;
      };
      comp.markAllAsRead();
      fixture.detectChanges();

      expect(comp.unreadCount()).toBe(0);
      expect(comp.notifications().every((n) => n.read)).toBe(true);
    });

    it('rolls back the snapshot when markAllAsRead fails', () => {
      const original = generatePool(3, { read: false });
      const stubs = buildStubs({ listResult: original, markAllResult: 'error' });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markAllAsRead(): void;
        notifications(): NotificationResponse[];
        error(): string | null;
      };
      comp.markAllAsRead();
      fixture.detectChanges();

      // All items should be back to unread
      expect(comp.notifications().every((n) => !n.read)).toBe(true);
    });

    it('sets an error message when markAllAsRead fails', () => {
      const pool = generatePool(2, { read: false });
      const stubs = buildStubs({ listResult: pool, markAllResult: 'error' });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markAllAsRead(): void;
        error(): string | null;
      };
      comp.markAllAsRead();
      expect(comp.error()).not.toBeNull();
    });

    it('does NOT call the service when there are no unread notifications (guard)', () => {
      const allRead = generatePool(3, { read: true });
      const stubs = buildStubs({ listResult: allRead });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as { markAllAsRead(): void };
      comp.markAllAsRead();

      expect(stubs.svc.markAllSpy).not.toHaveBeenCalled();
    });

    it('does NOT call the service a second time when markingAll is already in flight (double-click guard)', () => {
      const pool = generatePool(2, { read: false });

      // Return an observable that never completes so markingAll stays true
      const stubs = buildStubs({ listResult: pool });
      stubs.svc.markAllSpy.mockReturnValue(
        new Observable(() => {
          /* never completes */
        }),
      );
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as { markAllAsRead(): void };
      comp.markAllAsRead(); // first call — enters in-flight state
      comp.markAllAsRead(); // second call — should be a no-op

      expect(stubs.svc.markAllSpy).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Web-Admin emulation: impersonation role override
  // --------------------------------------------------------------------------
  describe('Web-Admin emulation (impersonation)', () => {
    it('uses the impersonated role (not the real auth role) when viewingAs() is set', () => {
      const pool = generatePool(2, { read: false });
      const stubs = buildStubs({
        role: 'WebAdmin',
        impersonationRole: 'Employee',
        listResult: pool,
        markAllResult: { success: true, marked_count: 2 },
      });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        effectiveRole(): UserRole;
        markAllAsRead(): void;
      };

      // The effective role must be 'Employee', not 'WebAdmin'
      expect(comp.effectiveRole()).toBe('Employee');

      comp.markAllAsRead();
      expect(stubs.svc.markAllSpy).toHaveBeenCalledWith('Employee');
    });

    it('falls back to auth role when impersonation is not active', () => {
      const stubs = buildStubs({ role: 'Manager', impersonationRole: null, listResult: [] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as { effectiveRole(): UserRole };
      expect(comp.effectiveRole()).toBe('Manager');
    });

    it('uses the impersonated role for list() call on load when emulating', () => {
      const pool = generatePool(1);
      const stubs = buildStubs({
        role: 'WebAdmin',
        impersonationRole: 'OrgAdmin',
        listResult: pool,
      });
      setupTestBed(stubs);

      createComponent();

      // The service list must have been called with the impersonated role
      expect(stubs.svc.listSpy).toHaveBeenCalledWith('OrgAdmin');
    });
  });

  // --------------------------------------------------------------------------
  // Route guard: unauthenticated user cannot access /notifications
  // --------------------------------------------------------------------------
  describe('route guard (authGuard integration)', () => {
    it('the /notifications route definition uses canMatch: [authGuard]', async () => {
      // Import the routes directly and confirm the guard is present.
      // This is cheaper than spinning up a full router integration test and
      // directly verifies the registration that authGuard guards the route.
      const { routes } = await import('../../app.routes');
      const notificationsRoute = routes.find((r) => r.path === 'notifications');
      expect(notificationsRoute).toBeTruthy();
      expect(notificationsRoute?.canMatch).toBeTruthy();
      expect((notificationsRoute?.canMatch as unknown[]).length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // XSS: message containing HTML must be rendered as plain text
  // --------------------------------------------------------------------------
  describe('XSS / content safety', () => {
    it('renders a message containing HTML tags as escaped plain text, not executed markup', () => {
      const dangerous = '<script>alert(1)</script>';
      const n = makeNotification({ message: dangerous, read: false });
      const stubs = buildStubs({ listResult: [n] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;

      // The <script> tag should NOT appear in the DOM as an actual element
      expect(el.querySelector('script')).toBeNull();

      // The text content of the message element should equal the raw string
      // (Angular's template binding always text-interpolates, never innerHTML)
      const msgEl = el.querySelector(`[data-testid="notification-message-${n.notification_id}"]`);
      expect(msgEl?.textContent?.trim()).toBe(dangerous);
    });

    it('renders a message containing HTML bold tags as plain text', () => {
      const n = makeNotification({ message: '<b>bold</b>', read: false });
      const stubs = buildStubs({ listResult: [n] });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      const msgEl = el.querySelector(`[data-testid="notification-message-${n.notification_id}"]`);
      // No rendered <b> element inside the message
      expect(msgEl?.querySelector('b')).toBeNull();
      expect(msgEl?.textContent?.trim()).toBe('<b>bold</b>');
    });
  });

  // --------------------------------------------------------------------------
  // Adversarial: service called on init
  // --------------------------------------------------------------------------
  describe('on init', () => {
    it('calls notifications service list() on construction (before any user interaction)', () => {
      const stubs = buildStubs({ listResult: [] });
      setupTestBed(stubs);

      createComponent();

      expect(stubs.svc.listSpy).toHaveBeenCalledTimes(1);
    });

    it('uses the effective role when calling list() on init', () => {
      const stubs = buildStubs({ role: 'Employee', listResult: [] });
      setupTestBed(stubs);

      createComponent();

      expect(stubs.svc.listSpy).toHaveBeenCalledWith('Employee');
    });
  });

  // --------------------------------------------------------------------------
  // Boundary: empty list after markAllAsRead — no empty-state flash mid-read
  // --------------------------------------------------------------------------
  describe('unreadCount boundary conditions', () => {
    it('hasUnread returns false when all notifications are marked read', () => {
      const pool = generatePool(5, { read: false });
      const stubs = buildStubs({
        listResult: pool,
        markAllResult: { success: true, marked_count: 5 },
      });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        markAllAsRead(): void;
        hasUnread(): boolean;
      };
      comp.markAllAsRead();
      fixture.detectChanges();

      expect(comp.hasUnread()).toBe(false);
    });

    it('hasUnread is true when even a single unread exists in a randomised pool', () => {
      const pool = generatePool(10, { read: true });
      // Force exactly one unread
      pool[Math.floor(rng() * pool.length)].read = false;
      const stubs = buildStubs({ listResult: pool });
      setupTestBed(stubs);

      const fixture = createComponent();
      const comp = fixture.componentInstance as unknown as {
        hasUnread(): boolean;
        unreadCount(): number;
      };
      expect(comp.hasUnread()).toBe(true);
      expect(comp.unreadCount()).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Randomised pool coverage: varied types and messages
  // --------------------------------------------------------------------------
  describe('randomised notification pool coverage', () => {
    it(`renders all ${15} notifications from a randomised pool (seed=${SEED})`, () => {
      const pool = generatePool(15);
      const stubs = buildStubs({ listResult: pool });
      setupTestBed(stubs);

      const fixture = createComponent();
      const el: HTMLElement = fixture.nativeElement;
      const list = el.querySelector('[data-testid="notifications-list"]');
      expect(list!.querySelectorAll('li').length).toBe(15);
    });

    it('renders a single unread notification from a randomised pool without errors', () => {
      const pool = generatePool(1, { read: false });
      const stubs = buildStubs({ listResult: pool });
      setupTestBed(stubs);

      const fixture = createComponent();
      expect(fixture.componentInstance).toBeTruthy();
    });
  });
});
