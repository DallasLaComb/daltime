import { randomUUID } from 'node:crypto';
import { stripKeys } from '../../shared/dynamo.js';
import {
  ForbiddenError,
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../../shared/errors.js';
import { putNotification } from '../../shared/notifications/db.js';
import type { NotificationRecord, SwapShiftApiFields, SwapShiftRecord } from '@daltime/contracts';
import * as db from './db.js';

/**
 * Shift ID input validation: must be a non-empty UUID-shaped string.
 * We restrict to alphanumeric + hyphens (UUID character set) to prevent
 * injection into DynamoDB key expressions.
 */
const SHIFT_ID_REGEX = /^[a-zA-Z0-9\-]{1,128}$/;

/**
 * Swap ID path parameter validation: same character set as shift_id.
 */
const SWAP_ID_REGEX = /^[a-zA-Z0-9\-]{1,128}$/;

/**
 * Validate a shift_id value from a POST body.
 * Throws ValidationError with a clear message if the value is missing or
 * contains characters outside the allowed set.
 */
function validateShiftId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ValidationError('shift_id is required and must be a non-empty string');
  }
  const trimmed = raw.trim();
  if (!SHIFT_ID_REGEX.test(trimmed)) {
    throw new ValidationError(
      'shift_id must contain only alphanumeric characters and hyphens (max 128 chars)',
    );
  }
  return trimmed;
}

/**
 * Validate a swapId path parameter.
 * Throws ValidationError with a clear message if it is missing or malformed.
 */
function validateSwapId(raw: string | undefined): string {
  if (!raw || raw.trim().length === 0) {
    throw new ValidationError('swapId path parameter is required');
  }
  const trimmed = raw.trim();
  if (!SWAP_ID_REGEX.test(trimmed)) {
    throw new ValidationError(
      'swapId must contain only alphanumeric characters and hyphens (max 128 chars)',
    );
  }
  return trimmed;
}

/**
 * Resolve the caller's org context and full name from their Cognito sub.
 * Reads the USER#<sub>/METADATA reverse-lookup record which contains the
 * employee's org_id, employee_id, first_name, and last_name.
 * Throws ForbiddenError if the record is missing — a valid JWT without a
 * provisioned record must not reach DynamoDB data.
 */
async function resolveCallerEmployee(sub: string): Promise<{
  org_id: string;
  employee_id: string;
  first_name: string;
  last_name: string;
}> {
  const lookup = await db.getCallerLookup(sub);
  if (!lookup) throw new ForbiddenError('Caller could not be resolved');
  return lookup;
}

/**
 * Build a manager notification record for writing via putNotification.
 * The notification SK follows the NOTIFICATION#<created_at>#<rawId> pattern
 * established by the existing notification infrastructure.
 */
function buildNotification(managerId: string, message: string): NotificationRecord {
  const now = new Date().toISOString();
  const rawId = randomUUID();
  return {
    PK: `USER#${managerId}`,
    SK: `NOTIFICATION#${now}#${rawId}`,
    notification_id: `${now}#${rawId}`,
    recipient_sub: managerId,
    type: 'SHIFT',
    message,
    read: false,
    created_at: now,
  };
}

/**
 * Attempt to write a manager notification without coupling to the primary
 * operation. If the write fails (e.g. DynamoDB blip), the error is logged
 * and swallowed so the employee's 200 response is not affected.
 */
async function tryNotifyManager(managerId: string, message: string): Promise<void> {
  try {
    await putNotification(buildNotification(managerId, message));
  } catch (err) {
    // Log and continue — notification failures must never fail the primary response.
    console.error('[swap-shifts] manager notification write failed:', err);
  }
}

/**
 * GET /employee/swap-shifts
 *
 * Returns all open swap listings for the caller's org, excluding listings
 * posted by the caller (those are in the "My Posted Shifts" panel).
 * Also returns the caller's own posted listings (all statuses) in a separate
 * "mine" array so the UI can show both panels from one request.
 */
