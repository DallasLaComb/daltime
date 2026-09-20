import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 * A field renamed in the contract breaks this file at compile time instead of
 * at runtime in the browser.
 */
export type ManagerShiftNeeded = ApiSchema<'ManagerShiftNeededResponse'>;
export type CreateManagerShiftNeededBody = ApiSchema<'CreateManagerShiftNeededBody'>;
export type UpdateManagerShiftNeededBody = ApiSchema<'UpdateManagerShiftNeededBody'>;

@Injectable({ providedIn: 'root' })
export class ManagerShiftsNeededService {
  private readonly api = inject(ApiClient);

  list(month: string): Observable<ManagerShiftNeeded[]> {
    return this.api.get('/manager/shifts-needed', { query: { month } });
  }

  create(body: CreateManagerShiftNeededBody): Observable<ManagerShiftNeeded> {
    return this.api.post('/manager/shifts-needed', body);
  }

  update(shiftId: string, body: UpdateManagerShiftNeededBody): Observable<ManagerShiftNeeded> {
    return this.api.put('/manager/shifts-needed/{shiftId}', body, { params: { shiftId } });
  }

  remove(shiftId: string): Observable<void> {
    return this.api.delete('/manager/shifts-needed/{shiftId}', { params: { shiftId } });
  }
}
