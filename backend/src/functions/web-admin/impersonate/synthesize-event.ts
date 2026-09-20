import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { WebAdminCaller } from '@daltime/contracts';
import { decodeLocalJwtPayload } from '../../shared/auth.js';

/**
 * The acting WebAdmin, preserved on the synthesized event so an impersonated
 * action stays attributable to the human who initiated it.
 */
export type ImpersonationActor = Pick<WebAdminCaller, 'sub' | 'web_admin_id'>;

/**
 * Resolve the JWT claims for the caller of this impersonate handler.
 *
 * In deployed environments (dev/qa/prod), API Gateway's JWT authorizer always
 * populates `requestContext.authorizer.jwt.claims` before the Lambda runs, so
 * we read claims directly from there. This is the normal, production path.
 *
 * In SAM local, `sam local start-api` logs "Linking authorizer skipped" and
 * never populates `requestContext.authorizer`, so we fall back to decoding the
 * `Authorization: Bearer <token>` header directly using `decodeLocalJwtPayload`
 * from `shared/auth.ts`. No signature verification is performed on this path —
 * it is safe only because this path is structurally unreachable in deployed
 * environments (API Gateway always provides authorizer claims there).
 *
 * Returns null when running SAM local and the Authorization header is missing
 * or malformed, allowing `synthesizeImpersonatedEvent` to surface a clear
 * error rather than crashing.
 */
function resolveCallerClaims(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Record<string, unknown> | null {
  // Deployed path: authorizer claims are present — use them directly.
  if (event.requestContext?.authorizer?.jwt?.claims) {
    return event.requestContext.authorizer.jwt.claims as Record<string, unknown>;
  }

  // SAM-local fallback path: authorizer is absent; decode the Bearer token
  // from the Authorization header. This branch is dead code in deployed
  // environments because API Gateway always sets authorizer before Lambda runs.
  const authHeader = event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '';
  return decodeLocalJwtPayload(authHeader);
}

/**
 * Build the synthetic event passed to a real role handler when Web-Admin is
 * impersonating a user.
 *
 * Why: every real handler resolves its caller via `getCallerSub(event)`,
 * which reads `event.requestContext.authorizer.jwt.claims.sub` first. To
 * make impersonation transparent to the real handler (no special-casing
 * required inside org-admin/manager/employee handlers), we clone the
 * original event and overwrite that claim with the impersonated userId,
 * and rewrite the path/pathParameters/rawPath to look exactly like a direct
 * call to that real route — the real handler can't tell the difference.
 *
 * We also overwrite `cognito:groups` with the impersonated user's role so
 * that any downstream handler calling `getCallerGroups` sees the impersonated
 * user's group, not the WebAdmin's group. Without this, a handler that checks
 * group membership (e.g. to gate manager-only actions) would see 'WebAdmin'
 * as the caller's group and potentially behave incorrectly or grant elevated
 * access to the impersonated identity.
 *
 * The Web-Admin's own JWT is still what was verified by API Gateway's
 * authorizer before this Lambda ran, so authentication is unaffected — only
 * the *identity the downstream business logic sees* is substituted, and
 * only after this Lambda's own authn/authz already accepted the caller.
 *
 * The acting WebAdmin is preserved alongside the substituted subject as
 * flattened RFC 8693 `act` claims (`act_sub`, `act_web_admin_id`). API
 * Gateway's JWT authorizer coerces every claim to a primitive, so the nested
 * `act: { sub }` object form cannot be represented in this event type — the
 * flattened form carries the same information. Ory and Pigment both treat
 * losing the actor as the cardinal impersonation sin: the subject must never
 * become the only identity in the request. The `act_*` claims are additive:
 * downstream handlers' `getCallerSub`/`getCallerGroups` are unaffected, and
 * audit code can attribute the action without touching any role handler.
 *
 * Throws a descriptive Error when running SAM local and the Authorization
 * header is missing or malformed — this surfaces a clear message rather than
 * a silent crash or a misleading TypeError.
 */
export function synthesizeImpersonatedEvent(
  originalEvent: APIGatewayProxyEventV2WithJWTAuthorizer,
  impersonatedUserId: string,
  realPath: string,
  pathParams: Record<string, string>,
  impersonatedUserRole: string,
  actor: ImpersonationActor,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  // Resolve the base claims from either the authorizer (deployed) or the
  // Authorization header (SAM local). The result must be non-null before we
  // can build the synthesized event.
  const baseClaims = resolveCallerClaims(originalEvent);
  if (!baseClaims) {
    throw new Error(
      'synthesizeImpersonatedEvent: could not resolve caller JWT claims. ' +
        'In SAM local, ensure the request carries a valid Authorization: Bearer <token> header. ' +
        'In deployed environments this should never happen (API Gateway always populates requestContext.authorizer).',
    );
  }

  const rawPathPrefix = originalEvent.rawPath.split(`/${impersonatedUserId}/`)[0];

  return {
    ...originalEvent,
    rawPath: `${rawPathPrefix}/${impersonatedUserId}/${realPath}`,
    pathParameters: { ...pathParams },
    requestContext: {
      ...originalEvent.requestContext,
      authorizer: {
        // Spread the existing authorizer shape if present (deployed path),
        // otherwise construct a minimal valid authorizer shape (SAM local path)
        // using the decoded header claims. Both paths substitute sub and
        // cognito:groups with the impersonated user's values.
        ...(originalEvent.requestContext?.authorizer ?? {}),
        jwt: {
          ...(originalEvent.requestContext?.authorizer?.jwt ?? {}),
          claims: {
            ...baseClaims,
            sub: impersonatedUserId,
            'cognito:groups': impersonatedUserRole,
            // RFC 8693 actor claims, flattened because API Gateway coerces
            // every JWT claim to a primitive string.
            act_sub: actor.sub,
            act_web_admin_id: actor.web_admin_id,
          },
        },
      },
    },
  };
}
