import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type UserLocationResponse = ApiSchema<'UserLocationResponse'>;
export type AssignUserLocationBody = ApiSchema<'AssignUserLocationBody'>;

@Injectable({ providedIn: 'root' })
export class EmployeeLocationsService {
  private readonly api = inject(ApiClient);

  getAll(employeeId: string): Observable<UserLocationResponse[]> {
    return this.api.get('/org-admin/employees/{employeeId}/locations', { params: { employeeId } });
  }

  assign(employeeId: string, locationId: string): Observable<UserLocationResponse> {
    return this.api.post(
      '/org-admin/employees/{employeeId}/locations',
      { location_id: locationId },
      { params: { employeeId } },
    );
  }

  remove(employeeId: string, locationId: string): Observable<void> {
    return this.api.delete('/org-admin/employees/{employeeId}/locations/{locationId}', {
      params: { employeeId, locationId },
    });
  }
}
