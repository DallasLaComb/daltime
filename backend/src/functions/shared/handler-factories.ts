import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { z } from '@daltime/contracts';
import { getCallerSub, getCallerGroups } from './auth.js';
import { ok, created, noContent, badRequest, setRequestOrigin, parseBody } from './response.js';
import { mapHandlerError, ForbiddenError } from './errors.js';
import { parseWithContract } from './contract-validation.js';

/** `TItem` is the contract response type for one item (e.g. `ManagerShiftResponse`). */
interface ShiftCrudService<TItem> {
  listShifts(callerSub: string, month: string | undefined): Promise<TItem[]>;
  createShift(callerSub: string, data: Record<string, unknown>): Promise<TItem>;
  updateShift(callerSub: string, shiftId: string, data: Record<string, unknown>): Promise<TItem>;
  removeShift(callerSub: string, shiftId: string): Promise<unknown>;
}

/**
 * Contract schemas for a shift-CRUD route's mutating bodies.
 *
 * Optional per-method while slices are migrated one at a time; a method with no
 * schema keeps the previous unvalidated behaviour.
 */
export interface ShiftCrudSchemas {
  /** Query string of `GET` (the `month` filter). */
  query?: z.ZodType<{ month?: string }>;
  create?: z.ZodType<Record<string, unknown>>;
  update?: z.ZodType<Record<string, unknown>>;
}

/**
 * Name the contract response type explicitly at the call site —
 * `createShiftCrudHandler<ManagerShiftResponse>(…)` — so the compiler checks that the
 * role's service returns exactly what `contracts/openapi.json` promises.
 */
export function createShiftCrudHandler<TItem>(
  service: ShiftCrudService<TItem>,
  handlerName: string,
  schemas: ShiftCrudSchemas = {},
) {
  async function handlePost(callerSub: string, rawBody: string | undefined) {
    const parsed = parseBody<Record<string, unknown>>(rawBody);
    if (!parsed.ok) return parsed.response;
    const body = schemas.create ? parseWithContract(schemas.create, parsed.data) : parsed.data;
    return ok<TItem>(await service.createShift(callerSub, body));
  }

  async function handlePut(callerSub: string, shiftId: string, rawBody: string | undefined) {
    const parsed = parseBody<Record<string, unknown>>(rawBody);
    if (!parsed.ok) return parsed.response;
    const body = schemas.update ? parseWithContract(schemas.update, parsed.data) : parsed.data;
    return ok<TItem>(await service.updateShift(callerSub, shiftId, body));
  }

  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
    const method = event.requestContext.http.method;
    const shiftId = event.pathParameters?.['shiftId'];

    if (method === 'OPTIONS') {
      setRequestOrigin(event.headers?.['origin']);
      return ok('');
    }

    setRequestOrigin(event.headers?.['origin']);

    const callerSub = getCallerSub(event);

    try {
      if (method === 'GET') {
        const { month } = schemas.query
          ? parseWithContract(schemas.query, event.queryStringParameters ?? {})
          : { month: event.queryStringParameters?.['month'] };
        return ok<TItem[]>(await service.listShifts(callerSub, month));
      }
      if (method === 'POST') return await handlePost(callerSub, event.body);
      if (method === 'PUT' && shiftId) return await handlePut(callerSub, shiftId, event.body);
      if (method === 'DELETE' && shiftId) {
        await service.removeShift(callerSub, shiftId);
        return ok('');
      }
      return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
    } catch (err) {
      return mapHandlerError(err, handlerName);
    }
  };
}

// ─── Sub-entity locations (e.g. employee-locations, manager-locations) ───────

/** `TAssignment` is the contract response type for one assignment (`UserLocationResponse`). */
interface SubEntityLocationsService<TAssignment> {
  listLocations(callerSub: string, entityId: string): Promise<TAssignment[]>;
  assignLocation(
    callerSub: string,
    entityId: string,
    body: { location_id?: string },
  ): Promise<TAssignment>;
  removeLocation(callerSub: string, entityId: string, locationId: string): Promise<unknown>;
}

/**
 * Creates a handler for sub-entity location assignment routes.
 *
 * Supports:
 *   GET    /{entityIdParam}                       → listLocations
 *   POST   /{entityIdParam}                       → assignLocation
 *   DELETE /{entityIdParam}/{locationIdParam}     → removeLocation
 *
 * @param service        Object with listLocations / assignLocation / removeLocation
 * @param entityIdParam  Path parameter key for the entity (e.g. 'employeeId', 'managerId')
 * @param handlerName    Label used in error reporting
 * @param assignSchema   Optional contract schema for the POST body, from
 *                       `@daltime/contracts`. Optional while slices are migrated
 *                       one at a time; without it the body is not validated.
 */
