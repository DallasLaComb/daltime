import * as z from 'zod';
import { errorResponses } from '../common.js';
import { ShiftApiFields, DateOnly } from '../../entities/shift.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/employee/available-shifts/handler.ts',
  'backend/src/functions/employee/available-shifts/service.ts',
  'backend/src/functions/employee/available-shifts/db.ts',
];

/** Query parameters accepted by `GET /employee/available-shifts`. */
const AvailableShiftsQueryParams = z.object({
  date: DateOnly.meta({ description: 'The calendar day to look for available shifts.' }),
});

/**
 * Shifts other employees in the caller's org have offered up for pickup on a
 * given date. Same wire shape as `/employee/shifts` — `available_for_pickup`
 * is always `true` on every item in this list.
 */
export const AvailableShiftsResponse = z
  .array(ShiftApiFields)
  .meta({ id: 'AvailableShiftsResponse', description: 'Shifts open for pickup on the requested date.' });

registerRoleOperation('get', '/employee/available-shifts', {
  operationId: 'listAvailableShifts',
  summary: 'List shifts other employees have offered up for pickup on a date',
  tags: ['employee'],
  purpose:
    'Backs the "Available to Take" panel (frontend/src/app/features/employee/available-shifts) — shifts ' +
    'from OTHER employees in the caller’s org that are published and flagged available_for_pickup for ' +
    'the requested date. An employee can never pick up their own shift.',
  implementation: IMPLEMENTATION,
  requestParams: { query: AvailableShiftsQueryParams },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and employee_id; a missing record fails closed with 403.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, "SHIFT#")',
      filter:
        '#date = :date AND available_for_pickup = :true AND employee_id <> :callerId AND ' +
        '(#status = :published OR attribute_not_exists(#status))',
      note:
        'Base-table query narrowed to the org partition. The filter excludes the caller’s own shifts, ' +
        'requires the assigned employee to have opted the shift into pickup, and requires published status.',
    },
  ],
  responses: {
    200: {
      description: 'Shifts available for pickup on the requested date. Empty array when none exist.',
      content: { 'application/json': { schema: AvailableShiftsResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type AvailableShiftsResponse = z.infer<typeof AvailableShiftsResponse>;
