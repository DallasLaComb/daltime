# DalTime Logging Policy

## 1. Overview

All backend logs are emitted as structured JSON to CloudWatch Logs via
`@aws-lambda-powertools/logger`. The frontend (Phases 7–9) batches client-side
events and ships them to `POST /shared/client-logs`, which writes them through
the same logger so every log line — server or client — has a uniform shape.

---

## 2. Log levels

| Level | When to use |
| --- | --- |
| `DEBUG` | Query key shapes, internal branching hints. Off in prod by default (`LOG_LEVEL=INFO`). |
| `INFO` | Every request lifecycle line (`request completed`) and every state-changing business event (create/update/delete/assign/publish/generate). |
| `WARN` | Rejected business rules that reach `mapHandlerError` (4xx). Add a specific `WARN` only when the reason is not obvious from the error message. |
| `ERROR` | Unexpected failures: DynamoDB errors, Cognito errors, uncaught exceptions. Log once at the catch layer — never log-and-rethrow. |

---

## 3. Standard fields

Every log line from `withLogging` carries these fields automatically. You never
need to repeat them in service-level logs.

| Field | Source | Example |
| --- | --- | --- |
| `timestamp` | Powertools | `2026-09-21T18:32:48.811Z` |
| `level` | Powertools | `INFO` |
| `message` | call site | `"request completed"` |
| `service` | env var `POWERTOOLS_SERVICE_NAME` | `"daltime-backend"` |
| `env` | env var `ENVIRONMENT` | `"dev"` / `"qa"` / `"prod"` |
| `request_id` | API Gateway `requestId` | `"abc123"` |
| `correlation_id` | `X-Correlation-Id` header → `requestId` fallback | `"abc123"` |
| `route` | event route key | `"POST /manager/shifts"` |
| `method` | HTTP method | `"POST"` |
| `handler` | `withLogging` name argument | `"manager-shifts"` |
| `caller_sub` | JWT `sub` claim | `"a1b2c3d4-..."` |
| `caller_role` | JWT group | `"Manager"` |
| `device_type` | UA / `X-Platform` header | `"mobile"` / `"tablet"` / `"desktop"` |
| `os` | UA / `X-Platform` header | `"ios"` / `"android"` / `"windows"` / `"macos"` / `"linux"` |
| `browser` | UA string | `"chrome"` / `"safari"` / `"edge"` / `"firefox"` / `"other"` |
| `platform` | `X-Platform` header → UA fallback | `"ios"` / `"android"` / `"web"` |
| `status` | HTTP response status code | `200` |
| `duration_ms` | request wall time | `42` |

---

## 4. PII rules — never log these

- **Emails** — use `user_id` / `sub` instead
- **Names** (first, last, display) — use `user_id` / entity ids
- **Phone numbers**
- **Request or response bodies**
- **Whole `event` objects**
- **DynamoDB item contents** (the full record shape)
- **Cognito tokens or passwords**

Log **opaque ids only**: `sub`, `org_id`, `employee_id`, `manager_id`, `shift_id`, `swap_id`, `template_id`, `location_id`, `user_id`.

---

## 5. Service-layer logging conventions

| Operation type | Level | Fields to include |
| --- | --- | --- |
| Create entity | `INFO` | `org_id`, entity id, actor id (where available) |
| Update entity | `INFO` | `org_id`, entity id |
| Delete / remove entity | `INFO` | `org_id`, entity id |
| Assign / unassign relationship | `INFO` | `org_id`, both entity ids |
| State transitions (disable/enable, publish, claim, cancel) | `INFO` | `org_id`, entity id, new state implicit in message |
| Bulk / generation operations | `INFO` | `org_id` (if applicable), outcome counts |
| DynamoDB / Cognito failure | `ERROR` | `{ error: serializeError(err) }` — once at the catch layer |
| Query key shape (debug) | `DEBUG` | key fields only, no item data |

---

