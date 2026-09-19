import * as z from 'zod';
import { IsoTimestamp } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';

/** Time-of-day band a shift falls into. */
export const ShiftType = z
  .enum(['morning', 'afternoon', 'night'])
  .meta({ id: 'ShiftType', description: 'Time-of-day band a shift falls into.' });

/**
 * Shift lifecycle status.
 *
 * `draft_failed` marks an unfillable slot sentinel written during draft
 * generation — it is a real stored value, not an error condition.
 */
export const ShiftStatus = z
  .enum(['draft', 'published', 'draft_failed'])
  .meta({ id: 'ShiftStatus', description: 'Shift lifecycle status.' });

/** Calendar date, `YYYY-MM-DD`. */
export const DateOnly = z
  .iso
  .date()
  .meta({ description: 'Calendar date, YYYY-MM-DD.', example: '2026-05-27' });

/** Wall-clock time, `HH:MM` 24-hour. */
export const TimeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .meta({ description: 'Wall-clock time, HH:MM 24-hour.', example: '09:00' });

/**
 * Assigned shift record stored in DynamoDB. Replaces
 * `backend/src/functions/shared/models/manager/shift.model.ts`.
 *
 *   PK     = ORG#<org_id>
 *   SK     = SHIFT#<shift_id>
 *   GSI1PK = ORG_SHIFT#<org_id>
 *   GSI1SK = <date>#<shift_id>
 */
export const ShiftRecord = SingleTableKeys.extend({
  shift_id: z.string(),
  org_id: z.string(),
  manager_id: z.string(),
  employee_id: z.string(),
  employee_name: z.string().meta({ description: 'Denormalized at assignment time.' }),
  location_id: z.string(),
  location_name: z.string().meta({ description: 'Denormalized at assignment time.' }),
  date: DateOnly,
  start_time: TimeOfDay,
  end_time: TimeOfDay,
  type: ShiftType,
  status: ShiftStatus,
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
  available_for_pickup: z.boolean().optional().meta({
    description: 'True when the assigned employee has offered this shift for pickup by peers.',
  }),
});

export const ShiftApiFields = apiShapeOf(ShiftRecord);

/**
 * An unfilled staffing need posted by a manager. Replaces
 * `shared/models/manager/shift-needed.model.ts`.
 *
 *   PK     = ORG#<org_id>
 *   SK     = SHIFT_NEEDED#<shift_id>
 *   GSI1PK = ORG_SHIFT_NEEDED#<org_id>
 *   GSI1SK = <date>#<shift_id>
 */
export const ShiftNeededRecord = SingleTableKeys.extend({
  shift_id: z.string(),
  org_id: z.string(),
  manager_id: z.string(),
  date: DateOnly,
  start_time: TimeOfDay,
  end_time: TimeOfDay,
  employee_count: z.int().positive().meta({ description: 'How many employees are needed.' }),
  location_id: z.string(),
  location_name: z.string(),
  notes: z.string().optional(),
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
});

export const ShiftNeededApiFields = apiShapeOf(ShiftNeededRecord);

export type ShiftType = z.infer<typeof ShiftType>;
export type ShiftStatus = z.infer<typeof ShiftStatus>;
export type ShiftRecord = z.infer<typeof ShiftRecord>;
export type ShiftApiFields = z.infer<typeof ShiftApiFields>;
export type ShiftNeededRecord = z.infer<typeof ShiftNeededRecord>;
export type ShiftNeededApiFields = z.infer<typeof ShiftNeededApiFields>;
