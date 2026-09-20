import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { ImpersonatableRole } from '@daltime/contracts';
import { requireWebAdminWithLookup, decodeLocalJwtPayload } from './auth.js';
import { badRequest, forbidden, notFound, setRequestOrigin } from './response.js';
import { mapHandlerError } from './errors.js';
import { isRoleMember } from '../web-admin/impersonate/db.js';

/**
 * Impersonation: the single chokepoint.
 *
 * A WebAdmin views the app as another user by adding `X-Impersonate-User: <userId>` to an
 * ordinary role request (`GET /manager/shifts`, …). Every employee / manager / org-admin
 * Lambda wraps its handler in `withImpersonation`, so the request lands on the real,
 * documented, typed route — no path rewriting, no catch-all proxy, no route registry.
 *
 * With no header the wrapper is a pass-through: normal traffic pays nothing and behaves
 * exactly as before. With the header it, in order:
 *
 *   1. requires the caller to be a provisioned, ACTIVE WebAdmin (Cognito group AND DynamoDB
 *      record) — a non-WebAdmin who sends the header gets a 403, never a silent ignore;
 *   2. rejects anything but GET (read-only) BEFORE touching the target;
 *   3. derives the role from the route (`/manager/...` → Manager) and verifies the target
 *      really is a member of that role;
 *   4. hands the real handler an event whose identity claims are the TARGET's
 *      (`sub`, `cognito:groups`) plus the actor as flattened RFC 8693 `act_*` claims, so
 *      `getCallerSub` / `getCallerGroups` need no special-casing anywhere.
 *
 * Failure mode if a role handler is ever left unwrapped: the header is ignored and the
 * WebAdmin acts as themselves, so the handler's own role check answers 403. It cannot
 * widen access.
 */

/** HTTP API delivers header names lower-cased. */
export const IMPERSONATE_HEADER = 'x-impersonate-user';

/** First path segment → the Cognito group that route serves. Anything else is not impersonatable. */
const ROUTE_ROLE: Record<string, ImpersonatableRole> = {
  'org-admin': 'OrgAdmin',
  manager: 'Manager',
  employee: 'Employee',
};

/**
 * Cognito subs are UUIDs; this is deliberately looser but still excludes `#`, `,` and
 * whitespace — the id is interpolated into DynamoDB keys, and a comma means the header
 * was sent twice (API Gateway joins duplicates).
 */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The acting WebAdmin, preserved on the effective event so an impersonated action stays
 * attributable to the human who initiated it.
 */
export interface ImpersonationActor {
  sub: string;
  web_admin_id: string;
}

type Handler<R> = (event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<R>;

/** Read the impersonation header, case-insensitively (SAM local does not always lower-case). */
export function readImpersonationHeader(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): string | undefined {
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (name.toLowerCase() === IMPERSONATE_HEADER) return value;
  }
  return undefined;
}

/** The role a route serves, from its first path segment, or undefined for non-role routes. */
export function roleForPath(rawPath: string): ImpersonatableRole | undefined {
  const first = rawPath.split('/').filter(Boolean)[0] ?? '';
  return ROUTE_ROLE[first];
}

/**
 * The caller's verified JWT claims. Deployed: from API Gateway's authorizer. SAM local has no
 * authorizer, so fall back to decoding the Authorization header (never reachable in deployed
 * environments, where the authorizer is always present).
 */
function callerClaims(event: APIGatewayProxyEventV2WithJWTAuthorizer): Record<string, unknown> {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (claims) return claims as Record<string, unknown>;
  const authHeader = event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '';
  const decoded = decodeLocalJwtPayload(authHeader);
  if (!decoded) throw new Error('withImpersonation: could not resolve caller JWT claims');
  return decoded;
}

/**
 * The event a role handler sees for an impersonated request: identity claims replaced by the
 * target's, the actor kept alongside as `act_*`, and the impersonation header removed so the
 * request is indistinguishable from the target's own.
 *
 * `act_sub` / `act_web_admin_id` are flattened RFC 8693 `act` claims — API Gateway coerces every
 * JWT claim to a primitive, so the nested `act: { sub }` form cannot be represented here.
 */
export function buildImpersonatedEvent(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  targetUserId: string,
  role: ImpersonatableRole,
  actor: ImpersonationActor,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).filter(([name]) => name.toLowerCase() !== IMPERSONATE_HEADER),
  );
  return {
    ...event,
    headers,
    requestContext: {
      ...event.requestContext,
      authorizer: {
        ...(event.requestContext?.authorizer ?? {}),
        jwt: {
          ...(event.requestContext?.authorizer?.jwt ?? {}),
          claims: {
            ...callerClaims(event),
            sub: targetUserId,
            'cognito:groups': role,
            act_sub: actor.sub,
            act_web_admin_id: actor.web_admin_id,
          },
        },
      },
    },
  };
}

/**
 * Wrap a role handler so a WebAdmin can call it on behalf of another user. See the file
 * comment for the full contract.
 */
export function withImpersonation<R>(inner: Handler<R>): Handler<R | APIGatewayProxyResultV2> {
  return async (event) => {
    const requested = readImpersonationHeader(event);
    const method = event.requestContext?.http?.method;

    // Normal traffic — and CORS preflight, which never carries the header — is untouched.
    if (requested === undefined || method === 'OPTIONS') return inner(event);

    setRequestOrigin(event.headers?.['origin']);

    try {
      // Fail closed on identity first, so a non-WebAdmin learns nothing about routes or targets.
      const actor = await requireWebAdminWithLookup(event);

      if (method !== 'GET') return forbidden('Impersonation sessions are read-only');

      const targetUserId = requested.trim();
      if (!USER_ID_PATTERN.test(targetUserId)) {
        return badRequest(`Invalid ${IMPERSONATE_HEADER} header`);
      }

      const role = roleForPath(event.rawPath);
      if (!role) return badRequest('Impersonation is not supported on this route');

      if (!(await isRoleMember(targetUserId, role))) {
        return notFound('Impersonated user not found');
      }

      // Structured audit line: who acted as whom, on what. No PII beyond opaque ids.
      console.info(
        JSON.stringify({
          audit: 'impersonation',
          actor_web_admin_id: actor.web_admin_id,
          actor_sub: actor.sub,
          target_user_id: targetUserId,
          role,
          method,
          path: event.rawPath,
        }),
      );

      return await inner(buildImpersonatedEvent(event, targetUserId, role, actor));
    } catch (err) {
      return mapHandlerError(err, 'withImpersonation');
    }
  };
}
