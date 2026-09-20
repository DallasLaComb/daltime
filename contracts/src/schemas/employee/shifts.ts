import * as z from 'zod';
import { errorResponses } from '../common.js';
import { ShiftApiFields, DateOnly } from '../../entities/shift.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/employee/shifts/handler.ts',
  'backend/src/functions/employee/shifts/service.ts',
  'backend/src/functions/employee/shifts/db.ts',
];

/**
 * Query parameters accepted by `GET /employee/shifts`.
 *
 * Exactly one of `month`, `date`, or `week` must be supplied — the handler
 * rejects zero or multiple with a 400 before querying DynamoDB.
 */
export const ShiftsQueryParams = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .meta({ description: 'YYYY-MM — all shifts in the given calendar month.' }),
    date: DateOnly.optional().meta({ description: 'YYYY-MM-DD — shifts on a single day.' }),
    week: DateOnly.optional().meta({
      description: 'YYYY-MM-DD week-start date. Returns the 7-day window starting on (and including) this date.',
    }),
  })
  .refine(
    (q) => [q.month, q.date, q.week].filter((v) => v !== undefined).length === 1,
    'Exactly one of month, date, or week must be provided',
  );

/** Shifts assigned to the calling employee within the requested time window. */
export const EmployeeShiftsResponse = z.array(ShiftApiFields).meta({
  id: 'EmployeeShiftsResponse',
  description: 'The calling employee’s own shifts within the requested time window.',
});

registerRoleOperation('get', '/employee/shifts', {
  operationId: 'listEmployeeShifts',
  summary: 'List the calling employee’s own shifts within a time window',
  tags: ['employee'],
  purpose:
    'Backs the employee shifts calendar (frontend/src/app/features/employee/shifts), scoped to exactly ' +
    'one of a month, a single day, or a 7-day week starting on a given date.',
  implementation: IMPLEMENTATION,
  requestParams: { query: ShiftsQueryParams },
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
        'employee_id = :employeeId AND begins_with(#date, :month) AND ' +
        '(#status = :published OR attribute_not_exists(#status))',
      note: 'Variant used when ?month=YYYY-MM is supplied.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, "SHIFT#")',
      filter:
        'employee_id = :employeeId AND #date = :date AND ' +
        '(#status = :published OR attribute_not_exists(#status))',
      note: 'Variant used when ?date=YYYY-MM-DD is supplied.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, "SHIFT#")',
      filter:
        'employee_id = :employeeId AND #date >= :weekStart AND #date <= :weekEnd AND ' +
        '(#status = :published OR attribute_not_exists(#status))',
      note:
        'Variant used when ?week=YYYY-MM-DD is supplied. weekEnd = weekStart + 6 days; YYYY-MM-DD ' +
        'lexicographic order matches chronological order so no GSI is needed.',
    },
  ],
  responses: {
    200: {
      description: 'The calling employee’s shifts in the requested window. Empty array when none exist.',
      content: { 'application/json': { schema: EmployeeShiftsResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type EmployeeShiftsResponse = z.infer<typeof EmployeeShiftsResponse>;
