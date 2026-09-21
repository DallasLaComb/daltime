import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { UpdateOrgAdminOrganizationBody } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin, parseBody } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { getOrganization, updateOrganization } from './service.js';
import type { OrgAdminOrganizationResponse } from '@daltime/contracts';
import { withImpersonation } from '../../shared/impersonation.js';
import { withLogging } from '../../shared/with-logging.js';

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
      return ok<OrgAdminOrganizationResponse>(await getOrganization(callerSub));
    }

    if (method === 'PUT') {
      const parsed = parseBody<Record<string, unknown>>(event.body);
      if (!parsed.ok) return parsed.response;
      const body = parseWithContract(UpdateOrgAdminOrganizationBody, parsed.data);
      return ok<OrgAdminOrganizationResponse>(await updateOrganization(callerSub, body));
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'org-admin organization handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withLogging(withImpersonation(handleRequest), 'org-admin-organization');
