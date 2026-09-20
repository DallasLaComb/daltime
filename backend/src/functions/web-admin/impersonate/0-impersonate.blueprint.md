# Blueprint: Web Admin Impersonation

Web admins need to navigate the app _as_ any other user (OrgAdmin, Manager, Employee) to debug issues and verify what those users see. The web-admin's own JWT is always what API Gateway authenticates — only the _identity the business logic sees_ is substituted, and only for reads.

Two separate pieces:

| Piece | Where | Job |
| --- | --- | --- |
| **Picker** | this Lambda (`web-admin/impersonate`) | list who can be impersonated, describe one user |
| **Acting as a user** | `withImpersonation` in `shared/impersonation.ts`, wrapped around every role handler | resolve `X-Impersonate-User` and hand the real handler the target's identity |

This file covers both. History: until phase 3 of the redesign (`contracts/checklist.md` §11), acting as a user meant rewriting the URL into a `/web-admin/impersonate/{userId}/{proxy+}` catch-all that re-dispatched in-process through a route registry. That catch-all, the registry and the event synthesizer are gone.

---

## Acting as a user — the `X-Impersonate-User` header

The frontend's `impersonationInterceptor` adds `X-Impersonate-User: <userId>` to every request for a role route (`/org-admin/…`, `/manager/…`, `/employee/…`) while a web-admin is viewing as someone. **The URL is not changed** — the request lands on the real, documented, typed route, so `contracts/openapi.json` describes it (`ImpersonationHeader` in `contracts/src/schemas/common.ts`).

Every employee / manager / org-admin / notifications Lambda exports `withImpersonation(handler)`. With **no header** it is a pure pass-through. With the header, it checks in this order and stops at the first failure:

| # | Check | Failure |
| --- | --- | --- |
| 1 | Caller is a provisioned, **ACTIVE WebAdmin** — Cognito group **and** `USER#<sub>/METADATA` record (`requireWebAdminWithLookup`) | `403`. A non-WebAdmin who sends the header is rejected, never silently ignored. Nothing else about the request is revealed. |
| 2 | Method is `GET` (**read-only**) | `403 "Impersonation sessions are read-only"` — before the target is looked up |
| 3 | Header is a valid id (`[A-Za-z0-9_-]{1,128}`) | `400`. The id becomes part of a DynamoDB key, and a comma means the header was sent twice. |
| 4 | Route is a role route; the role is its first path segment | `400 "not supported on this route"` (e.g. `/web-admin/notifications`) |
| 5 | Target is a **real member of that role** (`isRoleMember`) | `404 "Impersonated user not found"` — e.g. an Employee id sent to `/manager/shifts` |

On success it logs one structured audit line (`{"audit":"impersonation","actor_web_admin_id":…,"target_user_id":…,"role":…,"method":…,"path":…}`) and calls the real handler with an event whose claims are:

- `sub` = the **target**, `cognito:groups` = the route's role — so `getCallerSub` / `getCallerGroups` (and every service built on them) need no special-casing;
- `act_sub`, `act_web_admin_id` = the **actor**, as flattened RFC 8693 `act` claims (API Gateway coerces every JWT claim to a primitive, so the nested `act: { sub }` form cannot be represented). The actor is written last, so a client-supplied `act_*` claim can never win;
- the impersonation header removed, so nothing downstream can resolve it a second time.

**Fail-safe if a handler is left unwrapped:** the header is ignored and the WebAdmin acts as themselves, so the handler's own role check returns 403. It cannot widen access.

**Role is verified, not trusted.** The old proxy derived the role from the URL and only checked that the user existed. `isRoleMember` reads the user's reverse-lookup record for `org_id`, then requires the role's primary record (`ORG#<org>` / `USER#|MANAGER#|EMPLOYEE#<id>`) to exist — DynamoDB only, so role Lambdas need no Cognito permissions.

---

## The picker — routes

