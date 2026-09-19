import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { ManagerApiFields } from '../../entities/manager.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/org-admin/managers/handler.ts',
  'backend/src/functions/org-admin/managers/service.ts',
  'backend/src/functions/org-admin/managers/db.ts',
  'backend/src/functions/shared/dynamo.ts',
  'backend/src/functions/shared/cognito.ts',
  'backend/src/functions/shared/contract-validation.ts',
];

/** A manager as an OrgAdmin manages them, enriched with live Cognito status. */
export const OrgAdminManagerResponse = ManagerApiFields.meta({
  id: 'OrgAdminManagerResponse',
  description: 'A manager record as returned to an OrgAdmin, enriched with live Cognito status.',
});

export const OrgAdminManagerListResponse = z.array(OrgAdminManagerResponse).meta({
  id: 'OrgAdminManagerListResponse',
  description: 'Every manager in the caller OrgAdmin’s organization.',
});

/**
 * Body accepted by `POST /org-admin/managers`.
 *
 * Supersedes the required-field checks `shared/validation.ts`'s
 * `validateCreateUserBody` used to run inside the service, so a malformed
 * request is rejected in the handler before it ever reaches Cognito.
 *
 * `email` trims *before* validating, matching both the checks this replaces
 * and what the service sends to Cognito (`body.email.trim()`).
 */
export const CreateManagerBody = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email())
      // The pipe's input schema is what a request is documented against, so the
      // email format would otherwise vanish from the spec. Runtime still checks
      // it — after the trim — so declaring it here stays truthful.
      .meta({ description: 'Cognito username. Trimmed before validation.', format: 'email' }),
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    phone: z.string().trim().optional(),
    // Not trimmed: temp_password reaches Cognito verbatim. The refine reproduces
    // `!body.temp_password?.trim()`, which min(1) alone does not.
    temp_password: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, 'temp_password must not be blank')
      .meta({ description: 'Temporary Cognito password. Sent verbatim — never trimmed.' }),
  })
  .meta({
    id: 'CreateManagerBody',
    description: 'Fields accepted to register a new manager via Cognito.',
  });

/**
 * Body accepted by `PUT /org-admin/managers/{managerId}`.
 *
 * Every field is optional so the client can send a partial update, but at
 * least one must be present — the same rule `service.updateManager` enforces
 * today, lifted here so it is validated before the service runs.
 */
export const UpdateManagerBody = z
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
    id: 'UpdateManagerBody',
    description: 'Partial update of a manager’s name or phone.',
  });

/**
 * Path parameters for the by-id routes.
 *
 * Declared so the generated spec documents `{managerId}` as a real parameter.
 * Without this the operation carries no `parameters`, and the frontend's typed
 * client cannot supply the value it needs to interpolate the path.
 */
const ManagerIdPathParams = z.object({
  managerId: z.string().meta({ description: 'Cognito sub of the manager.' }),
});

