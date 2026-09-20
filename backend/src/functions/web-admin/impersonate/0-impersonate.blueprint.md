# Blueprint: Web Admin Impersonation

Web admins need to navigate the app _as_ any other user (OrgAdmin, Manager, Employee) to debug issues and verify what those users see. The web-admin's own JWT is always used for network calls and is what API Gateway authenticates — only the _identity the downstream business logic sees_ is substituted. The frontend uses an `ImpersonationInterceptor` to rewrite outbound role-prefixed URLs through these proxy endpoints; that interceptor is fully generic and required no change for this mechanism.

---

## How the generic dispatch works (plain language)

Historically, every real feature route (e.g. `manager/shifts`, `org-admin/notifications`) needed a second, hand-written copy registered here — both a matching `if`/regex case in this handler and a matching event in `infra/template.yaml`. That hand-maintained whitelist chronically lagged behind real feature growth: entire route groups went unreachable through impersonation for months at a time.

The proxy now works like this instead:

1. A single catch-all API Gateway route, `/web-admin/impersonate/{userId}/{proxy+}`, accepts GET/POST/PUT/PATCH/DELETE for any path shape under it.
2. The handler strips the `/impersonate/{userId}/` prefix to get the "real" sub-path (e.g. `manager/shifts/abc123`).
3. It confirms `{userId}` resolves to a real user (fail-closed — no widening of who can be impersonated).
4. A route registry (`route-registry.ts`) matches that sub-path against a table of API-Gateway-style patterns (e.g. `manager/shifts/{shiftId}`) — the same pattern syntax already used in `infra/template.yaml`. The first match wins and identifies which real Lambda handler module owns that route.
5. The handler **dynamically imports the real handler module and calls it in-process**, passing a cloned copy of the original event with the impersonated `userId` substituted for the Web-Admin's own resolved Cognito sub in the JWT claims, and the path/pathParameters rewritten to look exactly like a direct call to the real route.
6. The real handler runs completely unmodified — it cannot tell the difference between a direct call and an impersonated one. Its own authz/data-scoping logic (which always derives the caller from `getCallerSub(event)`) operates on the impersonated user's identity.

**Read-only guarantee.** Impersonation is for *observing* another user's view, not acting as them. The dispatcher rejects any non-GET request with `403 "Impersonation sessions are read-only"` before resolving the target user or touching any data. This matches the read-only guarantee Ory and Pigment treat as the heart of a safe impersonation feature.

**Actor attribution.** The acting WebAdmin is preserved on every synthesized event as RFC 8693-style actor claims (`act_sub`, `act_web_admin_id`), in addition to the impersonated user's `sub`/`cognito:groups`. (The claims are flattened because API Gateway's JWT authorizer coerces every claim to a primitive.) An impersonated action therefore remains attributable to the human who initiated it, while downstream role handlers stay unaware — `getCallerSub`/`getCallerGroups` are unaffected and audit code can read `act_sub` when it needs the actor.

**Net effect:** adding a new real feature route only ever requires ONE new entry in `route-registry.ts` (the path pattern + which handler module owns it) — never a second copy of the route's HTTP-method/path registration, and never any change to `infra/template.yaml`'s `ImpersonateFunction` events.

---

## Routes

| Method                    | Path                                        | Auth         | Description                                           |
| ------------------------- | ------------------------------------------- | ------------ | ----------------------------------------------------- |
| GET                       | `/web-admin/impersonate/users?orgId=&role=` | WebAdmin JWT | List users available to impersonate                   |
| GET                       | `/web-admin/impersonate/{userId}/context`   | WebAdmin JWT | Fetch a user's profile + resolved role                |
| GET/POST/PUT/PATCH/DELETE | `/web-admin/impersonate/{userId}/{proxy+}`  | WebAdmin JWT | Generic dispatch to the real role handler (see above) |
| OPTIONS                   | `/web-admin/impersonate`                    | NONE         | CORS preflight                                        |
| OPTIONS                   | `/web-admin/impersonate/{userId}`           | NONE         | CORS preflight                                        |
| OPTIONS                   | `/web-admin/impersonate/{userId}/{proxy+}`  | NONE         | CORS preflight                                        |

Query params for `GET /users`:

