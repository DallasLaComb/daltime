import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { ShiftApiFields, ShiftType } from '../../entities/shift.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/manager/shifts/handler.ts',
  'backend/src/functions/manager/shifts/service.ts',
  'backend/src/functions/manager/shifts/db.ts',
  'backend/src/functions/shared/handler-factories.ts',
];

/**
 * An assigned shift as a Manager manages it.
 *
 * Single-table key attributes are absent because `stripKeys()` removes them
 * before the handler responds — the contract describes the API surface.
 */
export const ManagerShiftResponse = ShiftApiFields.meta({
  id: 'ManagerShiftResponse',
  description: 'A shift assigned by (or belonging to) the calling manager.',
});

export const ManagerShiftListResponse = z.array(ManagerShiftResponse).meta({
  id: 'ManagerShiftListResponse',
  description: 'Every shift the calling manager owns within the requested month.',
});

/**
 * Query parameters for `GET /manager/shifts`.
 *
 * `month` is optional and defaults to the current UTC month when absent —
 * the same `parseMonth` default the service applies.
 */
export const ManagerShiftsQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .meta({ description: 'YYYY-MM — all shifts in the given calendar month.' }),
  })
  .meta({ id: 'ManagerShiftsQuery' });

/**
 * Body accepted by `POST /manager/shifts`.
 *
 * Supersedes the per-required-field checks `service.createShift` used to run, so
 * a malformed request is rejected in the handler before it reaches DynamoDB. The
 * employee is pinned by the caller — the schema accepts the id, and ownership
 * (`employee.manager_id === caller`) is still checked in the service.
 */
export const CreateManagerShiftBody = z
  .object({
    employee_id: z.string().min(1),
    location_id: z.string().min(1),
    date: z
      .iso
      .date()
      .meta({ description: 'Calendar date, YYYY-MM-DD.', example: '2026-05-27' }),
    start_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .meta({ description: 'Start time, HH:MM 24-hour.' }),
    end_time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .meta({ description: 'End time, HH:MM 24-hour.' }),
    type: ShiftType,
  })
  .refine((b) => b.end_time > b.start_time, 'end_time must be after start_time')
  .meta({
    id: 'CreateManagerShiftBody',
    description: 'Fields accepted to create a new shift for an employee in the manager’s team.',
  });

/**
 * Body accepted by `PUT /manager/shifts/{shiftId}`.
 *
 * Every field is optional so the client can send a partial update, but at least
 * one must be present — the same rule `service.updateShift`'s
 * `validateShiftUpdateBody` enforces, lifted here so it is validated before the
 * service runs. `end_time`/`start_time` order is enforced only when both are
 * supplied.
 */
export const UpdateManagerShiftBody = z
  .object({
    employee_id: z.string().min(1).optional(),
    location_id: z.string().min(1).optional(),
    date: z.iso.date().optional(),
    start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    type: ShiftType.optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'At least one field is required')
  .superRefine((b, ctx) => {
    if (b.start_time !== undefined && b.end_time !== undefined && b.end_time <= b.start_time) {
      ctx.addIssue({
        code: 'custom',
        path: ['end_time'],
        message: 'end_time must be after start_time',
      });
    }
  })
  .meta({
    id: 'UpdateManagerShiftBody',
    description: 'Partial update of a shift.',
  });

/** Path parameters for the by-id routes. */
const ShiftIdPathParams = z.object({
  shiftId: z.string().meta({ description: 'The managed shift’s shift_id.' }),
});

registerOperation('get', '/manager/shifts', {
  operationId: 'listManagerShifts',
  summary: "List the calling manager's shifts in a month",
  tags: ['manager'],
  purpose:
    'Backs the manager schedule screen (frontend/src/app/features/manager/schedule). Lists every shift ' +
    'the caller owns, filtered to the month from the `month` query param (defaulting to the current month).',
  implementation: IMPLEMENTATION,
  requestParams: { query: ManagerShiftsQuery },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Query',
      keyCondition: 'GSI1PK = MANAGER#<managerId> AND begins_with(GSI1SK, <month>)',
      note: 'GSI1 query filtering the manager’s shifts to the requested month; key attributes are stripped and rows sorted by date then start_time.',
    },
  ],
  responses: {
    200: {
      description: "The calling manager's shifts in the requested month.",
      content: { 'application/json': { schema: ManagerShiftListResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('post', '/manager/shifts', {
  operationId: 'createManagerShift',
  summary: 'Create a shift',
  tags: ['manager'],
  purpose:
    'Creates a shift for an employee in the manager’s team, from the manage schedule "add shift" action.',
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
      note: 'Confirms the target employee reports to the caller before assignment.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Primary record plus GSI1PK/Gsi1SK for month-range listing. Responds with key attributes stripped.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: CreateManagerShiftBody } } },
  responses: {
    200: {
      description: 'The created shift.',
      content: { 'application/json': { schema: ManagerShiftResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    // The factory returns ok('') on this route today, but the service pins ownership.
    500: errorResponses[500],
  },
});

registerOperation('put', '/manager/shifts/{shiftId}', {
  requestParams: { path: ShiftIdPathParams },
  operationId: 'updateManagerShift',
  summary: 'Update a shift',
  tags: ['manager'],
  purpose:
    'Saves edits to a shift the caller owns — rescheduling, re-assigning the employee, or changing the type.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Fetches the shift to confirm the caller owns it.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Only when employee_id changes — confirms the new employee reports to the caller.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Sets the supplied fields plus updated_at. Returns ALL_NEW.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: UpdateManagerShiftBody } } },
  responses: {
    200: {
      description: 'The updated shift.',
      content: { 'application/json': { schema: ManagerShiftResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('delete', '/manager/shifts/{shiftId}', {
  requestParams: { path: ShiftIdPathParams },
  operationId: 'deleteManagerShift',
  summary: 'Delete a shift',
  tags: ['manager'],
  purpose:
    'Removes a shift the caller owns from the manage schedule screen.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Confirms the shift exists and belongs to the caller.',
    },
    {
      command: 'Delete',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Deletes the shift record.',
    },
  ],
  responses: {
    200: { description: 'Shift deleted.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type ManagerShiftResponse = z.infer<typeof ManagerShiftResponse>;
export type ManagerShiftListResponse = z.infer<typeof ManagerShiftListResponse>;
export type ManagerShiftsQuery = z.infer<typeof ManagerShiftsQuery>;
export type CreateManagerShiftBody = z.infer<typeof CreateManagerShiftBody>;
export type UpdateManagerShiftBody = z.infer<typeof UpdateManagerShiftBody>;
