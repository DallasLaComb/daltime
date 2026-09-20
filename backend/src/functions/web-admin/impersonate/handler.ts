import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  ImpersonateUsersQueryParams,
  ImpersonateContextPathParams,
} from '@daltime/contracts';
import type { ImpersonateContextResponse, ImpersonateUserListResponse } from '@daltime/contracts';
import { ok, badRequest, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import { listImpersonatableUsers, getUserContext } from './service.js';

const cognitoClient = new CognitoIdentityProviderClient({});

/** Handles GET /web-admin/impersonate/users?orgId=&role= — lists impersonatable users. */
async function handleListUsers(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const { orgId, role } = parseWithContract(
    ImpersonateUsersQueryParams,
    event.queryStringParameters ?? {},
  );
  return ok<ImpersonateUserListResponse>(await listImpersonatableUsers(orgId, role));
}

/** Handles GET /web-admin/impersonate/{userId}/context — fetches a user's profile + role. */
async function handleGetContext(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const { userId } = parseWithContract(ImpersonateContextPathParams, event.pathParameters ?? {});
  return ok<ImpersonateContextResponse>(await getUserContext(userId, cognitoClient));
}

/**
 * The impersonation PICKER: lists who a WebAdmin may view as, and describes one user.
 *
 * Acting as a user is NOT done here. The frontend adds `X-Impersonate-User: <userId>` to the
 * ordinary role request (`GET /manager/shifts`, …) and each role Lambda resolves it itself in
 * `withImpersonation` (shared/impersonation.ts) — so impersonated calls land on real, documented
 * routes instead of a `{proxy+}` catch-all this Lambda used to re-dispatch in-process.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    // Fail closed: only a provisioned, ACTIVE WebAdmin may list or describe users. This checks
    // the caller's JWT group AND their DynamoDB record, so disabling a WebAdmin in the table
    // takes effect immediately. Throws ForbiddenError (→ 403) otherwise.
    await requireWebAdminWithLookup(event);

    if (method === 'GET' && rawPath.endsWith('/impersonate/users')) {
      return await handleListUsers(event);
    }
    if (method === 'GET' && rawPath.endsWith('/context')) {
      return await handleGetContext(event);
    }

    return badRequest(`Unhandled route: ${method} ${rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'web-admin impersonate handler');
  }
};
