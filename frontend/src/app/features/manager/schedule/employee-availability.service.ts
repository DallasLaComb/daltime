import { Injectable, inject } from '@angular/core';
import { forkJoin, from, of, type Observable } from 'rxjs';
import { catchError, map, mergeMap, toArray } from 'rxjs/operators';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

export type ManagerEmployeeAvailability = ApiSchema<'ManagerEmployeeAvailabilityResponse'>;
export type ManagerEmployeeAvailabilityOverrides = ApiSchema<
  'ManagerEmployeeAvailabilityOverridesResponse'
>;

export interface EmployeeAvailabilityBundle {
  employeeId: string;
  availability: ManagerEmployeeAvailability | null;
  overrides: ManagerEmployeeAvailabilityOverrides | null;
}

@Injectable({ providedIn: 'root' })
export class ManagerEmployeeAvailabilityService {
  private readonly api = inject(ApiClient);

  getAvailability(employeeId: string): Observable<ManagerEmployeeAvailability | null> {
    return this.api
      .get('/manager/employees/{employeeId}/availability', { params: { employeeId } })
      .pipe(catchError(() => of(null)));
  }

  getOverrides(employeeId: string): Observable<ManagerEmployeeAvailabilityOverrides | null> {
    return this.api
      .get('/manager/employees/{employeeId}/availability/overrides', { params: { employeeId } })
      .pipe(catchError(() => of(null)));
  }

  /**
   * Fetches availability + overrides for every employee in the list, but caps
   * the number of in-flight employees at 3 at a time. Without this cap the old
   * forkJoin pattern fires one Lambda per employee simultaneously (~30 concurrent
   * requests), which exhausts the account's Lambda concurrency budget and causes
   * 503s. The inner forkJoin for each employee still fires both requests
   * (availability and overrides) concurrently — only the outer fan-out is throttled.
   */
  getAllBundles(employeeIds: string[]): Observable<Map<string, EmployeeAvailabilityBundle>> {
    if (employeeIds.length === 0) return of(new Map());
    return from(employeeIds).pipe(
      // Concurrency limit of 3: at most 3 employees' requests are in-flight at once.
      mergeMap(
        (id) =>
          forkJoin({
            availability: this.getAvailability(id),
            overrides: this.getOverrides(id),
          }).pipe(map((r) => ({ employeeId: id, ...r }))),
        3,
      ),
      toArray(),
      map((bundles) => {
        const m = new Map<string, EmployeeAvailabilityBundle>();
        for (const b of bundles) m.set(b.employeeId, b);
        return m;
      }),
    );
  }
}