- `orgId` (required) — restrict to a single organisation
- `role` (required) — `OrgAdmin` | `Manager` | `Employee`

The generic proxy's query params, request body, and response shape are **identical** to the real (non-impersonated) route it forwards to — there is no separate contract to document per route. See `bruno/web-admin/impersonate/generic-proxy.bru` for examples and the current list of route families reachable this way.

---

## DynamoDB Key Patterns Used (read-only, for `/users` and `/context`)

Listing users by org + role uses the primary record key structure:

| Role     | PK            | SK prefix   |
| -------- | ------------- | ----------- |
| OrgAdmin | `ORG#<orgId>` | `USER#`     |
| Manager  | `ORG#<orgId>` | `MANAGER#`  |
| Employee | `ORG#<orgId>` | `EMPLOYEE#` |

Fetching a single user's context, and the existence check the generic dispatcher runs before forwarding any proxied request, both use the reverse-lookup record:

```
PK = USER#<userId>
SK = METADATA
```

This record exists for all three role types and contains at minimum:
`user_id` / `manager_id` / `employee_id`, `org_id`, `email`, `first_name` / `name`, `last_name`, `status`.

Role is resolved by calling Cognito `AdminListGroupsForUser` on the user's Cognito sub.

The generic dispatch itself issues **no new DynamoDB calls** of its own — once it forwards to a real handler, all data access is whatever that real handler's own service/db layer already does, unchanged.

---

## Request / Response Shapes

### GET /web-admin/impersonate/users?orgId=&role=

Response `200`:

```json
[
  {
    "user_id": "abc-123",
    "display_name": "Jane Smith",
    "email": "jane@example.com",
    "status": "CONFIRMED",
    "org_id": "org-456"
  }
]
```

### GET /web-admin/impersonate/{userId}/context

Response `200`:

```json
{
  "user_id": "abc-123",
  "role": "Employee",
  "display_name": "Jane Smith",
  "email": "jane@example.com",
  "org_id": "org-456",
  "status": "CONFIRMED"
}
```

Errors:

- `404` — user not found in DynamoDB
- `400` — userId missing

### GET/POST/PUT/PATCH/DELETE /web-admin/impersonate/{userId}/{proxy+}

Response: identical to the real route it forwards to. See `route-registry.ts` for the current table of `{role}/...` patterns and which real handler module owns each; see `bruno/web-admin/impersonate/generic-proxy.bru` for representative examples.

---

## Authorization Pattern (Updated)

The impersonate handler now uses the data-driven `requireWebAdminWithLookup` guard (the same function used by the organizations, org-admins, and employees web-admin handlers) instead of the lightweight `requireWebAdmin` Cognito-group-only check.

This means two layers of authorization are enforced before any impersonation is permitted:

1. **Cognito group check** — the caller must be a member of the WebAdmin Cognito group.
2. **DynamoDB record check** — the caller's `USER#<sub>/METADATA` item must exist in DynamoDB with `status = ACTIVE`. A Cognito group membership alone is no longer sufficient; a provisioned, non-disabled WebAdmin record is required.

If either check fails, the handler returns `403 Forbidden` immediately — the impersonated user's identity is never resolved and no sub-handler is invoked.

**Synthesized event actor:** The returned `WebAdminCaller` (which includes `web_admin_id`) is threaded into every synthesized event as `act_sub` / `act_web_admin_id` claims. Downstream handlers still derive their effective identity from `sub`/`cognito:groups` (the impersonated user), so the actor is additive rather than something each role handler must understand — but the audit trail always knows who was really behind the request.

---

## IAM / Cognito Permissions Required

```
cognito-idp:AdminGetUser
cognito-idp:AdminListGroupsForUser
dynamodb:GetItem
dynamodb:PutItem
dynamodb:UpdateItem
dynamodb:DeleteItem
dynamodb:Query
```

The `ImpersonateFunction` already carries `DynamoDBCrudPolicy` on the single `DalTimeTable` and the Cognito group-lookup permissions above. No additional IAM is required for in-process dispatch: every real handler module it dynamically imports talks to the same single table and the same Cognito user pool the `ImpersonateFunction` is already permissioned for. (If a future dispatch redesign moves to `lambda:InvokeFunction` against separate Lambda ARNs instead, that would need its own `lambda:InvokeFunction` resource-scoped policy — not needed today.)

