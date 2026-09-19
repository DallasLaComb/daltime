import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Router } from '@angular/router';
import { NotificationBellComponent } from './notification-bell';
import { environment } from '../../../environments/environment';
import type { NotificationResponse } from './notifications.service';

/**
 * Factory for a minimal valid NotificationResponse. Overrides allow individual
 * test cases to customise only the fields they care about without repeating
 * the full shape every time.
 */
function makeNotification(overrides: Partial<NotificationResponse> = {}): NotificationResponse {
  return {
    notification_id: '2026-06-18T12:00:00.000Z#a1b2c3d4-0000-0000-0000-000000000000',
    recipient_sub: 'sub-123',
    type: 'INFO',
    message: 'Default message',
    read: false,
    created_at: '2026-06-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationBellComponent', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NotificationBellComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Router is injected by the component for navigate(['/notifications']).
        provideRouter([]),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  /**
   * Creates the component and flushes the eager list request so tests can
   * assert on the component state without having a pending HTTP expectation.
   */
  function createAndFlush(
    role: 'OrgAdmin' | 'Manager' | 'Employee' | 'WebAdmin' = 'OrgAdmin',
    listResponse: NotificationResponse[] = [],
  ) {
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.componentRef.setInput('role', role);
    fixture.detectChanges();

    // The component loads eagerly on mount to populate the badge.
    const roleSegment =
      role === 'OrgAdmin' ? 'org-admin' : role === 'WebAdmin' ? 'web-admin' : role.toLowerCase();
    const req = httpMock.expectOne(`${environment.api.baseUrl}/${roleSegment}/notifications`);
    req.flush(listResponse);
    fixture.detectChanges();

    return fixture;
  }

  it('renders the bell button with data-testid="notification-bell"', () => {
    const fixture = createAndFlush('OrgAdmin');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notification-bell"]')).toBeTruthy();
  });

  it('does NOT render an unread badge when all notifications are read', () => {
    const fixture = createAndFlush('Employee', [makeNotification({ read: true })]);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="notification-unread-badge"]')).toBeNull();
  });

  it('renders the unread badge with the correct count when there are unread notifications', () => {
    const fixture = createAndFlush('Manager', [
      makeNotification({ notification_id: 'a', read: false }),
      makeNotification({ notification_id: 'b', read: true }),
      makeNotification({ notification_id: 'c', read: false }),
    ]);
    const el: HTMLElement = fixture.nativeElement;
    const badge = el.querySelector('[data-testid="notification-unread-badge"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent?.trim()).toBe('2');
  });

  it('caps the badge display at "9+" when there are more than 9 unread notifications', () => {
    const tenUnread = Array.from({ length: 10 }, (_, i) =>
      makeNotification({ notification_id: `n${i}`, read: false }),
    );
    const fixture = createAndFlush('Manager', tenUnread);
    const el: HTMLElement = fixture.nativeElement;
    const badge = el.querySelector('[data-testid="notification-unread-badge"]');
    expect(badge?.textContent?.trim()).toBe('9+');
  });

  it('computes unreadCount from the list response without a separate API call', () => {
    const fixture = createAndFlush('OrgAdmin', [
      makeNotification({ notification_id: 'a', read: false }),
      makeNotification({ notification_id: 'b', read: true }),
    ]);

    const unreadCount = (
      fixture.componentInstance as unknown as { unreadCount(): number }
    ).unreadCount();
    expect(unreadCount).toBe(1);

    // httpMock.verify() in afterEach confirms no unexpected requests were made.
  });

  it('navigates to /notifications when the bell button is clicked', () => {
    const fixture = createAndFlush('Employee');
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    const bell: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      '[data-testid="notification-bell"]',
    );
    bell?.click();
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/notifications']);
  });

  it('sets aria-label to include the unread count when there are unread notifications', () => {
    const fixture = createAndFlush('Manager', [
      makeNotification({ notification_id: 'x', read: false }),
    ]);
    const bell: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-testid="notification-bell"]',
    );
    expect(bell?.getAttribute('aria-label')).toContain('1 unread');
  });

  it('sets aria-label to a generic label when there are no unread notifications', () => {
    const fixture = createAndFlush('Manager', [makeNotification({ read: true })]);
    const bell: HTMLElement | null = fixture.nativeElement.querySelector(
      '[data-testid="notification-bell"]',
    );
    expect(bell?.getAttribute('aria-label')).toBe('Notifications');
  });

  it('renders the sr-only live region for screen-reader unread count announcements', () => {
    const fixture = createAndFlush('OrgAdmin', [makeNotification({ read: false })]);
    const el: HTMLElement = fixture.nativeElement;
    const liveRegion = el.querySelector('[data-testid="notification-unread-live-region"]');
    expect(liveRegion).toBeTruthy();
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
  });

  it('calls the role-prefixed notifications URL using the role input (OrgAdmin -> org-admin)', () => {
    // createAndFlush already calls httpMock.expectOne with the role-prefixed URL
    // and would fail if the URL was wrong — this test makes the assertion explicit.
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.componentRef.setInput('role', 'OrgAdmin');
    fixture.detectChanges();
    const req = httpMock.expectOne(`${environment.api.baseUrl}/org-admin/notifications`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
    fixture.detectChanges();
  });
});