export async function listSwapShifts(callerSub: string): Promise<{
  available: SwapShiftApiFields[];
  mine: SwapShiftApiFields[];
}> {
  const { org_id, employee_id } = await resolveCallerEmployee(callerSub);

  const [available, mine] = await Promise.all([
    db.listOpenSwapsForOrg(org_id, employee_id),
    db.listMyPostedSwaps(org_id, employee_id),
  ]);

  return {
    available: available.map((s) => stripKeys(s)),
    mine: mine.map((s) => stripKeys(s)),
  };
}

/**
 * POST /employee/swap-shifts
 *
 * Posts one of the caller's published shifts for swap. Validates:
 * - shift exists within the caller's org
 * - shift belongs to the caller
 * - shift is published (not draft)
 * - shift date is in the future (can't swap a past shift)
 * - no open swap already exists for this shift (duplicate guard)
 *
 * Reads the full EMPLOYEE# record to get manager_id, which is denormalized
 * onto the SWAP# record so the claim handler can notify without a second fetch.
 *
 * After creating the record, writes a manager notification (non-blocking).
 */
export async function postSwapShift(
  callerSub: string,
  body: Record<string, unknown>,
): Promise<SwapShiftApiFields> {
  const shiftId = validateShiftId(body['shift_id']);

  const { org_id, employee_id, first_name, last_name } = await resolveCallerEmployee(callerSub);
  const employeeName = `${first_name} ${last_name}`;

  // Fetch the shift and validate it belongs to the caller and is postable.
  const shift = await db.getShiftById(org_id, shiftId);
  if (!shift) throw new NotFoundError('Shift not found');
  if (shift.employee_id !== employee_id) {
    throw new ForbiddenError('You can only post your own shifts for swap');
  }
  if (shift.status !== 'published') {
    throw new ValidationError('Only published shifts can be posted for swap');
  }

  // Reject past shifts — employees cannot post for swap something that already happened.
  const today = new Date().toISOString().slice(0, 10);
  if (shift.date < today) {
    throw new ValidationError('Cannot post a past shift for swap');
  }

  // Duplicate-post guard: query for any existing open swap for the same shift.
  const existing = await db.findOpenSwapForShift(org_id, shiftId, employee_id);
  if (existing) {
    throw new ConflictError('This shift is already posted for swap');
  }

  // Read the EMPLOYEE# primary record to get the manager_id for notifications.
  // manager_id is not stored on the METADATA reverse-lookup record, so we need
  // the full record here. We denormalize it onto the SWAP# item so the claim
  // handler does not need an extra fetch.
  const employeeRecord = await db.getEmployeeByIdInOrg(org_id, employee_id);
  if (!employeeRecord) {
    // Belt-and-suspenders: METADATA exists (resolveCallerEmployee passed) but
    // the primary EMPLOYEE# record is missing. This should never happen in
    // normal operation but we fail closed rather than writing a record with
    // no manager_id (which would make notifications silently fail forever).
    throw new ForbiddenError('Employee record not found');
  }

  const now = new Date().toISOString();
  const swapId = randomUUID();

  const swap: SwapShiftRecord = {
    PK: `ORG#${org_id}`,
    SK: `SWAP#${swapId}`,
    GSI1PK: `ORG_SWAP#${org_id}`,
    GSI1SK: `STATUS#open#${now}`,
    swap_id: swapId,
    org_id,
    shift_id: shiftId,
    posted_by_employee_id: employee_id,
    posted_by_employee_name: employeeName,
    manager_id: employeeRecord.manager_id,
    status: 'open',
    claimed_by_employee_id: null,
    claimed_by_employee_name: null,
    date: shift.date,
    start_time: shift.start_time,
    end_time: shift.end_time,
    type: shift.type,
    location_id: shift.location_id,
    location_name: shift.location_name,
    created_at: now,
    updated_at: now,
  };

  await db.putSwap(swap);

  // Notify manager after the primary write — non-blocking, failure is logged only.
  const message = `${employeeName} has put ${shift.date} ${shift.start_time}–${shift.end_time} up for swap`;
  void tryNotifyManager(employeeRecord.manager_id, message);

  return stripKeys(swap);
}

