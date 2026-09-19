import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type ManagerProfileResponse = ApiSchema<'ManagerProfileResponse'>;
export type UpdateManagerProfileBody = ApiSchema<'UpdateManagerProfileBody'>;

@Injectable({ providedIn: 'root' })
export class ManagerProfileService {
  private readonly api = inject(ApiClient);

  get(): Observable<ManagerProfileResponse> {
    return this.api.get('/manager/profile');
  }

  update(body: UpdateManagerProfileBody): Observable<ManagerProfileResponse> {
    return this.api.put('/manager/profile', body);
  }
}