registerOperation('get', '/org-admin/managers', {
  operationId: 'listOrgAdminManagers',
  summary: 'List managers in the caller’s organization',
  tags: ['org-admin'],
  purpose:
    'Backs the org-admin manager roster screen (frontend/src/app/features/org-admin/managers). ' +
    'Resolves the caller’s org_id from their JWT sub and lists every manager in that org.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, MANAGER#)',
      note: 'Key attributes are stripped and each row’s status is then replaced by a live Cognito AdminGetUser lookup.',
    },
  ],
  responses: {
    200: {
      description: 'Every manager in the org, with live Cognito status merged in.',
      content: { 'application/json': { schema: OrgAdminManagerListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('post', '/org-admin/managers', {
  operationId: 'createOrgAdminManager',
  summary: 'Register a new manager',
  tags: ['org-admin'],
  purpose:
    'Creates a Cognito user in the Manager group and the corresponding DynamoDB records, from the ' +
    'org-admin manager roster screen’s "Add manager" action.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and their user_id, which becomes the new manager’s org_admin_id.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = MANAGER#<managerSub>',
      note: 'Primary record, carrying GSI1PK = MANAGER and GSI1SK = <created_at>. Written in parallel with the reverse-lookup record below via Promise.all.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<managerSub> AND SK = METADATA',
      note: 'Reverse-lookup record, so the manager can be resolved by ID alone. Carries no phone, org_admin_id, or employee_count.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<orgAdminId>',
      note: 'ADD manager_count :inc on the caller OrgAdmin’s own record. orgAdminId is the user_id read from the caller’s METADATA record, which is not necessarily the JWT sub (impersonation). Runs after both Puts.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: CreateManagerBody } } },
  responses: {
    201: {
      description: 'The created manager.',
      content: { 'application/json': { schema: OrgAdminManagerResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    409: {
      description: 'A Cognito user with this email already exists.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    500: errorResponses[500],
  },
});

registerOperation('put', '/org-admin/managers/{managerId}', {
  requestParams: { path: ManagerIdPathParams },
  operationId: 'updateOrgAdminManager',
  summary: 'Update a manager',
  tags: ['org-admin'],
  purpose: 'Saves edits made on the org-admin manager roster screen — name or phone.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<managerId> AND SK = METADATA',
      note: 'Reverse lookup, used to confirm the manager belongs to the caller’s org.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = MANAGER#<managerId>',
      note: 'Primary record; SET of updated_at plus each supplied field. Returns ALL_NEW, which becomes the response body.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<managerId> AND SK = METADATA',
      note: 'Keeps first_name/last_name/updated_at on the reverse-lookup record in sync with the primary. Runs after the primary update, not in parallel.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: UpdateManagerBody } } },
  responses: {
    200: {
      description: 'The updated manager.',
      content: { 'application/json': { schema: OrgAdminManagerResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('delete', '/org-admin/managers/{managerId}', {
  requestParams: { path: ManagerIdPathParams },
  operationId: 'disableOrgAdminManager',
  summary: 'Disable a manager',
  tags: ['org-admin'],
  purpose:
    'Soft-deletes a manager from the roster screen — disables their Cognito account, marks the ' +
    'stored record DISABLED, and decrements the caller OrgAdmin’s manager_count.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and own user_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<managerId> AND SK = METADATA',
      note: 'Reverse lookup, used to confirm the manager belongs to the caller’s org and to get their email for Cognito.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = MANAGER#<managerId>',
      note: 'Sets status = DISABLED and updated_at. Runs in parallel with the reverse-lookup update below via Promise.all.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<managerId> AND SK = METADATA',
      note: 'Sets status = DISABLED to match the primary record. Does not set updated_at.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = USER#<orgAdminId>',
      note: 'SET manager_count = if_not_exists(manager_count, :zero) - :dec, guarded by ConditionExpression `manager_count > :zero` so it floors at 0; a failed condition (already 0) is caught and swallowed. orgAdminId is the user_id from the caller’s METADATA record.',
    },
  ],
  responses: {
    204: { description: 'Manager disabled.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('patch', '/org-admin/managers/{managerId}', {
  requestParams: { path: ManagerIdPathParams },
  operationId: 'enableOrgAdminManager',
  summary: 'Re-enable a disabled manager',
  tags: ['org-admin'],
  purpose:
    'Reverses a disable action from the roster screen — re-activates the Cognito account and the ' +
    'stored record. Does not change manager_count. Takes no request body.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<managerId> AND SK = METADATA',
      note: 'Reverse lookup, used to confirm the manager belongs to the caller’s org and to get their email for Cognito.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = MANAGER#<managerId>',
      note: 'Sets status = CONFIRMED and updated_at. Runs in parallel with the reverse-lookup update below via Promise.all.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<managerId> AND SK = METADATA',
      note: 'Sets status = CONFIRMED to match the primary record. Does not set updated_at.',
    },
  ],
  responses: {
    204: { description: 'Manager re-enabled.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type OrgAdminManagerResponse = z.infer<typeof OrgAdminManagerResponse>;
export type OrgAdminManagerListResponse = z.infer<typeof OrgAdminManagerListResponse>;
export type CreateManagerBody = z.infer<typeof CreateManagerBody>;
export type UpdateManagerBody = z.infer<typeof UpdateManagerBody>;
