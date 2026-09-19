import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { EmployeeApiFields } from '../../entities/employee.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/org-admin/employees/handler.ts',
  'backend/src/functions/org-admin/employees/service.ts',
  'backend/src/functions/org-admin/employees/db.ts',
  'backend/src/functions/shared/dynamo.ts',
  'backend/src/functions/shared/cognito.ts',
  'backend/src/functions/shared/validation.ts',
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
 * Mirrors the required-field checks in `shared/validation.ts`'s
 * `validateCreateUserBody`, lifted here so a malformed request never reaches
 * Cognito.
 */
export const CreateEmployeeBody = z
  .object({
    email: z.email(),
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    phone: z.string().trim().optional(),
    temp_password: z.string().min(1),
    manager_id: z.string().trim().optional().meta({
      description: 'Manager this employee reports to. Empty string if omitted.',
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
 */
export const UpdateEmployeeBody = z
  .object({
    first_name: z.string().trim().min(1).optional(),
    last_name: z.string().trim().min(1).optional(),
    phone: z.string().trim().optional(),
    manager_id: z.string().trim().min(1).optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'At least one field must be provided',
  )
  .meta({
    id: 'UpdateEmployeeBody',
    description: 'Partial update of an employee’s name, phone, or manager assignment.',
  });

registerOperation('get', '/org-admin/employees', {
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

registerOperation('post', '/org-admin/employees', {
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
      note: 'Resolves the caller’s org_id.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeSub>',
      note: 'Primary record. Written in parallel with the reverse-lookup record below via Promise.all.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<employeeSub> AND SK = METADATA',
      note: 'Reverse-lookup record, so the employee can be resolved by ID alone.',
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

registerOperation('put', '/org-admin/employees/{employeeId}', {
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
      note: 'Primary record; returns ALL_NEW, which becomes the response body.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Keeps first_name/last_name on the reverse-lookup record in sync with the primary. Runs after the primary update, not in parallel.',
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

registerOperation('delete', '/org-admin/employees/{employeeId}', {
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
      note: 'Sets status = DISABLED. Runs in parallel with the reverse-lookup update below via Promise.all.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Sets status = DISABLED to match the primary record.',
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

registerOperation('patch', '/org-admin/employees/{employeeId}', {
  operationId: 'enableOrgAdminEmployee',
  summary: 'Re-enable a disabled employee',
  tags: ['org-admin'],
  purpose:
    'Reverses a disable action from the roster screen — re-activates the Cognito account and the ' +
    'stored record.',
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
      note: 'Sets status = CONFIRMED. Runs in parallel with the reverse-lookup update below via Promise.all.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Sets status = CONFIRMED to match the primary record.',
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
