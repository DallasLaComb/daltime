import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { EmployeeApiFields } from '../../entities/employee.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/manager/employees/handler.ts',
  'backend/src/functions/manager/employees/service.ts',
  'backend/src/functions/manager/employees/db.ts',
  'backend/src/functions/shared/contract-validation.ts',
];

/**
 * An employee as a Manager manages them, enriched with live Cognito status.
 *
 * Same wire shape as the org-admin employee response — the employee entity is
 * the same stored record; only the caller scope differs.
 */
export const ManagerEmployeeResponse = EmployeeApiFields.meta({
  id: 'ManagerEmployeeResponse',
  description: 'An employee record as returned to a Manager, enriched with live Cognito status.',
});

export const ManagerEmployeeListResponse = z.array(ManagerEmployeeResponse).meta({
  id: 'ManagerEmployeeListResponse',
  description: 'Every employee reporting to the calling Manager.',
});

/**
 * Body accepted by `POST /manager/employees`.
 *
 * A manager-created employee always reports to the calling manager, so
 * `manager_id` is not accepted here (unlike the org-admin create body) — the
 * service pins it from the caller. Mirrors the create validation that
 * `shared/validation.ts`'s `validateCreateUserBody` used to run.
 */
export const CreateManagerEmployeeBody = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .meta({ description: 'Cognito username. Trimmed before validation.', format: 'email' }),
    first_name: z.string().trim().min(1),
    last_name: z.string().trim().min(1),
    phone: z.string().trim().optional(),
    temp_password: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0, 'temp_password must not be blank')
      .meta({ description: 'Temporary Cognito password. Sent verbatim — never trimmed.' }),
  })
  .meta({
    id: 'CreateManagerEmployeeBody',
    description: 'Fields accepted to register a new employee that reports to the calling manager.',
  });

/**
 * Body accepted by `PUT /manager/employees/{employeeId}`.
 *
 * Every field is optional so the client can send a partial update, but at
 * least one must be present — the same rule `service.updateEmployee` enforces.
 * `manager_id` is deliberately absent: a manager cannot reassign an employee's
 * manager.
 */
export const UpdateManagerEmployeeBody = z
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
    id: 'UpdateManagerEmployeeBody',
    description: "Partial update of an employee's name or phone.",
  });

/** Path parameters for the by-id routes. */
const EmployeeIdPathParams = z.object({
  employeeId: z.string().meta({ description: 'Cognito sub of the employee.' }),
});

registerOperation('get', '/manager/employees', {
  operationId: 'listManagerEmployees',
  summary: "List the calling manager's employees",
  tags: ['manager'],
  purpose:
    'Backs the manager employee roster screen (frontend/src/app/features/manager/employees). ' +
    'Lists only employees whose manager_id matches the caller.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, EMPLOYEE#)',
      filter: 'manager_id = <managerId>',
      note: 'Key attributes are stripped and each row’s status is then replaced by a live Cognito AdminGetUser lookup.',
    },
  ],
  responses: {
    200: {
      description: "Every employee reporting to the caller, with live Cognito status merged in.",
      content: { 'application/json': { schema: ManagerEmployeeListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('post', '/manager/employees', {
  operationId: 'createManagerEmployee',
  summary: 'Register a new employee',
  tags: ['manager'],
  purpose:
    'Creates a Cognito user in the Employee group and the corresponding DynamoDB records, from the ' +
    'manager employee roster screen’s "Add employee" action.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeSub>',
      note: 'Primary record, carrying GSI1PK = EMPLOYEE and GSI1SK = <created_at>. Written in parallel with the reverse-lookup record below.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<employeeSub> AND SK = METADATA',
      note: 'Reverse-lookup record, so the employee can be resolved by ID alone.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: CreateManagerEmployeeBody } },
  },
  responses: {
    201: {
      description: 'The created employee.',
      content: { 'application/json': { schema: ManagerEmployeeResponse } },
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

registerOperation('put', '/manager/employees/{employeeId}', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'updateManagerEmployee',
  summary: 'Update an employee',
  tags: ['manager'],
  purpose:
    'Saves edits made on the manager employee roster screen — name or phone. Rejects updating an ' +
    'employee that does not report to the caller.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Fetches the employee to confirm they report to the caller.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Primary record; SET of updated_at plus each supplied field. Returns ALL_NEW.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = USER#<employeeId> AND SK = METADATA',
      note: 'Keeps first_name/last_name/updated_at on the reverse-lookup record in sync.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: UpdateManagerEmployeeBody } },
  },
  responses: {
    200: {
      description: 'The updated employee.',
      content: { 'application/json': { schema: ManagerEmployeeResponse } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    500: errorResponses[500],
  },
});

registerOperation('delete', '/manager/employees/{employeeId}', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'disableManagerEmployee',
  summary: 'Disable an employee',
  tags: ['manager'],
  purpose:
    'Soft-deletes an employee from the roster screen — disables their Cognito account and marks the ' +
    'stored record DISABLED without deleting either.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Fetches the employee to confirm they report to the caller and get the email for Cognito.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Sets status = DISABLED.',
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

registerOperation('patch', '/manager/employees/{employeeId}', {
  requestParams: { path: EmployeeIdPathParams },
  operationId: 'enableManagerEmployee',
  summary: 'Re-enable a disabled employee',
  tags: ['manager'],
  purpose:
    'Reverses a disable action from the roster screen — re-activates the Cognito account and the ' +
    'stored record. Takes no request body.',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and manager_id.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Fetches the employee to confirm they report to the caller and get the email for Cognito.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Sets status = CONFIRMED.',
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

export type ManagerEmployeeResponse = z.infer<typeof ManagerEmployeeResponse>;
export type ManagerEmployeeListResponse = z.infer<typeof ManagerEmployeeListResponse>;
export type CreateManagerEmployeeBody = z.infer<typeof CreateManagerEmployeeBody>;
export type UpdateManagerEmployeeBody = z.infer<typeof UpdateManagerEmployeeBody>;
