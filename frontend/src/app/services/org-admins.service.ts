import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type WebAdminOrgAdmin = ApiSchema<'WebAdminOrgAdminResponse'>;
export type CreateOrgAdminBody = ApiSchema<'CreateOrgAdminBody'>;
/** Back-compat alias for the former hand-written OrgAdminUserResponse model name. */
export type OrgAdminUserResponse = WebAdminOrgAdmin;

@Injectable({ providedIn: 'root' })
export class OrgAdminsService {
  private readonly api = inject(ApiClient);

  getAll(orgId: string): Observable<WebAdminOrgAdmin[]> {
    return this.api.get('/web-admin/organizations/{orgId}/org-admins', { params: { orgId } });
  }

  create(orgId: string, body: CreateOrgAdminBody): Observable<WebAdminOrgAdmin> {
    return this.api.post('/web-admin/organizations/{orgId}/org-admins', body, { params: { orgId } });
  }

  disable(orgId: string, userId: string): Observable<void> {
    return this.api.delete('/web-admin/organizations/{orgId}/org-admins/{userId}', {
      params: { orgId, userId },
    });
  }

  enable(orgId: string, userId: string): Observable<void> {
    return this.api.patch('/web-admin/organizations/{orgId}/org-admins/{userId}', {}, {
      params: { orgId, userId },
    });
  }
}
