import * as z from 'zod';
import { errorResponses } from '../common.js';
import { EmployeeAvailabilityApiFields, WeeklySchedule } from '../../entities/availability.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/employee/availability/handler.ts',
  'backend/src/functions/employee/availability/service.ts',
  'backend/src/functions/employee/availability/db.ts',
];

/**
 * The calling employee's recurring weekly availability.
 *
 * `GET /employee/availability` returns `{}` (not 404) when the employee has
 * never saved a schedule, so every field here is optional — the handler is
 * null-safe by design rather than treating "no record yet" as an error.
 */
export const EmployeeAvailabilityResponse = EmployeeAvailabilityApiFields.partial().meta({
  id: 'EmployeeAvailabilityResponse',
  description:
    "The calling employee's recurring weekly availability. Empty object when none has been saved yet.",
});

/**
 * Body accepted by `PUT /employee/availability`.
 *
 * Full replacement, not a partial update — the service writes this as a
 * complete `Put` of the AVAILABILITY item. Per-day slot/max_shifts business
 * rules (non-empty slots when available, 1 ≤ max_shifts ≤ slots.length) are
 * enforced by `service.ts` beyond what this shape captures.
 */
export const UpsertAvailabilityBody = z
  .object({
    schedule: WeeklySchedule,
  })
  .meta({
    id: 'UpsertAvailabilityBody',
    description: 'Full weekly schedule replacement for PUT /employee/availability.',
  });

registerOperation('get', '/employee/availability', {
  operationId: 'getEmployeeAvailability',
  summary: 'Get the calling employee’s recurring weekly availability',
  tags: ['employee'],
  purpose:
    'Backs the employee availability screen (frontend/src/app/features/employee/availability), where ' +
    'an employee sets which days/windows they are willing to work.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id; a missing record fails closed with 403.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = AVAILABILITY',
      note: 'Point read for the employee’s own record. Returns {} (not 404) when none exists yet.',
    },
  ],
  responses: {
    200: {
      description: 'The calling employee’s weekly availability.',
      content: { 'application/json': { schema: EmployeeAvailabilityResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('put', '/employee/availability', {
  operationId: 'updateEmployeeAvailability',
  summary: 'Replace the calling employee’s recurring weekly availability',
  tags: ['employee'],
  purpose:
    'Saves the schedule set on the employee availability screen. Every day of the week must be present ' +
    'in the payload — this is a full replace, not a merge.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id before the write; a missing record fails closed with 403.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<callerSub> AND SK = AVAILABILITY',
      note: 'Full-item replace of the employee’s weekly schedule.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpsertAvailabilityBody } },
  },
  responses: {
    200: {
      description: 'The saved weekly availability.',
      content: { 'application/json': { schema: EmployeeAvailabilityResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type EmployeeAvailabilityResponse = z.infer<typeof EmployeeAvailabilityResponse>;
export type UpsertAvailabilityBody = z.infer<typeof UpsertAvailabilityBody>;
