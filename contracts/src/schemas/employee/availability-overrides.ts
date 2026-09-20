import * as z from 'zod';
import { errorResponses } from '../common.js';
import {
  EmployeeAvailabilityOverridesApiFields,
  DateOverrides,
} from '../../entities/availability.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/employee/availability-overrides/handler.ts',
  'backend/src/functions/employee/availability-overrides/service.ts',
  'backend/src/functions/employee/availability-overrides/db.ts',
];

/**
 * The calling employee's date-specific availability overrides.
 *
 * `GET /employee/availability/overrides` returns `{}` (not 404) when the
 * employee has never saved any overrides, so every field is optional.
 */
export const EmployeeAvailabilityOverridesResponse =
  EmployeeAvailabilityOverridesApiFields.partial().meta({
    id: 'EmployeeAvailabilityOverridesResponse',
    description:
      "The calling employee's date-specific availability overrides. Empty object when none exist yet.",
  });

/**
 * Body accepted by `PUT /employee/availability/overrides`.
 *
 * Full replacement, not a partial update — the service writes this as a
 * complete `Put` of the AVAILABILITY_OVERRIDES item. Per-date slot/max_shifts
 * business rules are enforced by `service.ts` beyond what this shape captures.
 */
export const UpsertOverridesBody = z
  .object({
    overrides: DateOverrides,
  })
  .meta({
    id: 'UpsertOverridesBody',
    description: 'Full date-overrides replacement for PUT /employee/availability/overrides.',
  });

registerRoleOperation('get', '/employee/availability/overrides', {
  operationId: 'getEmployeeAvailabilityOverrides',
  summary: 'Get the calling employee’s date-specific availability overrides',
  tags: ['employee'],
  purpose:
    'Backs the employee availability screen’s per-date override panel — one-off exceptions that take ' +
    'precedence over the recurring weekly schedule.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id; a missing record fails closed with 403.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = AVAILABILITY_OVERRIDES',
      note: 'Point read for the employee’s own record. Returns {} (not 404) when none exists yet.',
    },
  ],
  responses: {
    200: {
      description: 'The calling employee’s date-specific overrides.',
      content: { 'application/json': { schema: EmployeeAvailabilityOverridesResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerRoleOperation('put', '/employee/availability/overrides', {
  operationId: 'updateEmployeeAvailabilityOverrides',
  summary: 'Replace the calling employee’s date-specific availability overrides',
  tags: ['employee'],
  purpose:
    'Saves per-date exceptions set on the employee availability screen. This is a full replace of the ' +
    'overrides map, not a merge.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id before the write; a missing record fails closed with 403.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<callerSub> AND SK = AVAILABILITY_OVERRIDES',
      note: 'Full-item replace of the employee’s date overrides.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpsertOverridesBody } },
  },
  responses: {
    200: {
      description: 'The saved date overrides.',
      content: { 'application/json': { schema: EmployeeAvailabilityOverridesResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type EmployeeAvailabilityOverridesResponse = z.infer<
  typeof EmployeeAvailabilityOverridesResponse
>;
export type UpsertOverridesBody = z.infer<typeof UpsertOverridesBody>;
