import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 */
export type WebAdminEmployeeResponse = ApiSchema<'WebAdminEmployeeResponse'>;

@Injectable({ providedIn: 'root' })
export class WebAdminEmployeesService {
  private readonly api = inject(ApiClient);

  getAll(): Observable<WebAdminEmployeeResponse[]> {
    return this.api.get('/web-admin/employees');
  }
}
