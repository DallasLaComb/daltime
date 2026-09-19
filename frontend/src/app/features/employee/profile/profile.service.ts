import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type EmployeeProfileResponse = ApiSchema<'EmployeeProfileResponse'>;
export type UpdateEmployeeProfileBody = ApiSchema<'UpdateEmployeeProfileBody'>;

@Injectable({ providedIn: 'root' })
export class EmployeeProfileService {
  private readonly api = inject(ApiClient);

  get(): Observable<EmployeeProfileResponse> {
    return this.api.get('/employee/profile');
  }

  update(body: UpdateEmployeeProfileBody): Observable<EmployeeProfileResponse> {
    return this.api.put('/employee/profile', body);
  }
}
