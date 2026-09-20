import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type WebAdminOrganization = ApiSchema<'WebAdminOrganizationResponse'>;
export type CreateOrganizationBody = ApiSchema<'CreateOrganizationBody'>;
export type UpdateOrganizationBody = ApiSchema<'UpdateOrganizationBody'>;

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  private readonly api = inject(ApiClient);

  getAll(): Observable<WebAdminOrganization[]> {
    return this.api.get('/organizations');
  }

  getById(orgId: string): Observable<WebAdminOrganization> {
    return this.api.get('/organizations/{orgId}', { params: { orgId } });
  }

  create(body: CreateOrganizationBody): Observable<WebAdminOrganization> {
    return this.api.post('/organizations', body);
  }

  update(orgId: string, body: UpdateOrganizationBody): Observable<WebAdminOrganization> {
    return this.api.put('/organizations/{orgId}', body, { params: { orgId } });
  }

  delete(orgId: string): Observable<void> {
    return this.api.delete('/organizations/{orgId}', { params: { orgId } });
  }
}
