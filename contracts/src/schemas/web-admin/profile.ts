import * as z from 'zod';
import { UserStatus, errorResponses } from '../common.js';
import { WebAdminApiFields } from '../../entities/web-admin.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/web-admin/profile/handler.ts',
  'backend/src/functions/web-admin/profile/service.ts',
  'backend/src/functions/web-admin/profile/db.ts',
];

/**
 * The web-admin's own profile as returned to the client.
 *
 * `status` is widened from the stored `WebAdminStatus` (ACTIVE/DISABLED) to the
 * live Cognito `UserStatus` because `service.getProfile` enriches it via
 * `enrichSingleWithCognitoStatus` on every read.
 */
export const WebAdminProfileResponse = WebAdminApiFields.extend({ status: UserStatus }).meta({
  id: 'WebAdminProfileResponse',
  description: "The calling web-admin's own profile, enriched with their live Cognito status.",
});

/**
 * Body accepted by `PUT /web-admin/profile`.
 *
 * Both fields optional but at least one required — the same rule the service's
 * `updateProfile` enforces via `validateNameField`, lifted here so a malformed
 * request is rejected in the handler before it reaches DynamoDB.
 */
export const UpdateWebAdminProfileBody = z
  .object({
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
  })
  .refine(
    (b) => b.first_name !== undefined || b.last_name !== undefined,
    'At least one of first_name or last_name must be provided',
  )
  .meta({
    id: 'UpdateWebAdminProfileBody',
    description: 'Partial update of the calling web-admin’s name.',
  });

registerOperation('get', '/web-admin/profile', {
  operationId: 'getWebAdminProfile',
  summary: "Get the calling web-admin's profile",
  tags: ['web-admin'],
  purpose:
    'Backs the web-admin profile screen (frontend/src/app/features/web-admin/profile). Resolves the ' +
    'caller from their JWT sub alone, so the client never supplies an identifier.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Fetches the web-admin record; status is then enriched from Cognito.',
    },
  ],
  responses: {
    200: {
      description: "The calling web-admin's profile.",
      content: { 'application/json': { schema: WebAdminProfileResponse } },
    },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('put', '/web-admin/profile', {
  operationId: 'updateWebAdminProfile',
  summary: "Update the calling web-admin's profile",
  tags: ['web-admin'],
  purpose:
    'Saves edits made on the web-admin profile screen. Only first_name and last_name are mutable — ' +
    'email and status are owned by Cognito or the deployment that created the web-admin.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Fetches the current web-admin record (fail-closed gate already ran).',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Sets the supplied name fields plus updated_at; ALL_NEW becomes the response.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpdateWebAdminProfileBody } },
  },
  responses: {
    200: {
      description: "The updated profile.",
      content: { 'application/json': { schema: WebAdminProfileResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type WebAdminProfileResponse = z.infer<typeof WebAdminProfileResponse>;
export type UpdateWebAdminProfileBody = z.infer<typeof UpdateWebAdminProfileBody>;