---

## Error Handling

- `ValidationError` → 400
- `NotFoundError` → 404
- Impersonated `{userId}` does not resolve to a real user → 404 (`"Impersonated user not found"`), forwarding never happens
- `{role}/...` sub-path does not match any registered route → 400 (`"Unhandled proxy route: <method> <path>"`), never a 500
- All other unhandled errors → 500 with logged stack trace (server-side only — response body never leaks internals)

---

## SAM Local Auth Limitation and Local-Dev Fallback Pattern

### Why SAM local doesn't populate `requestContext.authorizer`

SAM local does not support HTTP API JWT authorizers. When `sam local start-api` starts the local server it logs `"Linking authorizer skipped"` for every route that has an `Auth` property in `infra/template.yaml`. This means `event.requestContext.authorizer` is `undefined` in every Lambda invocation when running locally — reading `.authorizer.jwt.claims` directly (as the pre-fix code did) crashes with `TypeError: Cannot read properties of undefined (reading 'jwt')`.

### `AWS_SAM_LOCAL` — the reliable local-only signal

`sam local start-api` automatically sets `AWS_SAM_LOCAL=true` in every Lambda's environment. This variable is never set by the AWS Lambda runtime in deployed environments (dev/qa/prod) and is not defined in `infra/template.yaml`'s `Environment.Variables`. It is a clean, explicitly named signal that leaves zero ambiguity about when local-dev code paths are active.

### The null guard and header-decode fallback

`synthesize-event.ts` now guards the `requestContext.authorizer` access via `resolveCallerClaims()`:

1. **Deployed path (normal):** when `requestContext.authorizer.jwt.claims` is present (API Gateway always populates it before the Lambda runs in dev/qa/prod), claims are read directly from there. This path is unchanged from the pre-fix behavior.

2. **SAM-local fallback path:** when `requestContext.authorizer` is absent, the function decodes the `Authorization: Bearer <token>` header from the event using the shared `decodeLocalJwtPayload` helper (see below). No signature verification is performed — this is safe because the fallback path is structurally unreachable in deployed environments where API Gateway's JWT authorizer always populates the authorizer object.

3. **Missing/malformed header in SAM local:** if the header is absent or not a valid JWT, `synthesizeImpersonatedEvent` throws a descriptive `Error` with a clear message rather than crashing silently. The 500 response body never leaks stack traces to the caller.

### The shared helper — `decodeLocalJwtPayload` in `shared/auth.ts`

The fallback decode logic lives in `backend/src/functions/shared/auth.ts` as an exported function named `decodeLocalJwtPayload`:

```ts
export function decodeLocalJwtPayload(authorizationHeader: string): Record<string, unknown> | null;
```

**When to use it:** any future web-admin Lambda handler that needs to identify the caller during SAM-local development (i.e. when `requestContext.authorizer` may be absent) should import and call this function rather than re-implementing the decode logic inline. The name makes its local-only purpose unambiguous.

**How to use it:**

```ts
import { decodeLocalJwtPayload } from '../../shared/auth.js';

// Inside your handler or a helper:
const claims =
  event.requestContext?.authorizer?.jwt?.claims ??
  decodeLocalJwtPayload(event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '');
```

**What it does:** strips the `Bearer ` prefix, base64url-decodes the JWT payload segment, and JSON-parses it. Returns `null` on any parse failure rather than throwing.

**What it does NOT do:** verify the JWT signature. It is safe to call in SAM local because real tokens issued by Cognito are still valid bearer tokens — they just don't go through the API Gateway JWT authorizer locally. In deployed environments, the JWT authorizer has already verified the signature before this Lambda runs, so re-verifying would be redundant. Never call this function in a deployed environment to make an authorization decision from unverified claims.

### Confirming `infra/template.yaml` and `backend/env.local.json` are unchanged

No changes to `infra/template.yaml` or `backend/env.local.json` are required for this fix. The `ImpersonateFunction` route's `Auth` property (JWT authorizer) remains intact and unchanged — the fix is purely in the Lambda handler code, not in the infrastructure configuration. The JWT authorizer continues to run in all deployed environments exactly as before.
