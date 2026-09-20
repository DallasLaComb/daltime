import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type OrgAdminLocation = ApiSchema<'OrgAdminLocationResponse'>;
export type CreateOrgAdminLocationBody = ApiSchema<'CreateOrgAdminLocationBody'>;
export type UpdateOrgAdminLocationBody = ApiSchema<'UpdateOrgAdminLocationBody'>;

@Injectable({ providedIn: 'root' })
export class OrgAdminLocationsService {
  private readonly api = inject(ApiClient);

  getAll(): Observable<OrgAdminLocation[]> {
    return this.api.get('/org-admin/locations');
  }

  create(body: CreateOrgAdminLocationBody): Observable<OrgAdminLocation> {
    return this.api.post('/org-admin/locations', body);
  }

  update(locationId: string, body: UpdateOrgAdminLocationBody): Observable<OrgAdminLocation> {
    return this.api.put('/org-admin/locations/{locationId}', body, { params: { locationId } });
  }

  remove(locationId: string): Observable<void> {
    return this.api.delete('/org-admin/locations/{locationId}', { params: { locationId } });
  }
}
