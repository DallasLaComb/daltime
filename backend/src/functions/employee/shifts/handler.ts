import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ShiftsQueryParams } from '@daltime/contracts';
import { getCallerSub, getCallerGroups } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError, ForbiddenError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { listMyShifts } from './service.js';

/**
 * Lambda handler for GET /employee/shifts.
 *
 * Accepts one of three mutually exclusive query params to define the time window:
 *   ?month=YYYY-MM   — all shifts for a calendar month
 *   ?date=YYYY-MM-DD — shifts for a single day
 *   ?week=YYYY-MM-DD — shifts for a 7-day window starting on the given date (week-start)
 *
 * Returns 400 if none or more than one param is provided, or if the format is invalid.
 * Returns 403 if the caller is not in the Employee Cognito group.
 * Results are scoped to the caller's own shifts within their org.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    // Enforce Employee role — the API Gateway JWT authorizer verifies the token
    // is well-signed but does not check group membership, so we must do it here.
    if (!getCallerGroups(event).includes('Employee')) {
      throw new ForbiddenError('Employee role required');
    }

    const callerSub = getCallerSub(event);

    if (method === 'GET') {
      const query = parseWithContract(ShiftsQueryParams, event.queryStringParameters ?? {});
      return ok(await listMyShifts(callerSub, query));
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'employee shifts handler');
  }
};
