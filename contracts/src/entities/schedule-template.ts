import * as z from 'zod';
import { IsoTimestamp } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';
import { TimeOfDay } from './shift.js';

/** Day-of-week key, Sunday-first, matching JavaScript's `Date.getDay()` index order. */
export const DayKey = z
  .enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
  .meta({ id: 'DayKey', description: 'Day-of-week abbreviation, Sunday-first.' });

/** One shift block inside a template: which days it covers and its staffing requirements. */
export const TemplateShiftBlock = z
  .object({
    days: z
      .array(DayKey)
      .min(1)
      .meta({ description: 'Days of the week this block applies to.' }),
    start_time: TimeOfDay,
    end_time: TimeOfDay,
    employee_count: z
      .int()
      .min(1)
      .max(50)
      .meta({ description: 'Number of employees needed for this block.' }),
  })
  .meta({ id: 'TemplateShiftBlock' });

/**
 * A reusable shift pattern for one location stored in DynamoDB.
 *
 *   PK     = ORG#<org_id>
 *   SK     = SCHEDULE_TEMPLATE#<template_id>
 *   GSI1PK = MANAGER#<manager_id>
 *   GSI1SK = TEMPLATE#<template_id>
 */
export const ScheduleTemplateRecord = SingleTableKeys.extend({
  template_id: z.string(),
  org_id: z.string(),
  manager_id: z.string(),
  location_id: z.string(),
  location_name: z.string().meta({ description: 'Denormalised at creation time.' }),
  name: z.string().meta({ description: 'Manager-facing label, e.g. "Summer Weekdays".' }),
  shift_blocks: z.array(TemplateShiftBlock).min(1),
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
});

export const ScheduleTemplateApiFields = apiShapeOf(ScheduleTemplateRecord);

export type DayKey = z.infer<typeof DayKey>;
export type TemplateShiftBlock = z.infer<typeof TemplateShiftBlock>;
export type ScheduleTemplateRecord = z.infer<typeof ScheduleTemplateRecord>;
export type ScheduleTemplateApiFields = z.infer<typeof ScheduleTemplateApiFields>;
