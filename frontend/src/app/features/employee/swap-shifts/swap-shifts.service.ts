import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiClient, type ApiSchema } from '../../../core/api/api-client';

/**
 * Types come from `contracts/openapi.json` via the generated
 * `core/generated/api.d.ts` — the same schemas the backend validates requests
 * against, so the two sides cannot drift apart silently.
 */
export type SwapShift = ApiSchema<'SwapShift'>;
export type SwapShiftsResponse = ApiSchema<'SwapShiftsListResponse'>;
export type PostSwapShiftBody = ApiSchema<'PostSwapShiftBody'>;

/** One shift from the caller's own month listing, used to populate the post picker. */
export type EmployeeShift = ApiSchema<'EmployeeShiftsResponse'>[number];

@Injectable({ providedIn: 'root' })
export class SwapShiftsService {
  private readonly api = inject(ApiClient);

  /**
   * Fetches both panels in one request.
   * GET /employee/swap-shifts returns { available, mine } so the UI doesn't
   * need two separate round-trips on page load.
   */
  list(): Observable<SwapShiftsResponse> {
    return this.api.get('/employee/swap-shifts');
  }

  /**
   * Posts one of the caller's own published shifts for swap.
   * POST /employee/swap-shifts → 201 with the created SwapShift record.
   * 409 means a listing for this shift already exists — caller should show a specific message.
   */
  postShift(shiftId: string): Observable<SwapShift> {
    const body: PostSwapShiftBody = { shift_id: shiftId };
    return this.api.post('/employee/swap-shifts', body);
  }

  /**
   * Claims an open swap listing, transferring the shift to the caller.
   * POST /employee/swap-shifts/{swapId}/claim → 200 with the updated SwapShift.
   * The contract declares no request body for this route — the swapId in the
   * path is the entire request — so none is sent.
   */
  claimShift(swapId: string): Observable<SwapShift> {
    return this.api.post('/employee/swap-shifts/{swapId}/claim', undefined, {
      params: { swapId },
    });
  }

  /**
   * Cancels an open listing the caller posted.
   * DELETE /employee/swap-shifts/{swapId} → 204 No Content.
   */
  cancelShift(swapId: string): Observable<void> {
    return this.api.delete('/employee/swap-shifts/{swapId}', { params: { swapId } });
  }

  /**
   * Fetches the caller's own shifts for the current month.
   * Used to populate the shift picker when an employee wants to post a shift for swap.
   * GET /employee/shifts?month=YYYY-MM.
   */
  listMyShiftsForMonth(month: string): Observable<EmployeeShift[]> {
    return this.api.get('/employee/shifts', { query: { month } });
  }
}
