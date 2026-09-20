import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { EmployeeApiFields } from '../../entities/employee.js';
import { registerRoleOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/org-admin/employees/handler.ts',
  'backend/src/functions/org-admin/employees/service.ts',
  'backend/src/functions/org-admin/employees/db.ts',
  'backend/src/functions/shared/dynamo.ts',
  'backend/src/functions/shared/cognito.ts',
  'backend/src/functions/shared/contract-validation.ts',
];

/** An employee as an OrgAdmin manages them, enriched with live Cognito status. */
export const OrgAdminEmployeeResponse = EmployeeApiFields.meta({
  id: 'OrgAdminEmployeeResponse',
  description: 'An employee record as returned to an OrgAdmin, enriched with live Cognito status.',
});

export const OrgAdminEmployeeListResponse = z.array(OrgAdminEmployeeResponse).meta({
  id: 'OrgAdminEmployeeListResponse',
  description: 'Every employee in the caller OrgAdmin’s organization.',
});

/**
 * Body accepted by `POST /org-admin/employees`.
 *
 * Supersedes the required-field checks `shared/validation.ts`'s
 * `validateCreateUserBody` used to run inside the service, so a malformed
 * request is rejected in the handler before it ever reaches Cognito.
 *
 * `email` trims *before* validating because that is what the checks this
 * replaces did (`EMAIL_REGEX.test(body.email.trim())`) and what the service
 * stores (`body.email.trim()`). Validating first would newly reject a
 * whitespace-padded address that the API accepts today.
 */
export const CreateEmployeeBody = z
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
    // Not trimmed: the service passes temp_password to Cognito verbatim, so
    // trimming here would silently change the password the caller set. The
    // refine reproduces `!body.temp_password?.trim()`, which min(1) alone does
    // not — min(1) accepts a whitespace-only string.
    temp_password: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, 'temp_password must not be blank')
      .meta({ description: 'Temporary Cognito password. Sent verbatim — never trimmed.' }),
    manager_id: z.string().trim().optional().meta({
      description: 'Manager this employee reports to. Stored as an empty string if omitted.',
    }),
  })
  .meta({
    id: 'CreateEmployeeBody',
    description: 'Fields accepted to register a new employee via Cognito.',
  });

/**
 * Body accepted by `PUT /org-admin/employees/{employeeId}`.
 *
 * Every field is optional so the client can send a partial update, but at
 * least one must be present — the same rule `service.updateEmployee` enforces
 * today, lifted here so it is validated before the service runs.
 *
 * `manager_id` deliberately has no `min(1)`: the edit modal emits an empty
 * string when the user clears the manager select, and the service stores that
 * empty string to unassign the employee. Requiring a non-empty value would
 * make un-assigning a manager impossible.
 */
