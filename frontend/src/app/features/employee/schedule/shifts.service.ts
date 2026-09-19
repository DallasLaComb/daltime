import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Request/response types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend serves. A field
 * renamed in the contract breaks this file at compile time rather than at
 * runtime in the browser.
 */
export type EmployeeShiftsResponse = ApiSchema<'EmployeeShiftsResponse'>;
export type AvailableShiftsResponse = ApiSchema<'AvailableShiftsResponse'>;

@Injectable({ providedIn: 'root' })
export class EmployeeShiftsService {
  private readonly api = inject(ApiClient);

  /**
   * Fetches all of the caller's shifts for a full calendar month.
   * Used by month view. Calls GET /employee/shifts?month=YYYY-MM.
   */
  listByMonth(month: string): Observable<EmployeeShiftsResponse> {
    return this.api.get('/employee/shifts', { query: { month } });
  }

  /**
   * Fetches all of the caller's shifts for a single day.
   * Used by day view. Calls GET /employee/shifts?date=YYYY-MM-DD.
   */
  listByDate(date: string): Observable<EmployeeShiftsResponse> {
    return this.api.get('/employee/shifts', { query: { date } });
  }

  /**
   * Fetches all of the caller's shifts for a 7-day window starting on weekStart.
   * Used by week view. Calls GET /employee/shifts?week=YYYY-MM-DD.
   */
  listByWeek(weekStart: string): Observable<EmployeeShiftsResponse> {
    return this.api.get('/employee/shifts', { query: { week: weekStart } });
  }

  /**
   * Fetches shifts from other employees in the same org that are available for pickup on a date.
   * Used by day view's "Available from coworkers" section.
   * Calls GET /employee/available-shifts?date=YYYY-MM-DD.
   * Returns empty array (never 404) when no available shifts exist.
   */
  listAvailableShifts(date: string): Observable<AvailableShiftsResponse> {
    return this.api.get('/employee/available-shifts', { query: { date } });
  }
}
