import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type OrgAdminShift = ApiSchema<'OrgAdminShiftResponse'>;

@Injectable({ providedIn: 'root' })
export class OrgAdminShiftsService {
  private readonly api = inject(ApiClient);

  list(month: string): Observable<OrgAdminShift[]> {
    return this.api.get('/org-admin/shifts', { query: { month } });
  }
}
