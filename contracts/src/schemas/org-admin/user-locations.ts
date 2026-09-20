import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { UserLocationApiFields } from '../../entities/location.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/org-admin/manager-locations/handler.ts',
  'backend/src/functions/org-admin/manager-locations/service.ts',
  'backend/src/functions/org-admin/manager-locations/db.ts',
  'backend/src/functions/org-admin/employee-locations/handler.ts',
  'backend/src/functions/org-admin/employee-locations/service.ts',
  'backend/src/functions/org-admin/employee-locations/db.ts',
  'backend/src/functions/shared/handler-factories.ts',
];

/**
 * A user–location assignment, as returned by the manage/employee location routes.
 * `user_type` is either MANAGER or EMPLOYEE depending on the route.
 */
export const UserLocationResponse = UserLocationApiFields.meta({ id: 'UserLocationResponse' });
export const UserLocationListResponse = z.array(UserLocationResponse).meta({
  id: 'UserLocationListResponse',
  description: 'The locations assigned to a manager or employee.',
});

/** Body accepted by the assign routes — a single location id. */
export const AssignUserLocationBody = z
  .object({
    location_id: z.string().min(1),
  })
  .meta({
    id: 'AssignUserLocationBody',
    description: 'The location to assign to the manager/employee.',
  });

// A single manager- or employee- location sub-resource.
function registerUserLocationRoutes(
  entity: 'manager' | 'employee',
  entityIdParam: string,
  entityType: 'MANAGER' | 'EMPLOYEE',
): void {
  const base = `/org-admin/${entity}s/{${entityIdParam}}/locations`;
  const entityIdPath = z
    .object({ [entityIdParam]: z.string().meta({ description: `Cognito sub of the ${entity}.` }) })
    .meta({ id: `${entity === 'manager' ? 'Manager' : 'Employee'}IdPathParams` });
  const entityAndLocationPath = z
    .object({
      [entityIdParam]: z.string().meta({ description: `Cognito sub of the ${entity}.` }),
      locationId: z.string().meta({ description: 'The location’s location_id.' }),
    })
    .meta({ id: `${entity === 'manager' ? 'Manager' : 'Employee'}LocationPathParams` });

  registerOperation('get', base, {
    operationId: `list${entity === 'manager' ? 'Manager' : 'Employee'}AssignedLocations`,
    summary: `List a ${entity}'s assigned locations`,
    tags: ['org-admin'],
    purpose: `Lists the locations assigned to a given ${entity} under the org-admin's organization.`,
    implementation: IMPLEMENTATION,
    requestParams: { path: entityIdPath },
    dynamodb: [
      { command: 'Get', keyCondition: 'PK = USER#<callerSub> AND SK = METADATA', note: 'Resolves the caller’s org_id.' },
      { command: 'Query', keyCondition: `PK = USER#<${entityIdParam}> AND begins_with(SK, LOCATION#)`, note: 'Lists the entity’s assigned locations with key attributes stripped.' },
    ],
    responses: {
      200: { description: `The ${entity}'s assigned locations.`, content: { 'application/json': { schema: UserLocationListResponse } } },
      403: errorResponses[403],
      404: errorResponses[404],
      500: errorResponses[500],
    },
  });

  registerOperation('post', base, {
    operationId: `assign${entity === 'manager' ? 'Manager' : 'Employee'}Location`,
    summary: `Assign a location to a ${entity}`,
    tags: ['org-admin'],
    purpose: `Assigns a location to a ${entity} in the org-admin's organization.`,
    implementation: IMPLEMENTATION,
    requestParams: { path: entityIdPath },
    requestBody: { required: true, content: { 'application/json': { schema: AssignUserLocationBody } } },
    dynamodb: [
      { command: 'Get', keyCondition: 'PK = USER#<callerSub> AND SK = METADATA', note: 'Resolves the caller’s org_id and user_id.' },
      { command: 'Get', keyCondition: `PK = ORG#<orgId> AND SK = ${entityType}#<${entityIdParam}>`, note: 'Verifies the entity belongs to the caller’s org.' },
      { command: 'Get', keyCondition: 'PK = ORG#<orgId> AND SK = LOCATION#<locationId>', note: 'Verifies the location belongs to the caller’s org.' },
      { command: 'Put', keyCondition: `PK = USER#<${entityIdParam}> AND SK = LOCATION#<locationId>`, note: 'Writes the assignment record with denormalized location_name.' },
    ],
    responses: {
      201: { description: 'The created assignment.', content: { 'application/json': { schema: UserLocationResponse } } },
      400: errorResponses[400],
      403: errorResponses[403],
      404: errorResponses[404],
      409: { description: `Manager/employee already assigned to this location.`, content: { 'application/json': { schema: ErrorResponse } } },
      500: errorResponses[500],
    },
  });

  registerOperation('delete', `${base}/{locationId}`, {
    operationId: `remove${entity === 'manager' ? 'Manager' : 'Employee'}Location`,
    summary: `Remove a location from a ${entity}`,
    tags: ['org-admin'],
    purpose: `Removes a location assignment from a ${entity} in the org-admin's organization.`,
    implementation: IMPLEMENTATION,
    requestParams: { path: entityAndLocationPath },
    dynamodb: [
      { command: 'Get', keyCondition: 'PK = USER#<callerSub> AND SK = METADATA', note: 'Resolves the caller’s org_id.' },
      { command: 'Get', keyCondition: `PK = ORG#<orgId> AND SK = ${entityType}#<${entityIdParam}>`, note: 'Verifies the entity belongs to the caller’s org.' },
      { command: 'Delete', keyCondition: `PK = USER#<${entityIdParam}> AND SK = LOCATION#<locationId>`, note: 'Deletes the assignment record.' },
    ],
    responses: {
      204: { description: 'Assignment removed.' },
      403: errorResponses[403],
      404: errorResponses[404],
      500: errorResponses[500],
    },
  });
}

registerUserLocationRoutes('manager', 'managerId', 'MANAGER');
registerUserLocationRoutes('employee', 'employeeId', 'EMPLOYEE');

export type UserLocationResponse = z.infer<typeof UserLocationResponse>;
export type UserLocationListResponse = z.infer<typeof UserLocationListResponse>;
export type AssignUserLocationBody = z.infer<typeof AssignUserLocationBody>;
