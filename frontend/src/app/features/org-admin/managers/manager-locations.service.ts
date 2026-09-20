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
export class ManagerLocationsService {
  private readonly api = inject(ApiClient);

  getAll(managerId: string): Observable<UserLocationResponse[]> {
    return this.api.get('/org-admin/managers/{managerId}/locations', { params: { managerId } });
  }

  assign(managerId: string, locationId: string): Observable<UserLocationResponse> {
    return this.api.post(
      '/org-admin/managers/{managerId}/locations',
      { location_id: locationId },
      { params: { managerId } },
    );
  }

  remove(managerId: string, locationId: string): Observable<void> {
    return this.api.delete('/org-admin/managers/{managerId}/locations/{locationId}', {
      params: { managerId, locationId },
    });
  }
}
