import * as z from 'zod';
import { errorResponses } from '../common.js';
import {
  ScheduleTemplateApiFields,
  TemplateShiftBlock,
} from '../../entities/schedule-template.js';
import { ShiftNeededApiFields, DateOnly } from '../../entities/shift.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/manager/schedule-templates/handler.ts',
  'backend/src/functions/manager/schedule-templates/service.ts',
  'backend/src/functions/manager/schedule-templates/db.ts',
];

export const ManagerScheduleTemplateResponse = ScheduleTemplateApiFields.meta({
  id: 'ManagerScheduleTemplateResponse',
  description: 'A location schedule template owned by the calling manager.',
});

export const ManagerScheduleTemplateListResponse = z
  .array(ManagerScheduleTemplateResponse)
  .meta({
    id: 'ManagerScheduleTemplateListResponse',
    description: "All schedule templates owned by the calling manager.",
  });

export const CreateScheduleTemplateBody = z
  .object({
    location_id: z.string().min(1),
    name: z.string().min(1).max(80),
    shift_blocks: z.array(TemplateShiftBlock).min(1).max(20),
  })
  .meta({
    id: 'CreateScheduleTemplateBody',
    description: 'Fields required to create a reusable location shift template.',
  });

export const UpdateScheduleTemplateBody = z
  .object({
    name: z.string().min(1).max(80).optional(),
    shift_blocks: z.array(TemplateShiftBlock).min(1).max(20).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'At least one field is required')
  .meta({
    id: 'UpdateScheduleTemplateBody',
    description: 'Partial update of a template name or shift blocks.',
  });

export const ApplyScheduleTemplateBody = z
  .object({
    start_date: DateOnly,
    end_date: DateOnly,
    skip_dates: z
      .array(DateOnly)
      .default([])
      .meta({ description: 'Dates to skip when generating shifts (e.g. holidays).' }),
  })
  .meta({
    id: 'ApplyScheduleTemplateBody',
    description: 'Date range and optional skip-dates for bulk-creating ShiftNeeded records.',
  });

export const ApplyScheduleTemplateResult = z
  .object({
    created: z.int().nonnegative(),
    shifts: z.array(ShiftNeededApiFields),
  })
  .meta({
    id: 'ApplyScheduleTemplateResult',
    description: 'Number of ShiftNeeded records created plus their full shapes.',
  });

const TemplateIdPathParams = z.object({
  templateId: z.string().meta({ description: "The schedule template's template_id." }),
});

registerRoleOperation('get', '/manager/schedule-templates', {
  operationId: 'listManagerScheduleTemplates',
  summary: "List the calling manager's schedule templates",
  tags: ['manager'],
  purpose:
    'Backs the Templates panel in the manager shifts-needed screen ' +
    '(frontend/src/app/features/manager/shifts-needed). Returns all reusable location shift ' +
    'templates the manager has defined.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves org_id and manager_id.',
    },
    {
      command: 'Query',
      index: 'GSI1',
      keyCondition: 'GSI1PK = MANAGER#<managerId> AND begins_with(GSI1SK, "TEMPLATE#")',
      note: 'Lists all templates owned by this manager.',
    },
  ],
  responses: {
    200: {
      description: "The calling manager's schedule templates.",
      content: { 'application/json': { schema: ManagerScheduleTemplateListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerRoleOperation('post', '/manager/schedule-templates', {
  operationId: 'createManagerScheduleTemplate',
  summary: 'Create a schedule template',
  tags: ['manager'],
  purpose:
    'Creates a reusable shift-block template for a location from the Templates panel on the ' +
    'shifts-needed screen.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = LOCATION#<locationId>',
      note: "Confirms the location belongs to the caller's org and reads location_name.",
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = SCHEDULE_TEMPLATE#<templateId>',
      note: 'Writes the new template with GSI1 key for manager listing.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: CreateScheduleTemplateBody } },
  },
  responses: {
    200: {
      description: 'The created template.',
      content: { 'application/json': { schema: ManagerScheduleTemplateResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerRoleOperation('put', '/manager/schedule-templates/{templateId}', {
  operationId: 'updateManagerScheduleTemplate',
  summary: 'Update a schedule template',
  tags: ['manager'],
  purpose: 'Saves edits to a template name or shift blocks from the Templates panel.',
  implementation: IMPLEMENTATION,
  requestParams: { path: TemplateIdPathParams },
  dynamodb: [
    { command: 'Get', keyCondition: 'PK = USER#<callerSub> AND SK = METADATA' },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SCHEDULE_TEMPLATE#<templateId>',
      note: 'Confirms the template exists and the caller owns it.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = SCHEDULE_TEMPLATE#<templateId>',
      note: 'Sets supplied fields plus updated_at. Returns ALL_NEW.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpdateScheduleTemplateBody } },
  },
  responses: {
    200: {
      description: 'The updated template.',
      content: { 'application/json': { schema: ManagerScheduleTemplateResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerRoleOperation('delete', '/manager/schedule-templates/{templateId}', {
  operationId: 'deleteManagerScheduleTemplate',
  summary: 'Delete a schedule template',
  tags: ['manager'],
  purpose: 'Removes a schedule template the caller owns.',
  implementation: IMPLEMENTATION,
  requestParams: { path: TemplateIdPathParams },
  dynamodb: [
    { command: 'Get', keyCondition: 'PK = USER#<callerSub> AND SK = METADATA' },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SCHEDULE_TEMPLATE#<templateId>',
      note: 'Confirms ownership.',
    },
    {
      command: 'Delete',
      keyCondition: 'PK = ORG#<orgId> AND SK = SCHEDULE_TEMPLATE#<templateId>',
    },
  ],
  responses: {
    200: { description: 'Template deleted.' },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerRoleOperation('post', '/manager/schedule-templates/{templateId}/apply', {
  operationId: 'applyManagerScheduleTemplate',
  summary: 'Apply a template to a date range',
  tags: ['manager'],
  purpose:
    'Bulk-creates ShiftNeeded records for every date in [start_date, end_date] whose day-of-week ' +
    'matches a template shift block, skipping any date in skip_dates. Backs the Apply Wizard on ' +
    'the shifts-needed screen.',
  implementation: IMPLEMENTATION,
  requestParams: { path: TemplateIdPathParams },
  dynamodb: [
    { command: 'Get', keyCondition: 'PK = USER#<callerSub> AND SK = METADATA' },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SCHEDULE_TEMPLATE#<templateId>',
      note: 'Confirms ownership and loads the template shift blocks.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT_NEEDED#<shiftId>',
      note: 'One Put per generated ShiftNeeded record.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: ApplyScheduleTemplateBody } },
  },
  responses: {
    200: {
      description: 'The count of created records and their full shapes.',
      content: { 'application/json': { schema: ApplyScheduleTemplateResult } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type ManagerScheduleTemplateResponse = z.infer<typeof ManagerScheduleTemplateResponse>;
export type ManagerScheduleTemplateListResponse = z.infer<
  typeof ManagerScheduleTemplateListResponse
>;
export type CreateScheduleTemplateBody = z.infer<typeof CreateScheduleTemplateBody>;
export type UpdateScheduleTemplateBody = z.infer<typeof UpdateScheduleTemplateBody>;
export type ApplyScheduleTemplateBody = z.infer<typeof ApplyScheduleTemplateBody>;
export type ApplyScheduleTemplateResult = z.infer<typeof ApplyScheduleTemplateResult>;
