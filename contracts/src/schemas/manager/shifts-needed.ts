import * as z from 'zod';
import { errorResponses } from '../common.js';
import { ShiftNeededApiFields, DateOnly, TimeOfDay } from '../../entities/shift.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/manager/shifts-needed/handler.ts',
  'backend/src/functions/manager/shifts-needed/service.ts',
  'backend/src/functions/manager/shifts-needed/db.ts',
  'backend/src/functions/shared/handler-factories.ts',
];

/**
 * An unfilled staffing need as a Manager manages it.
 *
 * Single-table key attributes are absent because `stripKeys()` removes them
 * before the handler responds — the contract describes the API surface.
 */
export const ManagerShiftNeededResponse = ShiftNeededApiFields.meta({
  id: 'ManagerShiftNeededResponse',
  description: 'An unfilled shift-need posted by the calling manager.',
});

export const ManagerShiftNeededListResponse = z.array(ManagerShiftNeededResponse).meta({
  id: 'ManagerShiftNeededListResponse',
  description: 'Every shift-need the calling manager owns within the requested month.',
});

/** Query parameters for `GET /manager/shifts-needed` — optional month, defaulting to next month. */
export const ManagerShiftNeededQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .meta({ description: 'YYYY-MM — all shift-needs in the given calendar month.' }),
  })
  .meta({ id: 'ManagerShiftNeededQuery' });

/**
 * Body accepted by `POST /manager/shifts-needed`.
 *
 * Supersedes the required-field checks and `employee_count` bounds the service
 * used to run. `date` must not be in the past — a rule the service enforces
 * beyond the plain shape here.
 */
export const CreateManagerShiftNeededBody = z
  .object({
    date: DateOnly,
    start_time: TimeOfDay,
    end_time: TimeOfDay,
    employee_count: z
      .int()
      .min(1)
      .max(50)
      .meta({ description: 'How many employees are needed, 1–50.' }),
    location_id: z.string().min(1),
    notes: z
      .string()
      .max(500)
      .optional()
      .meta({ description: 'Optional notes, 500 characters or fewer.' }),
  })
  .refine((b) => b.end_time > b.start_time, 'end_time must be after start_time')
  .meta({
    id: 'CreateManagerShiftNeededBody',
    description: 'Fields accepted to post a new unfilled staffing need.',
  });

/**
 * Body accepted by `PUT /manager/shifts-needed/{shiftId}`.
 *
 * Every field is optional so the client can send a partial update, but at least
 * one must be present — the same rule `validateShiftNeededUpdateBody` enforces.
 */
export const UpdateManagerShiftNeededBody = z
  .object({
    date: DateOnly.optional(),
    start_time: TimeOfDay.optional(),
    end_time: TimeOfDay.optional(),
    employee_count: z.int().min(1).max(50).optional(),
    location_id: z.string().min(1).optional(),
    notes: z.string().max(500).optional(),
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
    id: 'UpdateManagerShiftNeededBody',
    description: 'Partial update of a shift-need.',
  });

/** Path parameters for the by-id routes. */
const ShiftIdPathParams = z.object({
  shiftId: z.string().meta({ description: 'The shift-need’s shift_id.' }),
});

registerOperation('get', '/manager/shifts-needed', {
  operationId: 'listManagerShiftNeeded',
  summary: "List the calling manager's staffing needs in a month",
  tags: ['manager'],
  purpose:
    'Backs the manager shifts-needed screen (frontend/src/app/features/manager/shifts-needed). Lists ' +
    'every unfilled staffing need the caller owns, filtered to the `month` query param (defaulting to next month).',
  implementation: IMPLEMENTATION,
  requestParams: { query: ManagerShiftNeededQuery },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Query',
      keyCondition: 'GSI1PK = MANAGER#<managerId> AND begins_with(GSI1SK, <month>)',
      note: 'GSI1 query filtering the manager’s shift-needs to the requested month; key attributes are stripped and rows sorted by date then start_time.',
    },
  ],
  responses: {
    200: {
      description: "The calling manager's staffing needs in the requested month.",
      content: { 'application/json': { schema: ManagerShiftNeededListResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('post', '/manager/shifts-needed', {
  operationId: 'createManagerShiftNeeded',
  summary: 'Post a staffing need',
  tags: ['manager'],
  purpose:
    'Creates an unfilled staffing need from the manager shifts-needed screen’s "add need" action.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = LOCATION#<locationId>',
      note: 'Confirms the target location belongs to the caller’s organization.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT_NEEDED#<shiftId>',
      note: 'Primary record plus GSI1PK/GSI1SK for month-range listing; GSI1SK is the posting date.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: CreateManagerShiftNeededBody } },
  },
  responses: {
    200: {
      description: 'The created shift-need.',
      content: { 'application/json': { schema: ManagerShiftNeededResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('put', '/manager/shifts-needed/{shiftId}', {
  requestParams: { path: ShiftIdPathParams },
  operationId: 'updateManagerShiftNeeded',
  summary: 'Update a staffing need',
  tags: ['manager'],
  purpose:
    'Saves edits to a shift-need the caller owns — rescheduling, re-targeting a location, or adjusting the count/notes.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT_NEEDED#<shiftId>',
      note: 'Fetches the shift-need to confirm the caller owns it.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = LOCATION#<locationId>',
      note: 'Only when location_id changes — confirms the new location belongs to the caller’s org.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT_NEEDED#<shiftId>',
      note: 'Sets the supplied fields plus updated_at. Returns ALL_NEW.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpdateManagerShiftNeededBody } },
  },
  responses: {
    200: {
      description: 'The updated shift-need.',
      content: { 'application/json': { schema: ManagerShiftNeededResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('delete', '/manager/shifts-needed/{shiftId}', {
  requestParams: { path: ShiftIdPathParams },
  operationId: 'deleteManagerShiftNeeded',
  summary: 'Delete a staffing need',
  tags: ['manager'],
  purpose: 'Removes a shift-need the caller owns from the shifts-needed screen.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT_NEEDED#<shiftId>',
      note: 'Confirms the shift-need exists and belongs to the caller.',
    },
    {
      command: 'Delete',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT_NEEDED#<shiftId>',
      note: 'Deletes the shift-need record.',
    },
  ],
  responses: {
    200: { description: 'Shift-need deleted.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type ManagerShiftNeededResponse = z.infer<typeof ManagerShiftNeededResponse>;
export type ManagerShiftNeededListResponse = z.infer<typeof ManagerShiftNeededListResponse>;
export type ManagerShiftNeededQuery = z.infer<typeof ManagerShiftNeededQuery>;
export type CreateManagerShiftNeededBody = z.infer<typeof CreateManagerShiftNeededBody>;
export type UpdateManagerShiftNeededBody = z.infer<typeof UpdateManagerShiftNeededBody>;
