import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NotificationsService } from './notifications.service';
import { environment } from '../../../environments/environment';
import type { NotificationResponse } from './notifications.service';

const mockNotification: NotificationResponse = {
  notification_id: '2026-06-18T12:00:00.000Z#a1b2c3d4-0000-0000-0000-000000000000',
  recipient_sub: 'sub-123',
  type: 'INFO',
  message: 'Test notification',
  read: false,
  created_at: '2026-06-18T12:00:00.000Z',
};

describe('NotificationsService', () => {
  let service: NotificationsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [NotificationsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(NotificationsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('list()', () => {
    it('sends GET to the role-prefixed notifications route', () => {
      service.list('OrgAdmin').subscribe((result) => {
        expect(result).toEqual([mockNotification]);
      });

      const req = httpMock.expectOne(`${environment.api.baseUrl}/org-admin/notifications`);
      expect(req.request.method).toBe('GET');
      req.flush([mockNotification]);
    });

    it('maps each UserRole to its kebab-case URL segment', () => {
      service.list('WebAdmin').subscribe();
      httpMock.expectOne(`${environment.api.baseUrl}/web-admin/notifications`).flush([]);

      service.list('Manager').subscribe();
      httpMock.expectOne(`${environment.api.baseUrl}/manager/notifications`).flush([]);

      service.list('Employee').subscribe();
      httpMock.expectOne(`${environment.api.baseUrl}/employee/notifications`).flush([]);
    });
  });

  describe('markAllAsRead()', () => {
    it('sends PATCH to the role-prefixed notifications route with no notificationId', () => {
      service.markAllAsRead('Manager').subscribe((result) => {
        expect(result).toEqual({ success: true, marked_count: 2 });
      });

      const req = httpMock.expectOne(`${environment.api.baseUrl}/manager/notifications`);
      expect(req.request.method).toBe('PATCH');
      req.flush({ success: true, marked_count: 2 });
    });
  });

  describe('markOneAsRead()', () => {
    // This is the critical landmine test: the composite notification_id contains
    // literal `#` and `:` characters. If the service fails to encodeURIComponent
    // it before building the URL, the `#` would be (mis)treated as a URL fragment
    // delimiter and everything after it would be silently dropped client-side —
    // a failure that would NOT surface as an HTTP error, making it especially
    // dangerous. This test asserts on the actual captured request URL string,
    // not merely that the call completes, so a regression here is caught even
    // if it doesn't throw.
    it('encodes the notification_id before building the request URL so literal # and : do not truncate the path', () => {
      const rawId = '2026-06-18T12:00:00.000Z#a1b2c3d4-0000-0000-0000-000000000000';
      const expectedEncodedId = encodeURIComponent(rawId);

      service.markOneAsRead('Employee', rawId).subscribe((result) => {
        expect(result).toEqual(mockNotification);
      });

      const expectedUrl = `${environment.api.baseUrl}/employee/notifications/${expectedEncodedId}`;
      const req = httpMock.expectOne(expectedUrl);

      // Assert the encoded id is actually present in the URL and the raw,
      // unencoded `#`/`:` characters are not — i.e. the URL was NOT truncated
      // into a fragment. encodeURIComponent turns `#` into `%23` and `:` into
      // `%3A`, so we assert those substrings are present.
      expect(req.request.url).toContain('%23');
      expect(req.request.url).toContain('%3A');
      expect(req.request.url.endsWith('#')).toBe(false);
      expect(req.request.method).toBe('PATCH');

      req.flush(mockNotification);
    });

    it('produces a URL HttpTestingController can match exactly via expectOne with the raw id pre-encoded by the test', () => {
      // Cross-check using a different raw id with multiple reserved characters
      // to make sure encoding isn't accidentally only handling one occurrence.
      const rawId = '2026-01-01T00:00:00.000Z#11111111-1111-1111-1111-111111111111';

      service.markOneAsRead('OrgAdmin', rawId).subscribe();

      const req = httpMock.expectOne(
        `${environment.api.baseUrl}/org-admin/notifications/${encodeURIComponent(rawId)}`,
      );
      expect(req.request.method).toBe('PATCH');
      req.flush(mockNotification);
    });
  });
});
