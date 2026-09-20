import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type ManagerShift = ApiSchema<'ManagerShiftResponse'>;
export type CreateManagerShiftBody = ApiSchema<'CreateManagerShiftBody'>;
export type UpdateManagerShiftBody = ApiSchema<'UpdateManagerShiftBody'>;

@Injectable({ providedIn: 'root' })
export class ManagerShiftsService {
  private readonly api = inject(ApiClient);

  list(month: string): Observable<ManagerShift[]> {
    return this.api.get('/manager/shifts', { query: { month } });
  }

  create(body: CreateManagerShiftBody): Observable<ManagerShift> {
    return this.api.post('/manager/shifts', body);
  }

  update(shiftId: string, body: UpdateManagerShiftBody): Observable<ManagerShift> {
    return this.api.put('/manager/shifts/{shiftId}', body, { params: { shiftId } });
  }

  remove(shiftId: string): Observable<void> {
    return this.api.delete('/manager/shifts/{shiftId}', { params: { shiftId } });
  }
}
