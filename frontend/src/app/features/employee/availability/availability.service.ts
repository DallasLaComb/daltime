import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates against.
 *
 * The response types are fully optional because both GET routes answer `{}`
 * (not 404) for an employee who has never saved a schedule or an override; the
 * contract models that rather than pretending the fields are always present.
 */
export type EmployeeAvailabilityResponse = ApiSchema<'EmployeeAvailabilityResponse'>;
export type EmployeeAvailabilityOverridesResponse =
  ApiSchema<'EmployeeAvailabilityOverridesResponse'>;
export type WeeklySchedule = ApiSchema<'WeeklySchedule'>;
export type DateOverrides = ApiSchema<'DateOverrides'>;
export type DayAvailability = ApiSchema<'DayAvailability'>;
export type TimeSlot = ApiSchema<'TimeSlot'>;
export type DayOfWeek = ApiSchema<'DayOfWeek'>;

@Injectable({ providedIn: 'root' })
export class EmployeeAvailabilityService {
  private readonly api = inject(ApiClient);

  get(): Observable<EmployeeAvailabilityResponse> {
    return this.api.get('/employee/availability');
  }

  save(schedule: WeeklySchedule): Observable<EmployeeAvailabilityResponse> {
    return this.api.put('/employee/availability', { schedule });
  }

  getOverrides(): Observable<EmployeeAvailabilityOverridesResponse> {
    return this.api.get('/employee/availability/overrides');
  }

  saveOverrides(overrides: DateOverrides): Observable<EmployeeAvailabilityOverridesResponse> {
    return this.api.put('/employee/availability/overrides', { overrides });
  }
}
