import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { UpsertAvailabilityBody } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin, parseBody } from '../../shared/response.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { mapHandlerError } from '../../shared/errors.js';
import { getAvailability, upsertAvailability } from './service.js';
import type { EmployeeAvailabilityResponse } from '@daltime/contracts';
import { withImpersonation } from '../../shared/impersonation.js';

const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  const callerSub = getCallerSub(event);

  try {
    if (method === 'GET') {
      const availability = await getAvailability(callerSub);
      // Return null-safe: if no record exists yet, return an empty object so
      // the frontend knows to show an all-unavailable default state.
      return ok<EmployeeAvailabilityResponse>(availability ?? {});
    }

    if (method === 'PUT') {
      const parsed = parseBody<unknown>(event.body);
      if (!parsed.ok) return parsed.response;
      // UpsertAvailabilityBody is the same schema that generates this route's
      // entry in contracts/openapi.json, so a body the published contract calls
      // invalid is rejected with a 400 before the service runs.
      const body = parseWithContract(UpsertAvailabilityBody, parsed.data);
      return ok<EmployeeAvailabilityResponse>(await upsertAvailability(callerSub, body));
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'employee availability handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withImpersonation(handleRequest);
