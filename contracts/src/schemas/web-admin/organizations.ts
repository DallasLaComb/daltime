import * as z from 'zod';
import { errorResponses } from '../common.js';
import { OrganizationApiFields } from '../../entities/organization.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/web-admin/organizations/handler.ts',
  'backend/src/functions/web-admin/organizations/service.ts',
  'backend/src/functions/web-admin/organizations/db.ts',
];

/** An organization as web-admin manages it. */
export const WebAdminOrganizationResponse = OrganizationApiFields.meta({
  id: 'WebAdminOrganizationResponse',
  description: 'An organization as returned to a WebAdmin.',
});

export const WebAdminOrganizationListResponse = z.array(WebAdminOrganizationResponse).meta({
  id: 'WebAdminOrganizationListResponse',
  description: 'Every organization.',
});

/** Path parameter for the by-id routes. */
const OrgIdPathParams = z.object({
  orgId: z.string().meta({ description: 'The organization’s org_id.' }),
});

/** Body accepted by `POST /organizations`. */
export const CreateOrganizationBody = z
  .object({
    name: z.string().trim().min(1),
    address: z.string().trim().min(1),
  })
  .meta({
    id: 'CreateOrganizationBody',
    description: 'Fields accepted to create a new organization.',
  });

/** Body accepted by `PUT /organizations/{orgId}` — both fields optional, at least one implied. */
export const UpdateOrganizationBody = z
  .object({
    name: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1).optional(),
  })
  .meta({
    id: 'UpdateOrganizationBody',
    description: 'Partial update of an organization’s name and/or address.',
  });

registerOperation('get', '/organizations', {
  operationId: 'listWebAdminOrganizations',
  summary: 'List all organizations',
  tags: ['web-admin'],
  purpose:
    'Backs the web-admin organization list screen (frontend/src/app/features/web-admin/organizations).',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Query',
      keyCondition: 'GSI1PK = ORG',
      note: 'GSI1 query returns every organization (cross-org inventory view).',
    },
  ],
  responses: {
    200: {
      description: 'Every organization.',
      content: { 'application/json': { schema: WebAdminOrganizationListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('post', '/organizations', {
  operationId: 'createWebAdminOrganization',
  summary: 'Create an organization',
  tags: ['web-admin'],
  purpose: 'Creates a new organization and stamps the creating web-admin for audit.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Primary record plus GSI1PK = ORG / GSI1SK = created_at.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: CreateOrganizationBody } } },
  responses: {
    201: {
      description: 'The created organization.',
      content: { 'application/json': { schema: WebAdminOrganizationResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('get', '/organizations/{orgId}', {
  requestParams: { path: OrgIdPathParams },
  operationId: 'getWebAdminOrganization',
  summary: 'Get an organization',
  tags: ['web-admin'],
  purpose: 'Fetches a single organization by id.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Point read of the organization record.',
    },
  ],
  responses: {
    200: {
      description: 'The organization.',
      content: { 'application/json': { schema: WebAdminOrganizationResponse } },
    },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('put', '/organizations/{orgId}', {
  requestParams: { path: OrgIdPathParams },
  operationId: 'updateWebAdminOrganization',
  summary: 'Update an organization',
  tags: ['web-admin'],
  purpose: 'Saves edits to an organization’s name and/or address, stamping the acting web-admin.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Reads the existing record to carry over unspecified fields.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Sets name/address/updated_at; ALL_NEW becomes the response.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: UpdateOrganizationBody } } },
  responses: {
    200: {
      description: 'The updated organization.',
      content: { 'application/json': { schema: WebAdminOrganizationResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('delete', '/organizations/{orgId}', {
  requestParams: { path: OrgIdPathParams },
  operationId: 'deleteWebAdminOrganization',
  summary: 'Delete an organization',
  tags: ['web-admin'],
  purpose: 'Hard-deletes an organization by id.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Confirms the organization exists.',
    },
    {
      command: 'Delete',
      keyCondition: 'PK = ORG#<orgId> AND SK = METADATA',
      note: 'Deletes the organization record.',
    },
  ],
  responses: {
    204: { description: 'Organization deleted.' },
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type WebAdminOrganizationResponse = z.infer<typeof WebAdminOrganizationResponse>;
export type WebAdminOrganizationListResponse = z.infer<typeof WebAdminOrganizationListResponse>;
export type CreateOrganizationBody = z.infer<typeof CreateOrganizationBody>;
export type UpdateOrganizationBody = z.infer<typeof UpdateOrganizationBody>;