## 6. Adding logging to a new Lambda slice

### New handler

```ts
// handler.ts
export const handler = withLogging(withImpersonation(handleRequest), 'role-feature');
//                     ^^^^^^^^^^^                                    ^^^^^^^^^^^^
//                     outermost wrapper                              kebab-case name
```

The architecture test (`test/unit/shared/arch.withlogging.test.ts`) will fail
CI if `withLogging` is missing from any `handler.ts`. Fix it before merging.

### New service function

```ts
import { logger } from '../../shared/logger.js';

export async function createFoo(callerSub: string, body: CreateFooBody) {
  // ... validation, db write ...
  await db.createFoo(record);
  logger.info('foo created', { org_id, foo_id: record.foo_id });
  return stripKeys(record);
}
```

Rules:
- One `INFO` line after the last write succeeds
- Fields: opaque ids only — never `body`, never the returned record
- No `try/catch` around DynamoDB in the service unless you have context to add; let `mapHandlerError` handle unexpected errors at the handler boundary

---

## 7. Logs Insights queries

All queries target the log group for a specific function, e.g.
`/aws/lambda/daltime-backend-<role>-<feature>-<env>`. In production, scope
them to `/aws/lambda/daltime-backend-*-prod` or use a log group prefix.

---

### 7.1 Errors by route (last 24 h)

```
filter level = "ERROR"
| stats count(*) as errors by route, handler
| sort errors desc
```

---

### 7.2 Slow requests (> 500 ms)

```
filter message = "request completed" and duration_ms > 500
| stats avg(duration_ms) as avg_ms, max(duration_ms) as max_ms, count(*) as count by route
| sort max_ms desc
```

---

### 7.3 All activity for one caller (`sub`)

```
filter caller_sub = "<paste sub here>"
| fields timestamp, level, message, route, status, duration_ms
| sort timestamp asc
```

---

### 7.4 Client errors from the frontend (Phase 6+)

```
filter source = "client" and level in ["ERROR", "WARN"]
| fields timestamp, event_type, message, device_type, os, platform, breakpoint
| sort timestamp desc
| limit 200
```

---

### 7.5 Click trail for a session (`client_session_id`)

Useful for replaying a user's journey before an error.

```
filter source = "client" and client_session_id = "<paste id here>"
| fields timestamp, event_type, target, route, message
| sort timestamp asc
```

---

### 7.6 Errors by device type and OS

```
filter level = "ERROR"
| stats count(*) as errors by device_type, os, platform
| sort errors desc
```

---

### 7.7 Rage clicks by target element (Phase 8+)

```
filter source = "client" and event_type = "rage_click"
| stats count(*) as rage_clicks by target
| sort rage_clicks desc
| limit 50
```

---

### 7.8 Resolve a `sub` to a display name (ops procedure)

CloudWatch logs contain only the opaque `sub`. To find the matching user:

1. Open the AWS Console → Cognito → User Pools → `daltime-<env>-user-pool`
2. Users → search by **Sub** (exact UUID match)
3. The matching record shows email, name, groups, and account status

Alternatively via CLI (requires `cognito-idp:ListUsers`):
```bash
aws cognito-idp list-users \
  --user-pool-id <pool-id> \
  --filter "sub = \"<paste sub here>\""
```

---

## 8. Retention and log levels by environment

| Environment | Retention | `LOG_LEVEL` | Notes |
| --- | --- | --- | --- |
| dev | 14 days | `DEBUG` | Full verbosity for local debugging |
| qa | 14 days | `INFO` | Matches prod behaviour |
| prod | 90 days | `INFO` | Meets compliance minimum |

These are controlled by GitHub environment variables `LOG_RETENTION_DAYS` and
`LOG_LEVEL` (set per-environment in GitHub → Settings → Environments). The
SAM parameters `LogRetentionDays` and `LogLevel` receive them via
`--parameter-overrides` in the CD workflow.