/**
 * POST /employee/swap-shifts/{swapId}/claim
 *
 * Claims an open swap listing and transfers the shift to the claimer.
 * Validates:
 * - swap listing exists within the caller's org
 * - listing is still open (not already claimed or cancelled)
 * - caller is NOT the original poster (cannot claim your own listing)
 *
 * Updates SWAP# status to 'claimed' and transfers SHIFT# employee ownership,
 * both in parallel. Writes a manager notification (non-blocking) after success.
 */
export async function claimSwapShift(
  callerSub: string,
  swapId: string,
): Promise<SwapShiftApiFields> {
  const validSwapId = validateSwapId(swapId);

  const { org_id, employee_id, first_name, last_name } = await resolveCallerEmployee(callerSub);
  const claimerName = `${first_name} ${last_name}`;

  const swap = await db.getSwapById(org_id, validSwapId);
  if (!swap) throw new NotFoundError('Swap listing not found');

  if (swap.posted_by_employee_id === employee_id) {
    throw new ForbiddenError('You cannot claim your own swap listing');
  }

  if (swap.status !== 'open') {
    throw new ConflictError('This swap listing is no longer available');
  }

  try {
    await db.claimSwapAndTransferShift(org_id, validSwapId, swap.shift_id, swap.created_at, {
      employee_id,
      employee_name: claimerName,
    });
  } catch (err: unknown) {
    // DynamoDB throws ConditionalCheckFailedException when a concurrent claim
    // already updated the status away from 'open' between our read and write.
    // Surface this as a 409 Conflict so the client shows the right error message.
    const name = err instanceof Error ? (err as Error & { name: string }).name : '';
    if (name === 'ConditionalCheckFailedException') {
      throw new ConflictError('This swap listing is no longer available');
    }
    throw err;
  }

  // Build the updated swap shape to return without re-fetching from DynamoDB.
  const updatedSwap: SwapShiftRecord = {
    ...swap,
    status: 'claimed',
    GSI1SK: `STATUS#claimed#${swap.created_at}`,
    claimed_by_employee_id: employee_id,
    claimed_by_employee_name: claimerName,
    updated_at: new Date().toISOString(),
  };

  // Notify manager after both writes succeed — non-blocking, failure is logged only.
  const message = `${claimerName} has taken ${swap.posted_by_employee_name}'s shift on ${swap.date} ${swap.start_time}–${swap.end_time}`;
  void tryNotifyManager(swap.manager_id, message);

  return stripKeys(updatedSwap);
}

/**
 * DELETE /employee/swap-shifts/{swapId}
 *
 * Cancels (unposting) a swap listing. The record is NOT deleted — it is
 * updated to status='cancelled' so audit history is preserved and the item
 * drops out of the "Available to Take" GSI query automatically.
 * Validates:
 * - swap listing exists within the caller's org
 * - caller IS the original poster (only the poster can cancel)
 * - listing is still open (cannot cancel an already-claimed or cancelled listing)
 */
export async function cancelSwapShift(callerSub: string, swapId: string): Promise<void> {
  const validSwapId = validateSwapId(swapId);

  const { org_id, employee_id } = await resolveCallerEmployee(callerSub);

  const swap = await db.getSwapById(org_id, validSwapId);
  if (!swap) throw new NotFoundError('Swap listing not found');

  if (swap.posted_by_employee_id !== employee_id) {
    throw new ForbiddenError('You can only cancel your own swap listings');
  }

  if (swap.status !== 'open') {
    throw new ConflictError('This swap listing is no longer open and cannot be cancelled');
  }

  await db.cancelSwap(org_id, validSwapId, swap.created_at);
}
