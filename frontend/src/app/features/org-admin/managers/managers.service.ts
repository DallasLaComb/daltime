import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type OrgAdminManagerResponse = ApiSchema<'OrgAdminManagerResponse'>;
export type CreateManagerBody = ApiSchema<'CreateManagerBody'>;
export type UpdateManagerBody = ApiSchema<'UpdateManagerBody'>;

@Injectable({ providedIn: 'root' })
export class ManagersService {
  private readonly api = inject(ApiClient);

  getAll(): Observable<OrgAdminManagerResponse[]> {
    return this.api.get('/org-admin/managers');
  }

  create(body: CreateManagerBody): Observable<OrgAdminManagerResponse> {
    return this.api.post('/org-admin/managers', body);
  }

  update(managerId: string, body: UpdateManagerBody): Observable<OrgAdminManagerResponse> {
    return this.api.put('/org-admin/managers/{managerId}', body, { params: { managerId } });
  }

  disable(managerId: string): Observable<void> {
    return this.api.delete('/org-admin/managers/{managerId}', { params: { managerId } });
  }

  /** PATCH re-enables a disabled manager. The contract defines no body for it. */
  enable(managerId: string): Observable<void> {
    return this.api.patch('/org-admin/managers/{managerId}', {}, { params: { managerId } });
  }
}
