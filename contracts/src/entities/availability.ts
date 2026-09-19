import * as z from 'zod';
import { IsoTimestamp } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';
import { TimeOfDay } from './shift.js';

/** Days of the week, as stored in the weekly schedule map. */
export const DayOfWeek = z
  .enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
  .meta({ id: 'DayOfWeek' });

/** A single availability window within a day. */
export const TimeSlot = z
  .object({ from: TimeOfDay, to: TimeOfDay })
  .meta({ id: 'TimeSlot', description: 'One availability window, HH:MM–HH:MM.' });

/** Availability for one day: whether the employee is free, and within which windows. */
export const DayAvailability = z
  .object({
    available: z.boolean(),
    slots: z
      .array(TimeSlot)
      .optional()
      .meta({ description: 'One or more windows. Required when `available` is true.' }),
    max_shifts: z.int().positive().optional().meta({
      description: 'How many shifts the employee will work that day. 1 ≤ max_shifts ≤ slots.length.',
    }),
  })
  .meta({ id: 'DayAvailability', description: "One day's availability." });

/** The recurring weekly pattern — every day of the week is present. */
export const WeeklySchedule = z
  .record(DayOfWeek, DayAvailability)
  .meta({ id: 'WeeklySchedule', description: 'Recurring weekly availability, keyed by weekday.' });

/**
 * One-off overrides that take precedence over the weekly pattern, keyed by
 * ISO date (`YYYY-MM-DD`).
 *
 * The key pattern mirrors `ISO_DATE_RE` in
 * `backend/src/functions/employee/availability-overrides/service.ts` exactly —
 * month `01`–`12` and day `01`–`31`, not a loose `\d{2}-\d{2}`. A looser
 * contract would have advertised `2026-13-99` as an acceptable key while the
 * service rejects it with a 400.
 */
export const DateOverrides = z
  .record(z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/), DayAvailability)
  .meta({
    id: 'DateOverrides',
    description: 'Per-date availability overrides, keyed by YYYY-MM-DD.',
  });

/**
 * Recurring weekly availability record. Replaces the `EmployeeAvailability`
 * half of `shared/models/employee/availability.model.ts`.
 *
 *   PK = USER#<employee_id>
 *   SK = AVAILABILITY
 *
 * One record per employee — reads and writes are always point operations.
 */
export const EmployeeAvailabilityRecord = SingleTableKeys.extend({
  employee_id: z.string(),
  org_id: z.string(),
  schedule: WeeklySchedule,
  updated_at: IsoTimestamp,
});

export const EmployeeAvailabilityApiFields = apiShapeOf(EmployeeAvailabilityRecord);

/**
 * Date-specific availability overrides record. Replaces the
 * `EmployeeAvailabilityOverrides` half of the same model file.
 *
 *   PK = USER#<employee_id>
 *   SK = AVAILABILITY_OVERRIDES
 */
export const EmployeeAvailabilityOverridesRecord = SingleTableKeys.extend({
  employee_id: z.string(),
  org_id: z.string(),
  overrides: DateOverrides,
  updated_at: IsoTimestamp,
});

export const EmployeeAvailabilityOverridesApiFields = apiShapeOf(
  EmployeeAvailabilityOverridesRecord,
);

export type DayOfWeek = z.infer<typeof DayOfWeek>;
export type TimeSlot = z.infer<typeof TimeSlot>;
export type DayAvailability = z.infer<typeof DayAvailability>;
export type WeeklySchedule = z.infer<typeof WeeklySchedule>;
export type DateOverrides = z.infer<typeof DateOverrides>;
export type EmployeeAvailabilityRecord = z.infer<typeof EmployeeAvailabilityRecord>;
export type EmployeeAvailabilityApiFields = z.infer<typeof EmployeeAvailabilityApiFields>;
export type EmployeeAvailabilityOverridesRecord = z.infer<
  typeof EmployeeAvailabilityOverridesRecord
>;
export type EmployeeAvailabilityOverridesApiFields = z.infer<
  typeof EmployeeAvailabilityOverridesApiFields
>;
