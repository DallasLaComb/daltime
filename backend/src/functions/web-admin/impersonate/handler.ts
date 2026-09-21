import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  ImpersonateUsersQueryParams,
  ImpersonateContextPathParams,
  ImpersonateSessionPathParams,
  StartImpersonationSessionBody,
} from '@daltime/contracts';
import type {
  ImpersonateContextResponse,
  ImpersonateUserListResponse,
  ImpersonateSessionResponse,
} from '@daltime/contracts';
import { ok, created, noContent, badRequest, setRequestOrigin, parseBody } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import { listImpersonatableUsers, getUserContext } from './service.js';
import { createSession, deleteSession, isRoleMember } from './db.js';
import { withLogging } from '../../shared/with-logging.js';

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

/** Handles POST /web-admin/impersonate/sessions — start a time-bound impersonation session. */
async function handleStartSession(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const actor = await requireWebAdminWithLookup(event);
  const parsed = parseBody<Record<string, unknown>>(event.body ?? undefined);
  if (!parsed.ok) return parsed.response;
  const { target_user_id, role } = parseWithContract(StartImpersonationSessionBody, parsed.data);
  if (!(await isRoleMember(target_user_id, role))) {
    return badRequest('Target user not found for the requested role');
  }
  const session = await createSession(actor, target_user_id, role);
  return created<ImpersonateSessionResponse>({
    session_id: session.session_id,
    target_user_id: session.target_user_id,
    role: session.role,
    expires_at: session.expires_at,
  });
}

/** Handles DELETE /web-admin/impersonate/sessions/{sessionId} — end an impersonation session. */
async function handleEndSession(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const actor = await requireWebAdminWithLookup(event);
  // Validate the path param format; we key only by actor_sub so the actor ends their own session.
  parseWithContract(ImpersonateSessionPathParams, event.pathParameters ?? {});
  await deleteSession(actor.sub);
  return noContent();
}

/**
 * The impersonation PICKER: lists who a WebAdmin may view as, and describes one user.
 *
 * Acting as a user is NOT done here. The frontend adds `X-Impersonate-User: <userId>` to the
 * ordinary role request (`GET /manager/shifts`, …) and each role Lambda resolves it itself in
 * `withImpersonation` (shared/impersonation.ts) — so impersonated calls land on real, documented
 * routes instead of a `{proxy+}` catch-all this Lambda used to re-dispatch in-process.
 */
const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    if (method === 'GET' && rawPath.endsWith('/impersonate/users')) {
      await requireWebAdminWithLookup(event);
      return await handleListUsers(event);
    }
    if (method === 'GET' && rawPath.endsWith('/context')) {
      await requireWebAdminWithLookup(event);
      return await handleGetContext(event);
    }
    if (method === 'POST' && rawPath.endsWith('/impersonate/sessions')) {
      return await handleStartSession(event);
    }
    if (method === 'DELETE' && rawPath.includes('/impersonate/sessions/')) {
      return await handleEndSession(event);
    }

    return badRequest(`Unhandled route: ${method} ${rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'web-admin impersonate handler');
  }
};

export const handler = withLogging(handleRequest, 'web-admin-impersonate');
