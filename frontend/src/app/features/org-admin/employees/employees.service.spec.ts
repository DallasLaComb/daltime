import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmployeesService } from './employees.service';
import { environment } from '../../../../environments/environment';

/**
 * The service calls through `ApiClient`, which is typed from
 * `contracts/openapi.json`. These assert the runtime half of that: the URL each
 * method builds from the contract's path template, and that requests still go
 * through Angular's HttpClient so the auth and impersonation interceptors run.
 */

const API_BASE = `${environment.api.baseUrl}/org-admin/employees`;

const mockEmployee = {
  employee_id: 'emp-123',
  first_name: 'Jane',
  last_name: 'Smith',
  email: 'jane@acme.com',
  phone: '555-5678',
  org_id: 'org-123',
  manager_id: 'mgr-123',
  status: 'CONFIRMED' as const,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

describe('EmployeesService', () => {
  let service: EmployeesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [EmployeesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(EmployeesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getAll()', () => {
    it('sends GET to /org-admin/employees and returns the employee array', () => {
      service.getAll().subscribe((result) => {
        expect(result).toEqual([mockEmployee]);
      });

      const req = httpMock.expectOne(API_BASE);
      expect(req.request.method).toBe('GET');
      req.flush([mockEmployee]);
    });
  });

  describe('create()', () => {
    it('sends POST to /org-admin/employees with the request body', () => {
      const body = {
        first_name: 'Jane',
        last_name: 'Smith',
        email: 'jane@acme.com',
        temp_password: 'Temp@1234',
        manager_id: 'mgr-123',
      };

      service.create(body).subscribe((result) => {
        expect(result).toEqual(mockEmployee);
      });

      const req = httpMock.expectOne(API_BASE);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(body);
      req.flush(mockEmployee);
    });
  });

  describe('update()', () => {
    it('sends PUT to /org-admin/employees/{employeeId} with the request body', () => {
      const body = { first_name: 'Janet' };
      const updated = { ...mockEmployee, first_name: 'Janet' };

      service.update('emp-123', body).subscribe((result) => {
        expect(result).toEqual(updated);
      });

      const req = httpMock.expectOne(`${API_BASE}/emp-123`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(body);
      req.flush(updated);
    });

    // The edit modal sends '' to unassign a manager; the contract allows it.
    it('sends an empty manager_id through unchanged to clear the assignment', () => {
      service.update('emp-123', { manager_id: '' }).subscribe();

      const req = httpMock.expectOne(`${API_BASE}/emp-123`);
      expect(req.request.body).toEqual({ manager_id: '' });
      req.flush(mockEmployee);
    });
  });

  describe('disable()', () => {
    it('sends DELETE to /org-admin/employees/{employeeId}', () => {
      service.disable('emp-123').subscribe();

      const req = httpMock.expectOne(`${API_BASE}/emp-123`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });
  });

  describe('enable()', () => {
    it('sends PATCH to /org-admin/employees/{employeeId} with an empty body', () => {
      service.enable('emp-123').subscribe();

      const req = httpMock.expectOne(`${API_BASE}/emp-123`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({});
      req.flush(null, { status: 204, statusText: 'No Content' });
    });
  });
});