| Method  | Path                                        | Auth         | Description                            |
| ------- | ------------------------------------------- | ------------ | -------------------------------------- |
| GET     | `/web-admin/impersonate/users?orgId=&role=` | WebAdmin JWT | List users available to impersonate    |
| GET     | `/web-admin/impersonate/{userId}/context`   | WebAdmin JWT | Fetch a user's profile + resolved role |
| OPTIONS | `/web-admin/impersonate`                    | NONE         | CORS preflight                         |
| OPTIONS | `/web-admin/impersonate/{userId}`           | NONE         | CORS preflight                         |
| OPTIONS | `/web-admin/impersonate/users`, `…/{userId}/context` | NONE | CORS preflight                    |

Any other method/path on this Lambda returns `400 "Unhandled route"`. There is no way to act as a user through it.

Query params for `GET /users`: `orgId` (required), `role` (required: `OrgAdmin` | `Manager` | `Employee`). Both validated by `ImpersonateUsersQueryParams`; the path param of `/context` by `ImpersonateContextPathParams`.

Try it: `bruno/web-admin/impersonate/` (`list-impersonatable-users`, `get-impersonate-context`, `view-as-user`).

---

## DynamoDB Key Patterns

Listing users by org + role uses the primary record:

| Role     | PK            | SK prefix   |
| -------- | ------------- | ----------- |
| OrgAdmin | `ORG#<orgId>` | `USER#`     |
| Manager  | `ORG#<orgId>` | `MANAGER#`  |
| Employee | `ORG#<orgId>` | `EMPLOYEE#` |

A single user's context, the WebAdmin lookup, and step 5 above use the reverse-lookup record:

```
PK = USER#<userId>
SK = METADATA
```

The picker resolves a user's role with Cognito `AdminListGroupsForUser`; `withImpersonation` deliberately does **not** (DynamoDB only).

---

## Request / Response Shapes

### GET /web-admin/impersonate/users?orgId=&role=

```json
[{ "user_id": "abc-123", "display_name": "Jane Smith", "email": "jane@example.com", "status": "CONFIRMED", "org_id": "org-456" }]
```

### GET /web-admin/impersonate/{userId}/context

```json
{ "user_id": "abc-123", "role": "Employee", "display_name": "Jane Smith", "email": "jane@example.com", "org_id": "org-456", "status": "CONFIRMED" }
```

Errors: `404` user not found (or has no recognised role), `400` userId missing.

### An impersonated request

Request and response are **identical** to the real route — `GET /manager/shifts?month=2026-07` with the extra header returns exactly what that manager would see.

---

## Authorization

The picker uses the data-driven `requireWebAdminWithLookup` guard (Cognito WebAdmin group **and** an ACTIVE `USER#<sub>/METADATA` record). Disabling a WebAdmin in DynamoDB takes effect immediately, without revoking their Cognito token. `withImpersonation` uses the same guard as its first check.

## IAM

`ImpersonateFunction` needs `DynamoDBCrudPolicy` plus `cognito-idp:AdminGetUser` and `cognito-idp:AdminListGroupsForUser` (the picker's role lookup). Role Lambdas need nothing new: `withImpersonation` performs only `dynamodb:GetItem` on the single table, which every Lambda already has.

## Error Handling

`ValidationError` → 400, `NotFoundError` → 404, `ForbiddenError` → 403; everything else → 500 with a logged stack trace and a generic body that never leaks internals. Rejections from `withImpersonation` carry CORS headers so the browser can read them.

---

## SAM Local

SAM local does not support HTTP API JWT authorizers: it logs `"Linking authorizer skipped"`, so `event.requestContext.authorizer` is `undefined` in local invocations. `getCallerSub` / `getCallerGroups` therefore fall back to decoding the `Authorization: Bearer <token>` header with `decodeLocalJwtPayload` (`shared/auth.ts`, no signature check). `withImpersonation` reuses that fallback to obtain the caller's claims, so impersonation works locally too. This path is structurally unreachable in deployed environments, where API Gateway always populates the authorizer before the Lambda runs.

Any handler that must identify the caller locally should call `decodeLocalJwtPayload` rather than re-implementing it; its name makes the local-only purpose explicit.
