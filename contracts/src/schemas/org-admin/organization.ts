import * as z from 'zod';
import { errorResponses } from '../common.js';
import { OrganizationApiFields } from '../../entities/organization.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/org-admin/organization/handler.ts',
  'backend/src/functions/org-admin/organization/service.ts',
  'backend/src/functions/org-admin/organization/db.ts',
  'backend/src/functions/shared/contract-validation.ts',
];

/**
 * The calling org-admin's own organization as returned to the client.
 *
 * `stripKeys()` removes the single-table key attributes before the handler
 * responds, so the contract describes the API surface, not the stored item.
 */
export const OrgAdminOrganizationResponse = OrganizationApiFields.meta({
  id: 'OrgAdminOrganizationResponse',
  description: "The calling OrgAdmin's own organization.",
});

/**
 * Body accepted by `PUT /org-admin/organization`.
 *
 * Every field is optional so the client can send a partial update, but at least
 * one must be present — the same rule `service.updateOrganization` enforces
 * today, lifted here so it is validated before the service runs.
 */
export const UpdateOrgAdminOrganizationBody = z
  .object({
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.address !== undefined,
    'At least one of name or address is required',
  )
  .meta({
    id: 'UpdateOrgAdminOrganizationBody',
    description: "Partial update of the calling OrgAdmin's organization.",
  });

registerRoleOperation('get', '/org-admin/organization', {
  operationId: 'getOrgAdminOrganization',
  summary: "Get the calling org-admin's organization",
  tags: ['org-admin'],
  purpose:
    'Backs the org-admin organization screen (frontend/src/app/features/org-admin/organization). ' +
    'Resolves the caller from their JWT sub alone, so the client never supplies an identifier.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Reverse lookup that resolves the caller’s org_id before the org-partition read.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Fetches the organization record; key attributes are stripped before returning.',
    },
  ],
  responses: {
    200: {
      description: "The calling org-admin's organization.",
      content: { 'application/json': { schema: OrgAdminOrganizationResponse } },
    },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerRoleOperation('put', '/org-admin/organization', {
  operationId: 'updateOrgAdminOrganization',
  summary: "Update the calling org-admin's organization",
  tags: ['org-admin'],
  purpose:
    'Saves edits made on the org-admin organization screen. Accepts a partial update of name and/or ' +
    'address; unspecified fields are carried over from the existing record.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Reads the existing record so unspecified fields are carried over.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Sets name/address/updated_at. Returns ALL_NEW, which becomes the response body.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpdateOrgAdminOrganizationBody } },
  },
  responses: {
    200: {
      description: "The updated organization.",
      content: { 'application/json': { schema: OrgAdminOrganizationResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type OrgAdminOrganizationResponse = z.infer<typeof OrgAdminOrganizationResponse>;
export type UpdateOrgAdminOrganizationBody = z.infer<typeof UpdateOrgAdminOrganizationBody>;
