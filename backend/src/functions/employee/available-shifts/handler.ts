import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { AvailableShiftsQueryParams } from '@daltime/contracts';
import { getCallerSub, getCallerGroups } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError, ForbiddenError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { listAvailableShifts } from './service.js';
import type { AvailableShiftsResponse } from '@daltime/contracts';
import { withImpersonation } from '../../shared/impersonation.js';
import { withLogging } from '../../shared/with-logging.js';

/**
 * Lambda handler for GET /employee/available-shifts.
 *
 * Returns published shifts from OTHER employees in the caller's org that have
 * been marked available_for_pickup = true for a given date.
 *
 * Required query param: ?date=YYYY-MM-DD
 * Returns 200 [] when no available shifts exist (never 404).
 * Returns 400 if the date param is missing or malformed.
 * Returns 403 if the caller is not in the Employee Cognito group.
 */
const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
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
      const { date } = parseWithContract(
        AvailableShiftsQueryParams,
        event.queryStringParameters ?? {},
      );
      return ok<AvailableShiftsResponse>(await listAvailableShifts(callerSub, date));
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'employee available-shifts handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withLogging(withImpersonation(handleRequest), 'employee-available-shifts');
