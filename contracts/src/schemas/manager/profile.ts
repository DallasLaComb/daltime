import * as z from 'zod';
import { errorResponses } from '../common.js';
import { ManagerApiFields } from '../../entities/manager.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/manager/profile/handler.ts',
  'backend/src/functions/manager/profile/service.ts',
  'backend/src/functions/manager/profile/db.ts',
  'backend/src/functions/shared/handler-factories.ts',
  'backend/src/functions/shared/profile-service.ts',
];

/**
 * The manager profile as returned to the client.
 *
 * Single-table key attributes (`PK`/`SK`/`GSI1PK`/`GSI1SK`) are absent because
 * `stripKeys()` removes them before the handler responds — the contract
 * describes the API surface, not the stored item.
 */
export const ManagerProfileResponse = ManagerApiFields.meta({
  id: 'ManagerProfileResponse',
  description: "A manager's own profile, enriched with their live Cognito status.",
});

/**
 * Body accepted by `PUT /manager/profile`.
 *
 * Every field is optional so the client can send a partial update, but at least
 * one must be present — the same rule `createProfileService.updateProfile`
 * enforces today, lifted here so it is validated before the service runs.
 */
export const UpdateManagerProfileBody = z
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
    id: 'UpdateManagerProfileBody',
    description: 'Partial update of the calling manager’s own profile.',
  });

registerRoleOperation('get', '/manager/profile', {
  operationId: 'getManagerProfile',
  summary: 'Get the calling manager’s profile',
  tags: ['manager'],
  purpose:
    'Backs the manager profile screen (frontend/src/app/features/manager/profile). Resolves the ' +
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
      keyCondition: 'PK = ORG#<orgId> AND SK = MANAGER#<callerSub>',
      note: 'Fetches the manager record itself; status is then enriched from Cognito.',
    },
  ],
  responses: {
    200: {
      description: 'The calling manager’s profile.',
      content: { 'application/json': { schema: ManagerProfileResponse } },
    },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerRoleOperation('put', '/manager/profile', {
  operationId: 'updateManagerProfile',
  summary: 'Update the calling manager’s profile',
  tags: ['manager'],
  purpose:
    'Saves edits made on the manager profile screen. Only name and phone are mutable — email, ' +
    'org, and status are owned by Cognito or by the org-admin who created the manager.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id before the org-partition write.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = MANAGER#<callerSub>',
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
    content: { 'application/json': { schema: UpdateManagerProfileBody } },
  },
  responses: {
    200: {
      description: 'The updated profile.',
      content: { 'application/json': { schema: ManagerProfileResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type ManagerProfileResponse = z.infer<typeof ManagerProfileResponse>;
export type UpdateManagerProfileBody = z.infer<typeof UpdateManagerProfileBody>;
