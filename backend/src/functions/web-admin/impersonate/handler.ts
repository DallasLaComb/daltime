import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import {
  ImpersonateUsersQueryParams,
  ImpersonateContextPathParams,
} from '@daltime/contracts';
import { ok, badRequest, forbidden, notFound, setRequestOrigin } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import { listImpersonatableUsers, getUserContext } from './service.js';
import { resolveProxyRoute } from './route-registry.js';
import { synthesizeImpersonatedEvent, type ImpersonationActor } from './synthesize-event.js';
import { getUserReverseLookup } from './db.js';

const cognitoClient = new CognitoIdentityProviderClient({});

/** Handles GET /web-admin/impersonate/users?orgId=&role= — lists impersonatable users. */
async function handleListUsers(event: APIGatewayProxyEventV2WithJWTAuthorizer) {
  const { orgId, role } = parseWithContract(
    ImpersonateUsersQueryParams,
    event.queryStringParameters ?? {},
  );
  return ok(await listImpersonatableUsers(orgId, role));
}

/** Handles GET /web-admin/impersonate/{userId}/context — fetches a user's profile + role. */
async function handleGetContext(userId: string) {
  return ok(await getUserContext(userId, cognitoClient));
}

/**
 * Derive the Cognito group name (role) for the impersonated user from the
 * route sub-path. The `afterUserId` path always starts with the role segment
 * (e.g. `manager/shifts/abc123`). We capitalize the first letter to produce
 * the Cognito group convention (e.g. `Manager`, `Employee`, `OrgAdmin`).
 *
 * This avoids a round-trip to Cognito — the role is already encoded in the
 * path the caller supplied, and it is validated implicitly by resolveProxyRoute
 * (which rejects unrecognised role prefixes with a 400). Providing the
 * correct cognito:groups claim in the synthesized event ensures downstream
 * handlers that call getCallerGroups see the impersonated user's role, not
 * the WebAdmin's.
 */
function deriveRoleFromPath(afterUserId: string): string {
  const firstSegment = afterUserId.split('/')[0] ?? '';
  // Convert kebab-case like "org-admin" to "OrgAdmin", and plain segments
  // like "manager" to "Manager", matching Cognito group name conventions.
  return firstSegment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Generic dispatcher: resolves the real role handler + path params for an
 * arbitrary "{role}/..." sub-path and invokes it in-process with the
 * impersonated userId substituted for the caller's own identity.
 *
 * This single function is what replaces the old per-route whitelist
 * (routeOrgAdmin/routeManager/routeEmployee and their *Proxy service
 * functions): any current or future org-admin/manager/employee route is
 * reachable here as soon as it has an entry in route-registry.ts, with zero
 * new code in this handler.
 *
 * Read-only: impersonation exists to *observe* another user's view, not to
 * act as them. Every non-GET request is rejected before any data is touched.
 * This matches the read-only guarantee both Ory and Pigment treat as the
 * heart of a safe impersonation feature. It is a coarse gate on the HTTP
 * method, so routes whose "write" is semantically a GET (none today) would
 * still pass; the method is the durable boundary here.
 */
async function dispatchToRealHandler(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  userId: string,
  afterUserId: string,
  actor: ImpersonationActor,
) {
  const method = event.requestContext.http.method;
  if (method !== 'GET') {
    return forbidden('Impersonation sessions are read-only');
  }

  // Fail closed: the impersonated userId must resolve to a real user before
  // we forward any request on their behalf — this preserves the existing
  // authorization boundary (no widening of who can be impersonated).
  const targetUser = await getUserReverseLookup(userId);
  if (!targetUser) return notFound('Impersonated user not found');

  const resolved = resolveProxyRoute(afterUserId);
  if (!resolved) {
    return badRequest(`Unhandled proxy route: ${method} ${afterUserId}`);
  }

  const { route, pathParams } = resolved;
  const realHandler = await route.loadHandler();
  // Derive the impersonated user's Cognito group from the route path prefix
  // (e.g. "manager/shifts" → "Manager") so the synthesized event carries the
  // correct cognito:groups claim, not the WebAdmin's group.
  const impersonatedUserRole = deriveRoleFromPath(afterUserId);
  const syntheticEvent = synthesizeImpersonatedEvent(
    event,
    userId,
    afterUserId,
    pathParams,
    impersonatedUserRole,
    actor,
  );
  return realHandler(syntheticEvent);
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const rawPath = event.rawPath;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    // Fail closed: only a provisioned, ACTIVE WebAdmin may request
    // impersonation. This check runs against the *caller's own* JWT claims
    // AND a DynamoDB record lookup — a Cognito group membership alone is no
    // longer sufficient. The synthesized events passed to real role handlers
    // below carry the *impersonated* user's sub, not the web admin's sub or
    // web_admin_id, so the downstream handlers cannot see the web admin's
    // identity at all. The caller's web_admin_id is available here for
    // audit logging if needed in the future.
    // Throws ForbiddenError (→ 403) if the caller is not in the WebAdmin
    // Cognito group, has no provisioned DynamoDB record, or is DISABLED.
    // The returned caller is threaded into every synthesized sub-handler event
    // as an RFC 8693 `act` claim, so an impersonated action remains
    // attributable to the WebAdmin who initiated it.
    const caller = await requireWebAdminWithLookup(event);

    if (method === 'GET' && rawPath.endsWith('/impersonate/users')) {
      return await handleListUsers(event);
    }
    if (method === 'GET' && rawPath.endsWith('/context')) {
      const { userId } = parseWithContract(
        ImpersonateContextPathParams,
        event.pathParameters ?? {},
      );
      return await handleGetContext(userId);
    }

    const userId = event.pathParameters?.['userId'];
    if (!userId) return badRequest('userId path parameter is required');

    const afterUserId = rawPath.split(`/impersonate/${userId}/`)[1] ?? '';

    return await dispatchToRealHandler(event, userId, afterUserId, caller);
  } catch (err) {
    return mapHandlerError(err, 'web-admin impersonate handler');
  }
};
