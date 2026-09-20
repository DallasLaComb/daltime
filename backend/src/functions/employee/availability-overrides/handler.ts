import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { UpsertOverridesBody } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin, parseBody } from '../../shared/response.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { mapHandlerError } from '../../shared/errors.js';
import { getAvailabilityOverrides, upsertAvailabilityOverrides } from './service.js';
import type { EmployeeAvailabilityOverridesResponse } from '@daltime/contracts';
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
      const overrides = await getAvailabilityOverrides(callerSub);
      return ok<EmployeeAvailabilityOverridesResponse>(overrides ?? {});
    }

    if (method === 'PUT') {
      const parsed = parseBody<unknown>(event.body);
      if (!parsed.ok) return parsed.response;
      // UpsertOverridesBody is the same schema that generates this route's entry
      // in contracts/openapi.json — including the YYYY-MM-DD key pattern, which
      // is now rejected here rather than only inside the service.
      const body = parseWithContract(UpsertOverridesBody, parsed.data);
      return ok<EmployeeAvailabilityOverridesResponse>(await upsertAvailabilityOverrides(callerSub, body));
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'employee availability-overrides handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withImpersonation(handleRequest);
