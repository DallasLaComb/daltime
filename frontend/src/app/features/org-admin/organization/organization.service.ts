import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type OrgAdminOrganizationResponse = ApiSchema<'OrgAdminOrganizationResponse'>;
export type UpdateOrgAdminOrganizationBody = ApiSchema<'UpdateOrgAdminOrganizationBody'>;

@Injectable({ providedIn: 'root' })
export class OrgAdminOrganizationService {
  private readonly api = inject(ApiClient);

  get(): Observable<OrgAdminOrganizationResponse> {
    return this.api.get('/org-admin/organization');
  }

  update(body: UpdateOrgAdminOrganizationBody): Observable<OrgAdminOrganizationResponse> {
    return this.api.put('/org-admin/organization', body);
  }
}
