import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type ManagerEmployeeResponse = ApiSchema<'ManagerEmployeeResponse'>;
export type CreateManagerEmployeeBody = ApiSchema<'CreateManagerEmployeeBody'>;
export type UpdateManagerEmployeeBody = ApiSchema<'UpdateManagerEmployeeBody'>;

@Injectable({ providedIn: 'root' })
export class ManagerEmployeesService {
  private readonly api = inject(ApiClient);

  getAll(): Observable<ManagerEmployeeResponse[]> {
    return this.api.get('/manager/employees');
  }

  create(body: CreateManagerEmployeeBody): Observable<ManagerEmployeeResponse> {
    return this.api.post('/manager/employees', body);
  }

  update(
    employeeId: string,
    body: UpdateManagerEmployeeBody,
  ): Observable<ManagerEmployeeResponse> {
    return this.api.put('/manager/employees/{employeeId}', body, { params: { employeeId } });
  }

  disable(employeeId: string): Observable<void> {
    return this.api.delete('/manager/employees/{employeeId}', { params: { employeeId } });
  }

  enable(employeeId: string): Observable<void> {
    return this.api.patch('/manager/employees/{employeeId}', {}, { params: { employeeId } });
  }
}
