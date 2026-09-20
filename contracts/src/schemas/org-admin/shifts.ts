import * as z from 'zod';
import { errorResponses } from '../common.js';
import { ShiftApiFields } from '../../entities/shift.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/org-admin/shifts/handler.ts',
  'backend/src/functions/org-admin/shifts/service.ts',
  'backend/src/functions/org-admin/shifts/db.ts',
];

/** An assigned shift as an OrgAdmin sees it. Same entity as the manager shift response. */
export const OrgAdminShiftResponse = ShiftApiFields.meta({
  id: 'OrgAdminShiftResponse',
  description: 'A shift within the OrgAdmin’s organization.',
});

export const OrgAdminShiftListResponse = z.array(OrgAdminShiftResponse).meta({
  id: 'OrgAdminShiftListResponse',
  description: 'Every shift in the OrgAdmin’s organization within the requested month.',
});

/** Query parameters for `GET /org-admin/shifts` — optional month, defaulting to the current month. */
export const OrgAdminShiftsQuery = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional()
      .meta({ description: 'YYYY-MM — all shifts in the given calendar month.' }),
  })
  .meta({ id: 'OrgAdminShiftsQuery' });

registerOperation('get', '/org-admin/shifts', {
  operationId: 'listOrgAdminShifts',
  summary: "List the calling org-admin's organization's shifts in a month",
  tags: ['org-admin'],
  purpose:
    'Backs the org-admin schedule screen (frontend/src/app/features/org-admin/schedule). Lists every ' +
    'shift in the caller’s organization for the month from the `month` query param (defaulting to current month).',
  implementation: IMPLEMENTATION,
  requestParams: { query: OrgAdminShiftsQuery },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, SHIFT#)',
      filter: 'begins_with(#date, <month>)',
      note: 'Lists the org’s shifts for the month; key attributes are stripped and rows sorted by date then start_time.',
    },
  ],
  responses: {
    200: {
      description: 'Every shift in the org for the requested month.',
      content: { 'application/json': { schema: OrgAdminShiftListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

export type OrgAdminShiftResponse = z.infer<typeof OrgAdminShiftResponse>;
export type OrgAdminShiftListResponse = z.infer<typeof OrgAdminShiftListResponse>;
export type OrgAdminShiftsQuery = z.infer<typeof OrgAdminShiftsQuery>;
