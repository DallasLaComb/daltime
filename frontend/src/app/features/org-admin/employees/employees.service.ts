import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type OrgAdminEmployeeResponse = ApiSchema<'OrgAdminEmployeeResponse'>;
export type CreateEmployeeBody = ApiSchema<'CreateEmployeeBody'>;
export type UpdateEmployeeBody = ApiSchema<'UpdateEmployeeBody'>;

@Injectable({ providedIn: 'root' })
export class EmployeesService {
  private readonly api = inject(ApiClient);

  getAll(): Observable<OrgAdminEmployeeResponse[]> {
    return this.api.get('/org-admin/employees');
  }

  create(body: CreateEmployeeBody): Observable<OrgAdminEmployeeResponse> {
    return this.api.post('/org-admin/employees', body);
  }

  update(employeeId: string, body: UpdateEmployeeBody): Observable<OrgAdminEmployeeResponse> {
    return this.api.put('/org-admin/employees/{employeeId}', body, { params: { employeeId } });
  }

  disable(employeeId: string): Observable<void> {
    return this.api.delete('/org-admin/employees/{employeeId}', { params: { employeeId } });
  }

  /** PATCH re-enables a disabled employee. The contract defines no body for it. */
  enable(employeeId: string): Observable<void> {
    return this.api.patch('/org-admin/employees/{employeeId}', {}, { params: { employeeId } });
  }
}
