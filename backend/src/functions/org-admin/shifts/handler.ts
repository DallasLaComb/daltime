import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { OrgAdminShiftsQuery } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { listShifts } from './service.js';
import type { OrgAdminShiftListResponse } from '@daltime/contracts';
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
      const { month } = parseWithContract(OrgAdminShiftsQuery, event.queryStringParameters ?? {});
      return ok<OrgAdminShiftListResponse>(await listShifts(callerSub, month));
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'org-admin shifts handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withImpersonation(handleRequest);
