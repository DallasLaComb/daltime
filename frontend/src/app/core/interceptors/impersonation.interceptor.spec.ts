import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { impersonationInterceptor } from './impersonation.interceptor';
import { ImpersonationService } from '../services/impersonation.service';
import { environment } from '../../../environments/environment';

/**
 * Phase 2 runs two transports in parallel: the legacy URL rewrite through the
 * web-admin proxy AND the `X-Impersonate-User` header the contract declares.
 * These tests pin both so the phase 3 cutover (drop the rewrite) is a visible,
 * deliberate test change.
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

  it('rewrites the URL and sets the header while impersonating', () => {
    viewingAs.set(TARGET);
    http.get(`${BASE}/manager/shifts`).subscribe();

    const req = httpMock.expectOne(`${BASE}/web-admin/impersonate/user-42/manager/shifts`);
    expect(req.request.headers.get('X-Impersonate-User')).toBe('user-42');
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
