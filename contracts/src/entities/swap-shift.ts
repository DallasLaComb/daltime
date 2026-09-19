import * as z from 'zod';
import { IsoTimestamp } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';
import { DateOnly, ShiftType, TimeOfDay } from './shift.js';

/** Status values a swap listing moves through across its lifecycle. */
export const SwapStatus = z
  .enum(['open', 'claimed', 'cancelled'])
  .meta({ id: 'SwapStatus', description: 'Lifecycle status of a shift swap listing.' });

/**
 * Shift swap listing stored in DynamoDB. Replaces
 * `backend/src/functions/shared/models/employee/swap-shift.model.ts`.
 *
 *   PK     = ORG#<org_id>
 *   SK     = SWAP#<swap_id>
 *   GSI1PK = ORG_SWAP#<org_id>
 *   GSI1SK = STATUS#<status>#<created_at>
 *
 * Shift details are denormalized onto the listing so the board renders without
 * a second read per row, and `manager_id` is captured at post time so a claim
 * can notify the manager without fetching the shift again.
 */
export const SwapShiftRecord = SingleTableKeys.extend({
  swap_id: z.string(),
  org_id: z.string(),
  shift_id: z.string(),
  posted_by_employee_id: z.string(),
  posted_by_employee_name: z.string(),
  manager_id: z.string().meta({
    description: "Manager's Cognito sub, denormalized at post time so claim can notify directly.",
  }),
  status: SwapStatus,
  claimed_by_employee_id: z
    .string()
    .nullable()
    .meta({ description: 'Cognito sub of the claiming employee; null until claimed.' }),
  claimed_by_employee_name: z
    .string()
    .nullable()
    .meta({ description: 'Full name of the claiming employee; null until claimed.' }),
  date: DateOnly,
  start_time: TimeOfDay,
  end_time: TimeOfDay,
  type: ShiftType,
  location_id: z.string(),
  location_name: z.string(),
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
});

export const SwapShiftApiFields = apiShapeOf(SwapShiftRecord);

export type SwapStatus = z.infer<typeof SwapStatus>;
export type SwapShiftRecord = z.infer<typeof SwapShiftRecord>;
export type SwapShiftApiFields = z.infer<typeof SwapShiftApiFields>;
