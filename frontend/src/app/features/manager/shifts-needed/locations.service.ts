import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type ManagerLocation = ApiSchema<'ManagerLocationResponse'>;

@Injectable({ providedIn: 'root' })
export class ManagerLocationsService {
  private readonly api = inject(ApiClient);

  list(): Observable<ManagerLocation[]> {
    return this.api.get('/manager/locations');
  }
}