export function createSubEntityLocationsHandler<TAssignment>(
  service: SubEntityLocationsService<TAssignment>,
  entityIdParam: string,
  handlerName: string,
  assignSchema?: z.ZodType<{ location_id?: string }>,
) {
  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
    const method = event.requestContext.http.method;
    const entityId = event.pathParameters?.[entityIdParam];
    const locationId = event.pathParameters?.['locationId'];

    if (method === 'OPTIONS') {
      setRequestOrigin(event.headers?.['origin']);
      return ok('');
    }

    setRequestOrigin(event.headers?.['origin']);

    const callerSub = getCallerSub(event);

    try {
      if (method === 'GET') {
        if (!entityId) return badRequest(`${entityIdParam} path parameter is required`);
        return ok<TAssignment[]>(await service.listLocations(callerSub, entityId));
      }
      if (method === 'POST') {
        if (!entityId) return badRequest(`${entityIdParam} path parameter is required`);
        const parsed = parseBody<{ location_id?: string }>(event.body);
        if (!parsed.ok) return parsed.response;
        const body = assignSchema ? parseWithContract(assignSchema, parsed.data) : parsed.data;
        return created<TAssignment>(await service.assignLocation(callerSub, entityId, body));
      }
      if (method === 'DELETE') {
        if (!entityId) return badRequest(`${entityIdParam} path parameter is required`);
        if (!locationId) return badRequest('locationId path parameter is required');
        await service.removeLocation(callerSub, entityId, locationId);
        return noContent();
      }
      return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
    } catch (err) {
      return mapHandlerError(err, handlerName);
    }
  };
}

/** `TProfile` is the contract response type for the profile (e.g. `ManagerProfileResponse`). */
interface ProfileService<TProfile> {
  getProfile(callerSub: string, cognitoClient: CognitoIdentityProviderClient): Promise<TProfile>;
  updateProfile(
    callerSub: string,
    body: { first_name?: string; last_name?: string; phone?: string },
  ): Promise<TProfile>;
}

/**
 * Creates a Lambda handler for GET/PUT profile routes.
 *
 * @param service       Object implementing getProfile and updateProfile.
 * @param handlerName   Label used in error reporting and logs.
 * @param requiredGroup Optional Cognito group name (e.g. 'Employee', 'Manager').
 *                      When provided, the handler returns 403 immediately if the
 *                      caller's JWT does not include that group, preventing a
 *                      DynamoDB lookup that would surface a misleading 404 to a
 *                      caller who simply lacks the right role.
 * @param bodySchema    Optional contract schema for the PUT body, from
 *                      `@daltime/contracts`. When provided, the body is validated
 *                      against the same schema that generated this route's entry
 *                      in `contracts/openapi.json`, so a request the spec calls
 *                      invalid is rejected with a 400 before the service runs.
 *                      Left optional while slices are migrated one at a time;
 *                      once every profile slice supplies one this becomes required.
 */
export function createProfileHandler<TProfile>(
  service: ProfileService<TProfile>,
  handlerName: string,
  requiredGroup?: string,
  bodySchema?: z.ZodType<{ first_name?: string; last_name?: string; phone?: string }>,
) {
  const cognitoClient = new CognitoIdentityProviderClient({});

  return async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
    const method = event.requestContext.http.method;

    if (method === 'OPTIONS') {
      setRequestOrigin(event.headers?.['origin']);
      return ok('');
    }

    setRequestOrigin(event.headers?.['origin']);

    const callerSub = getCallerSub(event);

    try {
      // Guard: reject callers who lack the required Cognito group before any
      // DynamoDB access so they receive a 403 (not a confusing 404).
      if (requiredGroup && !getCallerGroups(event).includes(requiredGroup)) {
        throw new ForbiddenError(`${requiredGroup} role required`);
      }

      if (method === 'GET') {
        return ok<TProfile>(await service.getProfile(callerSub, cognitoClient));
      }

      if (method === 'PUT') {
        const parsed = parseBody<{ first_name?: string; last_name?: string; phone?: string }>(
          event.body,
        );
        if (!parsed.ok) return parsed.response;
        const body = bodySchema ? parseWithContract(bodySchema, parsed.data) : parsed.data;
        return ok<TProfile>(await service.updateProfile(callerSub, body));
      }

      return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
    } catch (err) {
      return mapHandlerError(err, handlerName);
    }
  };
}
