import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiClient } from './api-client';
import { environment } from '../../../environments/environment';

/**
 * Tests for the contract-driven HTTP client.
 *
 * The compile-time half of this client's job — rejecting unknown paths, wrong
 * methods, and misshapen bodies — is enforced by `tsc` and cannot be asserted at
 * runtime. What is tested here is the runtime half: that it builds the right
 * URL, and that it goes through Angular's `HttpClient` so the auth and
 * impersonation interceptors still see every request.
 */

const PROFILE_URL = `${environment.api.baseUrl}/manager/profile`;

const mockProfile = {
  manager_id: 'mgr-1',
  first_name: 'Morgan',
  last_name: 'Manager',
  email: 'morgan@example.dev',
  phone: '555-0002',
  org_id: 'org-1',
  org_admin_id: 'oa-1',
  status: 'CONFIRMED' as const,
  employee_count: 4,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('ApiClient', () => {
  let api: ApiClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ApiClient, provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('issues a GET against the configured API base URL', () => {
    let received: unknown;
    api.get('/manager/profile').subscribe((result) => (received = result));

    const req = httpMock.expectOne(PROFILE_URL);
    expect(req.request.method).toBe('GET');
    req.flush(mockProfile);

    expect(received).toEqual(mockProfile);
  });

  it('issues a PUT carrying the request body unchanged', () => {
    api.put('/manager/profile', { first_name: 'Morgana' }).subscribe();

    const req = httpMock.expectOne(PROFILE_URL);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ first_name: 'Morgana' });
    req.flush(mockProfile);
  });

  it('routes through HttpClient, so interceptors observe the request', () => {
    // If this client ever moved to `fetch`, HttpTestingController would see
    // nothing here and auth/impersonation headers would be silently dropped.
    api.get('/manager/profile').subscribe();

    expect(httpMock.match(PROFILE_URL).length).toBe(1);
    httpMock.verify();
  });

  it('sends no query string when an operation declares no query parameters', () => {
    api.get('/manager/profile').subscribe();

    const req = httpMock.expectOne(PROFILE_URL);
    expect(req.request.params.keys().length).toBe(0);
    req.flush(mockProfile);
  });

  it('surfaces server errors to the caller so services can map them', () => {
    let status: number | undefined;
    api.get('/manager/profile').subscribe({ error: (err) => (status = err.status) });

    httpMock
      .expectOne(PROFILE_URL)
      .flush({ error: 'Profile not found' }, { status: 404, statusText: 'Not Found' });

    expect(status).toBe(404);
  });
});
