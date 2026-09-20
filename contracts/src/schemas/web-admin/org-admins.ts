import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { OrgAdminUserApiFields } from '../../entities/organization.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/web-admin/org-admins/handler.ts',
  'backend/src/functions/web-admin/org-admins/service.ts',
  'backend/src/functions/web-admin/org-admins/db.ts',
];

/** An OrgAdmin as web-admin manages them, enriched with live Cognito status. */
export const WebAdminOrgAdminResponse = OrgAdminUserApiFields.meta({
  id: 'WebAdminOrgAdminResponse',
  description: 'An OrgAdmin record as returned to a WebAdmin, enriched with live Cognito status.',
});

export const WebAdminOrgAdminListResponse = z.array(WebAdminOrgAdminResponse).meta({
  id: 'WebAdminOrgAdminListResponse',
  description: 'Every OrgAdmin in the given organization.',
});

/** Path parameters for the by-org routes. */
const OrgIdPathParams = z.object({
  orgId: z.string().meta({ description: 'The organization’s org_id.' }),
});

/** Path parameters for the by-org-by-user routes. */
const OrgAndUserPathParams = OrgIdPathParams.extend({
  userId: z.string().meta({ description: 'Cognito sub of the OrgAdmin.' }),
});

/** Body accepted by `POST /web-admin/organizations/{orgId}/org-admins`. */
export const CreateOrgAdminBody = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .meta({ description: 'Cognito username. Trimmed before validation.', format: 'email' }),
    name: z.string().trim().min(1),
    temp_password: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, 'temp_password must not be blank')
      .meta({ description: 'Temporary Cognito password. Sent verbatim — never trimmed.' }),
  })
  .meta({
    id: 'CreateOrgAdminBody',
    description: 'Fields accepted to register a new OrgAdmin via Cognito.',
  });

registerOperation('get', '/web-admin/organizations/{orgId}/org-admins', {
  operationId: 'listWebAdminOrgAdmins',
  summary: 'List the OrgAdmins in an organization',
  tags: ['web-admin'],
  purpose: 'Lists every OrgAdmin in the given org, enriched with live Cognito status.',
  implementation: IMPLEMENTATION,
  requestParams: { path: OrgIdPathParams },
  dynamodb: [
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, USER#)',
      note: 'Lists the org’s OrgAdmins; key attributes stripped and status enriched from Cognito.',
    },
  ],
  responses: {
    200: {
      description: 'Every OrgAdmin in the organization.',
      content: { 'application/json': { schema: WebAdminOrgAdminListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('post', '/web-admin/organizations/{orgId}/org-admins', {
  operationId: 'createWebAdminOrgAdmin',
  summary: 'Create an OrgAdmin for an organization',
  tags: ['web-admin'],
  purpose:
    'Creates a Cognito user in the OrgAdmin group and the corresponding DynamoDB records, from the ' +
    'web-admin org-admins screen. Stamps the acting web-admin for audit.',
  implementation: IMPLEMENTATION,
  requestParams: { path: OrgIdPathParams },
  requestBody: { required: true, content: { 'application/json': { schema: CreateOrgAdminBody } } },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Verifies the org exists before creating the user.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<userSub>',
      note: 'Primary record plus GSI1PK = ORG_ADMIN / GSI1SK = created_at.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<userSub> AND SK = METADATA',
      note: 'Reverse-lookup record so the OrgAdmin can be resolved by ID alone.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Increments org_admin_count.',
    },
  ],
  responses: {
    201: {
      description: 'The created OrgAdmin.',
      content: { 'application/json': { schema: WebAdminOrgAdminResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    409: {
      description: 'A Cognito user with this email already exists.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    500: errorResponses[500],
  },
});

registerOperation('delete', '/web-admin/organizations/{orgId}/org-admins/{userId}', {
  operationId: 'disableWebAdminOrgAdmin',
  summary: 'Disable an OrgAdmin',
  tags: ['web-admin'],
  purpose:
    'Soft-deletes an OrgAdmin — disables their Cognito account and marks the stored record DISABLED.',
  implementation: IMPLEMENTATION,
  requestParams: { path: OrgAndUserPathParams },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<userId> AND SK = METADATA',
      note: 'Reverse lookup to get the email for the Cognito disable.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<userId>',
      note: 'Sets status = DISABLED.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Decrements org_admin_count.',
    },
  ],
  responses: {
    204: { description: 'OrgAdmin disabled.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('patch', '/web-admin/organizations/{orgId}/org-admins/{userId}', {
  operationId: 'enableWebAdminOrgAdmin',
  summary: 'Re-enable a disabled OrgAdmin',
  tags: ['web-admin'],
  purpose: 'Re-activates a disabled OrgAdmin’s Cognito account and stored record.',
  implementation: IMPLEMENTATION,
  requestParams: { path: OrgAndUserPathParams },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<userId> AND SK = METADATA',
      note: 'Reverse lookup to get the email for the Cognito enable.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<userId>',
      note: 'Sets status = CONFIRMED.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Increments org_admin_count.',
    },
  ],
  responses: {
    204: { description: 'OrgAdmin re-enabled.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type WebAdminOrgAdminResponse = z.infer<typeof WebAdminOrgAdminResponse>;
export type WebAdminOrgAdminListResponse = z.infer<typeof WebAdminOrgAdminListResponse>;
export type CreateOrgAdminBody = z.infer<typeof CreateOrgAdminBody>;
