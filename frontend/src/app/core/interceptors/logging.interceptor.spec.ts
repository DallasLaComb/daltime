import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { loggingInterceptor } from './logging.interceptor';
import { LoggerService } from '../logging/logger.service';
import { environment } from '../../../environments/environment';

const BASE = environment.api.baseUrl;

describe('loggingInterceptor', () => {
  const logger = { logHttpFailure: vi.fn() };
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    logger.logHttpFailure.mockClear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([loggingInterceptor])),
        provideHttpClientTesting(),
        { provide: LoggerService, useValue: logger },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('adds X-Correlation-Id and X-Platform to an API request', () => {
    http.get(`${BASE}/manager/shifts`).subscribe();

    const req = httpMock.expectOne(`${BASE}/manager/shifts`);
    expect(req.request.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(req.request.headers.get('X-Platform')).toBe('web');
    req.flush({});
  });

  it('gives each request its own correlation id', () => {
    http.get(`${BASE}/manager/shifts`).subscribe();
    http.get(`${BASE}/manager/locations`).subscribe();

    const [reqA, reqB] = httpMock.match(() => true);
    expect(reqA.request.headers.get('X-Correlation-Id')).not.toBe(
      reqB.request.headers.get('X-Correlation-Id'),
    );
    reqA.flush({});
    reqB.flush({});
  });

  it('logs a failed request once with method, path and status', () => {
    http.get(`${BASE}/manager/shifts`).subscribe({ error: () => undefined });

    const req = httpMock.expectOne(`${BASE}/manager/shifts`);
    req.flush({ message: 'nope' }, { status: 500, statusText: 'Server Error' });

    expect(logger.logHttpFailure).toHaveBeenCalledTimes(1);
    const [method, path, status, correlationId] = logger.logHttpFailure.mock.calls[0];
    expect(method).toBe('GET');
    expect(path).toBe('/manager/shifts');
    expect(status).toBe(500);
    expect(correlationId).toBe(req.request.headers.get('X-Correlation-Id'));
  });

  it('strips the query string from the logged path', () => {
    http.get(`${BASE}/manager/shifts?week=2026-09-21`).subscribe({ error: () => undefined });

    const req = httpMock.expectOne(`${BASE}/manager/shifts?week=2026-09-21`);
    req.flush({}, { status: 404, statusText: 'Not Found' });

    const [, path] = logger.logHttpFailure.mock.calls[0];
    expect(path).toBe('/manager/shifts');
  });

  it('does not log a successful request', () => {
    http.get(`${BASE}/manager/shifts`).subscribe();

    const req = httpMock.expectOne(`${BASE}/manager/shifts`);
    req.flush({});

    expect(logger.logHttpFailure).not.toHaveBeenCalled();
  });

  it('leaves requests to other origins untouched', () => {
    http.get('https://example.com/manager/shifts').subscribe();

    const req = httpMock.expectOne('https://example.com/manager/shifts');
    expect(req.request.headers.has('X-Correlation-Id')).toBe(false);
    req.flush({});
  });
});
