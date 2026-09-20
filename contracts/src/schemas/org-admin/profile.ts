import * as z from 'zod';
import { errorResponses } from '../common.js';
import { OrgAdminUserApiFields } from '../../entities/organization.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/org-admin/profile/handler.ts',
  'backend/src/functions/org-admin/profile/service.ts',
  'backend/src/functions/org-admin/profile/db.ts',
  'backend/src/functions/shared/contract-validation.ts',
];

/**
 * The org-admin's own profile as returned to the client.
 *
 * Same shape as `OrgAdminManagerResponse`/`OrgAdminEmployeeResponse`, but for
 * the caller themselves: key-attributes stripped via `stripKeys()` before the
 * handler responds, and `status` enriched from a live Cognito lookup.
 */
export const OrgAdminProfileResponse = OrgAdminUserApiFields.meta({
  id: 'OrgAdminProfileResponse',
  description: "The calling OrgAdmin's own profile, enriched with their live Cognito status.",
});

/**
 * Body accepted by `PUT /org-admin/profile`.
 *
 * `name` must be a non-empty string after trimming — the same rule the service's
 * `if (!body.name?.trim()) throw new ValidationError('name is required')` enforced
 * today, lifted here so it is validated before the service runs.
 */
export const UpdateOrgAdminProfileBody = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'name is required')
      .meta({ description: "The OrgAdmin's display name." }),
  })
  .meta({
    id: 'UpdateOrgAdminProfileBody',
    description: "Update the calling OrgAdmin's name.",
  });

registerOperation('get', '/org-admin/profile', {
  operationId: 'getOrgAdminProfile',
  summary: "Get the calling org-admin's profile",
  tags: ['org-admin'],
  purpose:
    'Backs the org-admin profile screen (frontend/src/app/features/org-admin/profile). Resolves the ' +
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
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<userId>',
      note: 'Fetches the org-admin record itself; status is then enriched from Cognito.',
    },
  ],
  responses: {
    200: {
      description: "The calling org-admin's profile.",
      content: { 'application/json': { schema: OrgAdminProfileResponse } },
    },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('put', '/org-admin/profile', {
  operationId: 'updateOrgAdminProfile',
  summary: "Update the calling org-admin's profile",
  tags: ['org-admin'],
  purpose:
    'Saves edits made on the org-admin profile screen. Only `name` is mutable — email, org, and ' +
    'status are owned by Cognito or the org who created the org-admin.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id before the org-partition write.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<userId>',
      note: 'Fetches the current org-admin record to obtain the email Cognito updates.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<userId>',
      note: 'Primary record; SET name and updated_at. Response is the pre-update record with the new name.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<userId> AND SK = METADATA',
      note: 'Keeps name on the reverse-lookup record in sync with the primary.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: UpdateOrgAdminProfileBody } } },
  responses: {
    200: {
      description: "The updated profile.",
      content: { 'application/json': { schema: OrgAdminProfileResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type OrgAdminProfileResponse = z.infer<typeof OrgAdminProfileResponse>;
export type UpdateOrgAdminProfileBody = z.infer<typeof UpdateOrgAdminProfileBody>;