export const UpdateEmployeeBody = z
  .object({
    first_name: z.string().trim().min(1).optional(),
    last_name: z.string().trim().min(1).optional(),
    phone: z.string().trim().optional(),
    manager_id: z.string().trim().optional().meta({
      description: 'Empty string clears the employee’s manager assignment.',
    }),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'At least one field must be provided',
  )
  .meta({
    id: 'UpdateEmployeeBody',
    description: 'Partial update of an employee’s name, phone, or manager assignment.',
  });

/**
 * Path parameters for the by-id routes.
 *
 * Declared so the generated spec documents `{employeeId}` as a real parameter.
 * Without this the operation carries no `parameters`, and the frontend's typed
 * client cannot supply the value it needs to interpolate the path.
 */
const EmployeeIdPathParams = z.object({
  employeeId: z.string().meta({ description: 'Cognito sub of the employee.' }),
});

registerRoleOperation('get', '/org-admin/employees', {
  operationId: 'listOrgAdminEmployees',
  summary: 'List employees in the caller’s organization',
  tags: ['org-admin'],
  purpose:
    'Backs the org-admin employee roster screen (frontend/src/app/features/org-admin/employees). ' +
    'Resolves the caller’s org_id from their JWT sub and lists every employee in that org.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, EMPLOYEE#)',
      note: 'Key attributes are stripped and each row’s status is then replaced by a live Cognito AdminGetUser lookup.',
    },
  ],
  responses: {
    200: {
      description: 'Every employee in the org, with live Cognito status merged in.',
      content: { 'application/json': { schema: OrgAdminEmployeeListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerRoleOperation('post', '/org-admin/employees', {
  operationId: 'createOrgAdminEmployee',
  summary: 'Register a new employee',
  tags: ['org-admin'],
  purpose:
    'Creates a Cognito user in the Employee group and the corresponding DynamoDB records, from the ' +
    'org-admin employee roster screen’s "Add employee" action.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id. Runs after the Cognito user is created.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeSub>',
      note: 'Primary record, carrying GSI1PK = EMPLOYEE and GSI1SK = <created_at>. Written in parallel with the reverse-lookup record below via Promise.all.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<employeeSub> AND SK = METADATA',
      note: 'Reverse-lookup record, so the employee can be resolved by ID alone. Carries no manager_id or phone.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: CreateEmployeeBody } } },
  responses: {
    201: {
      description: 'The created employee.',
      content: { 'application/json': { schema: OrgAdminEmployeeResponse } },
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

registerRoleOperation('put', '/org-admin/employees/{employeeId}', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'updateOrgAdminEmployee',
  summary: 'Update an employee',
  tags: ['org-admin'],
  purpose:
    'Saves edits made on the org-admin employee roster screen — name, phone, or manager assignment.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Reverse lookup, used to confirm the employee belongs to the caller’s org.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Primary record; SET of updated_at plus each supplied field. Returns ALL_NEW, which becomes the response body.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Keeps first_name/last_name/updated_at on the reverse-lookup record in sync with the primary. Runs after the primary update, not in parallel.',
    },
  ],
  requestBody: { required: true, content: { 'application/json': { schema: UpdateEmployeeBody } } },
  responses: {
    200: {
      description: 'The updated employee.',
      content: { 'application/json': { schema: OrgAdminEmployeeResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerRoleOperation('delete', '/org-admin/employees/{employeeId}', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'disableOrgAdminEmployee',
  summary: 'Disable an employee',
  tags: ['org-admin'],
  purpose:
    'Soft-deletes an employee from the roster screen — disables their Cognito account and marks the ' +
    'stored record DISABLED without deleting either, preserving the audit trail.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Reverse lookup, used to confirm the employee belongs to the caller’s org and to get their email for Cognito.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Sets status = DISABLED and updated_at. Runs in parallel with the reverse-lookup update below via Promise.all, after the Cognito account is disabled.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Sets status = DISABLED to match the primary record. Does not set updated_at.',
    },
  ],
  responses: {
    204: { description: 'Employee disabled.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerRoleOperation('patch', '/org-admin/employees/{employeeId}', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'enableOrgAdminEmployee',
  summary: 'Re-enable a disabled employee',
  tags: ['org-admin'],
  purpose:
    'Reverses a disable action from the roster screen — re-activates the Cognito account and the ' +
    'stored record. Takes no request body.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Reverse lookup, used to confirm the employee belongs to the caller’s org and to get their email for Cognito.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Sets status = CONFIRMED and updated_at. Runs in parallel with the reverse-lookup update below via Promise.all, after the Cognito account is enabled.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Sets status = CONFIRMED to match the primary record. Does not set updated_at.',
    },
  ],
  responses: {
    204: { description: 'Employee re-enabled.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

export type OrgAdminEmployeeResponse = z.infer<typeof OrgAdminEmployeeResponse>;
export type OrgAdminEmployeeListResponse = z.infer<typeof OrgAdminEmployeeListResponse>;
export type CreateEmployeeBody = z.infer<typeof CreateEmployeeBody>;
export type UpdateEmployeeBody = z.infer<typeof UpdateEmployeeBody>;
