import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { impersonationInterceptor } from './impersonation.interceptor';
import { ImpersonationService } from '../services/impersonation.service';
import { environment } from '../../../environments/environment';

/**
 * Impersonation is header-only: role requests keep their real URL and carry
 * `X-Impersonate-User`. The URL must never be rewritten (the old proxy no longer exists).
 */

const BASE = environment.api.baseUrl;
const TARGET = { userId: 'user-42' };

describe('impersonationInterceptor', () => {
  const viewingAs = signal<{ userId: string } | null>(null);
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    viewingAs.set(null);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([impersonationInterceptor])),
        provideHttpClientTesting(),
        { provide: ImpersonationService, useValue: { viewingAs } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sets the header and leaves the URL untouched while impersonating', () => {
    viewingAs.set(TARGET);
    http.get(`${BASE}/manager/shifts`).subscribe();

    const req = httpMock.expectOne(`${BASE}/manager/shifts`);
    expect(req.request.headers.get('X-Impersonate-User')).toBe('user-42');
    req.flush({});
  });

  it.each(['/org-admin/locations', '/manager/shifts-needed', '/employee/profile'])(
    'sets the header on the role route %s without rewriting it',
    (path) => {
      viewingAs.set(TARGET);
      http.get(`${BASE}${path}`).subscribe();

      const req = httpMock.expectOne(`${BASE}${path}`);
      expect(req.request.headers.get('X-Impersonate-User')).toBe('user-42');
      req.flush({});
    },
  );

  it('never routes a request through /web-admin/impersonate/{userId}/… (the proxy is gone)', () => {
    viewingAs.set(TARGET);
    http.post(`${BASE}/manager/shifts`, {}).subscribe();

    // A rewrite would fail expectOne here, because no request to the original URL would exist.
    const req = httpMock.expectOne(`${BASE}/manager/shifts`);
    expect(req.request.url).not.toContain('/impersonate/');
    req.flush({});
  });

  it('leaves requests untouched when not impersonating', () => {
    http.get(`${BASE}/manager/shifts`).subscribe();

    const req = httpMock.expectOne(`${BASE}/manager/shifts`);
    expect(req.request.headers.has('X-Impersonate-User')).toBe(false);
    req.flush({});
  });

  it('does not touch non-role paths (web-admin picker routes)', () => {
    viewingAs.set(TARGET);
    http.get(`${BASE}/web-admin/impersonate/users`).subscribe();

    const req = httpMock.expectOne(`${BASE}/web-admin/impersonate/users`);
    expect(req.request.headers.has('X-Impersonate-User')).toBe(false);
    req.flush([]);
  });

  it('does not touch requests to other origins', () => {
    viewingAs.set(TARGET);
    http.get('https://example.com/manager/shifts').subscribe();

    const req = httpMock.expectOne('https://example.com/manager/shifts');
    expect(req.request.headers.has('X-Impersonate-User')).toBe(false);
    req.flush({});
  });
});
