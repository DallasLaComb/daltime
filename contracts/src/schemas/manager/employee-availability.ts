import * as z from 'zod';
import { errorResponses } from '../common.js';
import {
  EmployeeAvailabilityApiFields,
  EmployeeAvailabilityOverridesApiFields,
} from '../../entities/availability.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/manager/employees/handler.ts',
  'backend/src/functions/manager/employees/service.ts',
  'backend/src/functions/manager/employees/db.ts',
];

/** Path parameters for both availability read routes. */
const EmployeeIdPathParams = z.object({
  employeeId: z.string().meta({ description: 'Cognito sub of the managed employee.' }),
});

/**
 * A managed employee's recurring weekly availability, as the manager reads it.
 *
 * When the employee has never saved a schedule, `service.getEmployeeAvailabilityForManager`
 * returns `{ employee_id, schedule: null, updated_at: null }` rather than 404, so the
 * nullable fields are baked into the schema — the manager's schedule screen treats
 * "no schedule yet" as a normal state, not an error.
 */
export const ManagerEmployeeAvailabilityResponse = EmployeeAvailabilityApiFields.partial().meta({
  id: 'ManagerEmployeeAvailabilityResponse',
  description:
    "A managed employee's recurring weekly availability. `schedule`/`updated_at` are null when none has been saved.",
});

/**
 * A managed employee's date-specific availability overrides, as the manager reads it.
 *
 * When the employee has never saved overrides, `service.getEmployeeAvailabilityOverridesForManager`
 * returns `{ employee_id, overrides: {}, updated_at: null }` rather than 404, so `overrides`
 * defaults to an empty object and `updated_at` may be null.
 */
export const ManagerEmployeeAvailabilityOverridesResponse = EmployeeAvailabilityOverridesApiFields.partial().meta(
  {
    id: 'ManagerEmployeeAvailabilityOverridesResponse',
    description:
      "A managed employee's date-specific availability overrides. `overrides` defaults to {} and `updated_at` is null when none have been saved.",
  },
);

registerRoleOperation('get', '/manager/employees/{employeeId}/availability', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'getManagerEmployeeAvailability',
  summary: "Get a managed employee's recurring weekly availability",
  tags: ['manager'],
  purpose:
    'Backs the manager schedule screen (frontend/src/app/features/manager/schedule), which shows the ' +
    'availability of each employee reporting to the caller. Read-only — the employee edits their own ' +
    'schedule elsewhere.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Fetches the employee to confirm they report to the caller.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<employeeId> AND SK = AVAILABILITY',
      note: "Point read of the employee's weekly availability. Returns a null-schedule fallback when none exists yet.",
    },
  ],
  responses: {
    200: {
      description: "The employee's weekly availability.",
      content: { 'application/json': { schema: ManagerEmployeeAvailabilityResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerRoleOperation('get', '/manager/employees/{employeeId}/availability/overrides', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'getManagerEmployeeAvailabilityOverrides',
  summary: "Get a managed employee's date-specific availability overrides",
  tags: ['manager'],
  purpose:
    'Backs the manager schedule screen, showing the per-date overrides of each employee reporting to ' +
    'the caller. Read-only — the employee edits their own overrides elsewhere.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Fetches the employee to confirm they report to the caller.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<employeeId> AND SK = AVAILABILITY_OVERRIDES',
      note: "Point read of the employee's overrides. Returns an empty-overrides fallback when none exist yet.",
    },
  ],
  responses: {
    200: {
      description: "The employee's availability overrides.",
      content: { 'application/json': { schema: ManagerEmployeeAvailabilityOverridesResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type ManagerEmployeeAvailabilityResponse = z.infer<
  typeof ManagerEmployeeAvailabilityResponse
>;
export type ManagerEmployeeAvailabilityOverridesResponse = z.infer<
  typeof ManagerEmployeeAvailabilityOverridesResponse
>;
