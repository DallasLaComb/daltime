import * as z from 'zod';
import { errorResponses } from '../common.js';
import { EmployeeApiFields } from '../../entities/employee.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/employee/profile/handler.ts',
  'backend/src/functions/employee/profile/service.ts',
  'backend/src/functions/employee/profile/db.ts',
  'backend/src/functions/shared/handler-factories.ts',
  'backend/src/functions/shared/profile-service.ts',
];

/**
 * The employee profile as returned to the client.
 *
 * Single-table key attributes (`PK`/`SK`/`GSI1PK`/`GSI1SK`) are absent because
 * `stripKeys()` removes them before the handler responds — the contract
 * describes the API surface, not the stored item.
 */
export const EmployeeProfileResponse = EmployeeApiFields.meta({
  id: 'EmployeeProfileResponse',
  description: "An employee's own profile, enriched with their live Cognito status.",
});

/**
 * Body accepted by `PUT /employee/profile`.
 *
 * Every field is optional so the client can send a partial update, but at least
 * one must be present — the same rule `createProfileService.updateProfile`
 * enforces today, lifted here so it is validated before the service runs.
 */
export const UpdateEmployeeProfileBody = z
  .object({
    first_name: z.string().trim().min(1).optional(),
    last_name: z.string().trim().min(1).optional(),
    phone: z.string().trim().optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'At least one field must be provided',
  )
  .meta({
    id: 'UpdateEmployeeProfileBody',
    description: 'Partial update of the calling employee’s own profile.',
  });

registerOperation('get', '/employee/profile', {
  operationId: 'getEmployeeProfile',
  summary: 'Get the calling employee’s profile',
  tags: ['employee'],
  purpose:
    'Backs the employee profile screen (frontend/src/app/features/employee/profile). Resolves the ' +
    'caller from their JWT sub alone, so the client never supplies an identifier.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Reverse lookup that resolves the caller’s org_id before the org-partition read.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<callerSub>',
      note: 'Fetches the employee record itself; status is then enriched from Cognito.',
    },
  ],
  responses: {
    200: {
      description: 'The calling employee’s profile.',
      content: { 'application/json': { schema: EmployeeProfileResponse } },
    },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('put', '/employee/profile', {
  operationId: 'updateEmployeeProfile',
  summary: 'Update the calling employee’s profile',
  tags: ['employee'],
  purpose:
    'Saves edits made on the employee profile screen. Only name and phone are mutable — email, org, ' +
    'manager, and status are owned by Cognito or by the manager/org-admin who created the employee.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id before the org-partition write.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<callerSub>',
      note: 'Primary record; returns ALL_NEW, which becomes the response body.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Keeps first_name/last_name on the reverse-lookup record in sync with the primary.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpdateEmployeeProfileBody } },
  },
  responses: {
    200: {
      description: 'The updated profile.',
      content: { 'application/json': { schema: EmployeeProfileResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type EmployeeProfileResponse = z.infer<typeof EmployeeProfileResponse>;
export type UpdateEmployeeProfileBody = z.infer<typeof UpdateEmployeeProfileBody>;
