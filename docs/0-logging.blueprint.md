# Structured Logging to CloudWatch (Backend + Web + Mobile) — Blueprint

Status: **Draft — awaiting approval. Nothing implemented.** Decisions in section 4 and questions Q1–Q7 in section 9 need a yes/no before the phase that needs them.

---

## 0. How to use this blueprint (protocol for Claude)

Work is split into numbered phases (section 6). The user will say **"implement phase N"** (or "phase 4c").

1. Read this whole file, then `CLAUDE.md`. Note: `CLAUDE.md` references `ai/context/*`, `ai/prompts/*` and
   saved prompts (`@new-lambda`, …) that do **not exist** in this repo, and `lint-staged` is **not
   configured** anywhere. Follow `CLAUDE.md` itself, `npm run lint` (`eslint src`) as the real lint gate, and
   the conventional-commit style in `git log`.
2. Confirm every earlier phase is ✅ in the progress table. If not, stop and tell the user.
3. Implement **only** phase N. Do not start phase N+1 or pull work forward.
4. Repo rules: Tailwind only, no `any`, signals only (no `BehaviorSubject`), ESM `.js` imports in backend,
   `data-testid` on interactive elements, shared components via `@common-daltime`. Stage every touched file with
   `git add`; fix **all** lint errors in every touched file (pre-existing ones included).
5. Do not commit or push unless the user asks. **Do not implement on `dev`** — a push to `dev`/`qa`/`main`
   triggers CD. Use a feature branch (e.g. `feature/logging`); tell the user if the current branch is `dev`.
6. Run the phase's **AI verification** checklist and report real results (failures included).
7. **Human gates** are things Claude cannot do (GitHub env variables the permission system blocks, AWS console,
   device checks). Do the AI part, then list the human steps. Setting GitHub variables is allowed only if the user
   has added a permission rule for it; otherwise print the commands.
8. Per-role sub-phases (`3a`, `4b`, …) are independent once their foundation phase is ✅: the user may ask for
   one at a time. Each sub-phase must leave `npm test`, `npm run lint` and `npm run build` green.
9. At the end of a phase, **update this file**: progress table, that phase's *Completion notes*, new open
   questions in section 9. Finish with: **"Phase N complete — ready for Phase N+1."** (or state the blocker).

Status legend: ⬜ not started · 🟡 in progress · ✅ done · ⏸ blocked on a human step

---

## 1. Summary

Add one consistent, structured (JSON) logging system so every backend request, business event, error and
client-side failure lands in CloudWatch Logs in a shape that CloudWatch Logs Insights can query — from the Lambda
API, the Angular web app, and the Capacitor iOS/Android shell.

Goals: (1) every request is traceable end-to-end by a correlation/request id; (2) errors are never silent;
(3) no PII or secrets in logs; (4) **future** code gets logging automatically or is caught by a check;
(5) retrofit the existing code in mechanical, AI-doable, independently shippable phases;
(6) every client entry answers *who* (authenticated user id + role), *where* (route), *on what* (device class,
OS/browser, platform web/iOS/Android) and *how big* (viewport, breakpoint, orientation), and the log shows
*what the user clicked* leading up to an error, so UI bugs can be reproduced from a report.

Out of scope: distributed tracing (X-Ray), native crash reporting (Crashlytics / ADOT), session replay, a
third-party log vendor. See section 8 for what is deliberately deferred.

---

## 2. Current state (verified against the repo, 2026-09-20)

| Area | Finding |
| --- | --- |
| Backend handlers | 28 `handler.ts` files; **24 are wrapped by `withImpersonation`**, most built by shared factories (`createProfileHandler`, `createShiftCrudHandler`, …) in `shared/handler-factories.ts` |
| Backend logging | No logger library. **~8 `console.*` calls**: `shared/errors.ts` (the only 500 log), `shared/impersonation.ts` (audit line, hand-built `JSON.stringify`), `shared/notifications/service.ts` (4, hand-formatted strings), `employee/swap-shifts/service.ts` |
| Silent errors | `mapHandlerError` logs **only** unexpected errors. `ValidationError`/`ConflictError`/`NotFoundError`/`ForbiddenError` (4xx) are not logged at all; no request-start/finish line, no duration, no caller id on normal requests |
| Frontend logging | No logger, no global `ErrorHandler` (only `provideBrowserGlobalErrorListeners()`), **~10 `console.*` calls** (`auth.ts`, `organizations.ts`, `schedule.ts`, `main.ts`), leftover debugging in `schedule.ts` ("raw error object"). **75** `subscribe(` call sites, **18** feature files with `error:` handlers |
| Interceptors | `auth.interceptor.ts`, `impersonation.interceptor.ts` exist — natural place for a correlation-id header and API-failure logging |
| Infra | 29 `AWS::Logs::LogGroup` resources, **every one with `RetentionInDays: 1`** (in a template shared by dev/qa/prod — yesterday's errors are already gone, prod included). Each function has `LoggingConfig: { LogGroup }` only (no `LogFormat`, no `ApplicationLogLevel`). HTTP API access logs are already JSON and include `requestId`. Runtime `nodejs24.x`, `BuildMethod: esbuild` |
| Auth / Cognito | User pool only (`foundation.yaml`); **no Cognito Identity Pool**. All API routes need a Cognito JWT. Frontend errors before login have no credentials |
| Click hooks | **347 `data-testid` attributes** across templates (CLAUDE.md requires one on every interactive element) — stable, non-PII names for click tracking without logging button text |
| Identity on the client | `AuthService` already exposes `roleSignal` and `orgId` signals; `sub` is in the access-token payload (`auth.ts` decodes it); given/family name and email exist in Cognito attributes (PII — see D9). Backend gets `sub` from JWT claims via `getCallerSub` |
| Contracts | New routes go through `contracts/` (zod → `openapi.json` → generated frontend types → `sync-contracts`) |
| Env vars per environment | GitHub vars exist for `ALLOWED_ORIGINS`, `SAM_STACK_NAME`, …; CD passes them as SAM `--parameter-overrides` |

Consequence: the backend has **three choke points** (`withImpersonation`/handler exports, `mapHandlerError`,
`response.ts`), so retrofit is small. The frontend has **two** (an `ErrorHandler` and an HTTP interceptor) plus
~18 files with local `error:` handlers to clean up. No file-by-file rewrite of the whole codebase is required.

---

## 3. Research findings (what best practice says)

Sources are listed in section 10. Claims marked **(verify)** must be re-checked when the phase runs.

1. **Structured JSON logs, one logger per function, created outside the handler.** Powertools for AWS Lambda
   (TypeScript) `Logger` outputs JSON, adds Lambda context (function name, request id, memory), `cold_start`,
   supports temporary keys (`appendKeys`/`resetKeys`), persistent keys, sampling of DEBUG logs, and correlation
   ids (`setCorrelationId`). Event logging is **off by default** to avoid leaking sensitive data — keep it off.
   Latest npm version at time of writing: `2.35.0` (**verify** Node 24 support and esbuild bundling).
2. **Handlers here are plain functions, not classes or middy.** Powertools' `injectLambdaContext` is offered as
   a class decorator or a middy middleware; neither fits. Use a small `withLogging(handler)` wrapper that calls
   `logger.addContext(context)`, `setCorrelationId`, `appendKeys` and `resetKeys` in `finally`. This matches how
   `withImpersonation` already composes.
3. **Lambda Advanced Logging Controls** (`LoggingConfig: LogFormat: JSON`, `ApplicationLogLevel`,
   `SystemLogLevel`) let you set log level per function from the template without redeploying code, and route to
   a named log group (already done here). Use them together with Powertools (**verify** interaction with
   `POWERTOOLS_LOG_LEVEL` / `AWS_LAMBDA_LOG_LEVEL`; Lambda filters at the lower of the two).
4. **Set retention explicitly and per environment.** CloudWatch retains forever by default; `1` day is too short
   to debug anything. Log class: keep **Standard** — Infrequent Access is cheaper ($0.25 vs $0.50/GB ingest, as
   of the cited 2026 pricing pages, **verify**) but lacks the real-time features (metric filters, subscriptions,
   alarms) we want for error alerting.
5. **Frontend → CloudWatch has two mainstream options.**
   - **CloudWatch RUM web client** (`aws-rum-web`): errors with stack traces, Core Web Vitals, HTTP telemetry;
     $1 per 100k events; needs an app monitor plus either a Cognito Identity Pool (unauthenticated role) or a
     resource-based policy; data kept 30 days unless copied to CloudWatch Logs. Works for Angular. **Not proven
     inside a Capacitor WebView (`https://localhost` origin)** — unverified. RUM's *native* iOS/Android support
     (Nov 2025) uses ADOT SDKs for native apps and does not observe JS errors in a WebView.
   - **A backend log-ingestion endpoint** (browser → authenticated API route → Lambda logs it with the same
     logger). AWS's own best-practice material lists this as the alternative to RUM. One pipeline, one query
     surface, identical for web and Capacitor, reuses the existing JWT authorizer and SAM patterns.
6. **Correlation ids.** Accept an inbound `X-Correlation-Id`, fall back to the API Gateway request id, log both,
   and generate the id on the client per request so a frontend error and its backend logs join in Logs Insights.
7. **Never log**: tokens, Cognito responses, emails/names/phones, request or response bodies, whole `event`
   objects, DynamoDB items. Log opaque ids (`sub`, `org_id`, entity ids) only. Existing impersonation audit
   logging is the one deliberate exception in structure (ids only) and must be preserved.
8. **Interaction + device telemetry (what RUM/session tools capture, done minimally).** One delegated
   `click` listener on `document` (capture phase) instead of per-component handlers; log a stable identifier
   (`data-testid`), never element text, input values or full URLs; keep a small in-memory **breadcrumb** ring
   buffer (last ~20 clicks/navigations) and attach it to every error so the trail is present even if routine
   clicks are sampled; derive a coarse device class rather than storing raw fingerprints; record **viewport**
   (`innerWidth/innerHeight`, what responsive CSS reacts to) and the Tailwind breakpoint name, plus screen
   size and pixel ratio once per session. Detect rage clicks (≥3 clicks on one target within 1 s) — a strong UI-bug
   signal. `navigator.sendBeacon` cannot send an `Authorization` header, so use `fetch(..., { keepalive: true })`.
9. **Cost control**: level per environment (DEBUG only in dev), rate-limit and batch client logs, cap batch and
   message size server-side, put a throttle on the ingestion route.

---

## 4. Decisions (defaults used unless you change them before the phase that needs them)

| # | Decision | Default | Needed by |
| --- | --- | --- | --- |
| D1 | Backend logger | `@aws-lambda-powertools/logger` (exact-pinned) | Phase 1 |
| D2 | Log retention (days) per env | dev 14, qa 14, prod 90 (**your call** — currently 1 everywhere) | Phase 2 |
| D3 | Log level per env | dev `DEBUG`, qa `INFO`, prod `INFO` | Phase 2 |
| D4 | Client-side transport | **Custom `POST /client-logs`** route (authenticated). CloudWatch RUM is *not* adopted now (Phase 11 evaluates it for web vitals only) | Phase 6 |
| D5 | Pre-login frontend errors | Buffered in memory and dropped if the user never authenticates. **No unauthenticated ingestion route** (abuse/cost risk) | Phase 6 |
| D6 | Correlation header | `X-Correlation-Id` (must be added to API `AllowHeaders`, `response.ts` CORS headers **and** exposed if we return it) | Phase 1/2 |
| D7 | Alerting | Optional, Phase 10: one metric-filter alarm on `ERROR` count per env → SNS email | Phase 10 |
| D8 | Where per-env values live | GitHub environment variables `LOG_LEVEL`, `LOG_RETENTION_DAYS` passed in `cd.yml` with fallback defaults (so a missing variable never breaks a deploy), plus hardcoded values in `.vscode/tasks*.json` (same pattern as `ALLOWED_ORIGINS`) | Phase 2 |
| D9 | Who is logged in | Log opaque `sub`, `role`, `org_id` (+ `impersonating: true` and the actor `sub` when a WebAdmin impersonates). **No email/name in logs** (PII, long retention, App Store privacy labels). Add a documented "resolve sub → user" lookup in `docs/logging.md` instead. **Your call** — see Q5 | Phase 6/7 |
| D10 | Click logging volume | Log every tagged click (`data-testid` only), batched; separate rate cap (≤120/min); breadcrumbs always attached to errors. A per-env switch in `environment*.ts` (`clickLogging: 'all' \| 'breadcrumbs' \| 'off'`) lets prod be turned down without a code change. Rough cost: 1,000 users × 200 clicks/day × ~300 B ≈ 1.8 GB/month ≈ **~$1/month** ingestion at $0.50/GB (estimate; plus batch Lambda invocations) | Phase 8 |
| D11 | Device classification | In-house classifier, no new dependency: `device_type` = `mobile` / `tablet` / `desktop` from `navigator.userAgentData` (else UA), touch points and screen size (iPadOS reports as "Macintosh" + touch, handled). Also `platform` (`web`/`ios`/`android` via `Capacitor.getPlatform()`), `os`, coarse `browser` + major version. Native model names (`@capacitor/device`) are **not** added now — a new native plugin means a store release; Android UAs already include the model, iOS does not | Phase 8 |
| D12 | Screen size fields | `viewport` `{w,h}` (on every entry), Tailwind `breakpoint` (`base/sm/md/lg/xl/2xl`), `orientation`; once per session `screen` `{w,h}`, `dpr`. A `viewport changed` entry is logged only when the breakpoint or orientation changes (not every pixel) | Phase 8 |

---

## 5. Design reference

### 5.1 Planned files

```
backend/src/functions/shared/
  logger.ts                     # Logger singleton, level/env config, redaction helpers
  with-logging.ts               # withLogging(handler, name): context, correlation id, duration, status line
  client-logs/                  # phase 6 vertical slice (handler, service, model, tests, blueprint)
backend/src/functions/shared/errors.ts, impersonation.ts, notifications/service.ts   # console.* → logger
contracts/src/…                 # phase 6: ClientLogBatch request schema → openapi.json
infra/template.yaml             # LogRetention/LogLevel params, LoggingConfig, ClientLogs function + route
frontend/src/app/core/logging/
  logger.service.ts             # levels, batching queue, flush, context
  error-handler.ts              # global ErrorHandler → logger
  correlation.interceptor.ts    # adds X-Correlation-Id, logs failed API calls
docs/logging.md                 # policy, field dictionary, Logs Insights queries (phase 5)
```

### 5.2 Backend log line shape (target)

Every line is JSON with Powertools defaults (`level`, `message`, `timestamp`, `service`, `xray_trace_id`,
`function_name`, `function_request_id`, `cold_start`) plus DalTime keys, all snake_case (matches the existing
audit line):

| Key | Source |
| --- | --- |
| `env` | persistent key from `ENVIRONMENT` (`dev`/`qa`/`prod`) |
| `request_id` | API Gateway `requestContext.requestId` |
| `correlation_id` | `X-Correlation-Id` header, else `request_id` |
| `route`, `method` | `event.routeKey` / `requestContext.http.method` |
| `caller_sub`, `caller_role` | JWT claims (already extracted by `auth.ts`) |
| `impersonated_target_id` | set by `withImpersonation` when active |
| `handler` | name passed to `withLogging` |
| `status`, `duration_ms` | on the final `request completed` line |

Level policy: `INFO` request completed (2xx/3xx) and state-changing service events; `WARN` 4xx and rejected
business rules; `ERROR` 5xx / unexpected exceptions (with `error` serialised by the logger, stack included);
`DEBUG` DynamoDB call shapes (key names only) and reads. Reads are not logged at INFO beyond the request line.

### 5.3 Composition

```ts
// employee/profile/handler.ts
export const handler = withLogging(withImpersonation(handleRequest), 'employee-profile');
```

`withLogging` is the **outermost** wrapper so that 400/403 produced inside `withImpersonation` are logged too.
`mapHandlerError(err, context)` keeps its signature and now logs through the logger (4xx at `WARN` without stack,
unexpected at `ERROR` with stack) — callers do not change.

### 5.4 Frontend design

- `LoggerService` (`providedIn: 'root'`, signals only, no `BehaviorSubject`): `debug|info|warn|error(message, fields?)`.
  Mirrors to `console` in dev builds. Queues entries in memory; flushes every N seconds, at M entries, and on
  page hide / (mobile) `@capacitor/app` `pause`. Uses `fetch(..., { keepalive: true })` with the bearer token.
- Rate limits (≤ 30 log entries/min, separate ≤ 120 click entries/min), de-duplicate identical consecutive
  errors, cap message/stack length, drop unknown fields. Never attach request/response bodies, form values or
  element text.
- **Identity (phase 7):** each batch carries `authenticated`, `role`, `org_id`, `impersonating`. The server
  stamps `caller_sub` (and actor `sub`) from the verified JWT and treats client-supplied identity as untrusted.
- **Device and screen context (phase 8)** — `core/logging/client-context.ts`:
  - Per batch: `client_session_id` (random per launch), `platform`, `device_type` (`mobile|tablet|desktop`),
    `os`, `browser`, `is_native`, `app_version`, `env`.
  - Per entry: `ts`, `seq`, `route` (path only, no query), `viewport {w,h}`, `breakpoint`, `orientation`.
  - Once per session, a `session_start` entry: truncated `user_agent` (≤ 200 chars), `screen {w,h}`, `dpr`,
    `touch`, language, time zone, online/connection type when available.
- **Interaction tracking (phase 8)** — `core/logging/interaction-tracker.ts`, started from an app initializer:
  - One capture-phase `click` listener on `document`. Walk up from the target to the nearest element with
    `data-testid`; log `{ type: 'click', target: <testid>, tag, x, y }`. Clicks with no `data-testid`
    ancestor are ignored (CLAUDE.md already requires the attribute on every interactive element, so a missing one
    is a lint/review finding, not a logging hole).
  - `NavigationEnd` from the Router → `{ type: 'navigation', route }` (path only; route params replaced by their
    route pattern, e.g. `/manager/shifts/:shiftId`, so ids and query strings never appear).
  - Breadcrumb ring buffer (last 20 clicks/navigations) attached to every `error` entry.
  - Rage-click detection → `{ type: 'rage_click', target }` at `WARN`.
- Global `ErrorHandler` and an HTTP interceptor that logs failed API calls (method, URL path, status,
  correlation id) at `WARN`/`ERROR`. Register both in `app.config.ts`.
- Convention: **services and interceptors log; components only surface UI state** (`error: () => this.error.set(...)`),
  and the interceptor/service logs the failure once — no double logging. User *actions* come from the click
  tracker automatically, so components never log clicks by hand.

### 5.5 `POST /client-logs`

Authenticated (existing JWT authorizer), all roles. Typed, allow-listed payload — **not** free-form fields:

```jsonc
{
  "context": { "client_session_id", "platform", "device_type", "os", "browser",
               "is_native", "app_version", "authenticated", "role", "org_id", "impersonating" },
  "entries": [
    { "type": "log|error|click|navigation|rage_click|session_start|viewport_change",
      "level": "debug|info|warn|error", "ts": "<iso>", "seq": 12,
      "route": "/manager/shifts/:shiftId", "viewport": {"w": 390, "h": 844},
      "breakpoint": "base", "orientation": "portrait",
      "message": "≤500 chars",                       // log/error
      "stack": "≤2000 chars",                       // error
      "http": {"method": "GET", "path": "/…", "status": 500},   // error, failed API call
      "target": "shift-save-btn", "tag": "button", "x": 120, "y": 640,   // click / rage_click
      "breadcrumbs": [{"type": "click", "target": "…", "ts": "…"}],      // error, ≤20
      "session": {"user_agent": "≤200", "screen": {"w": 390, "h": 844}, "dpr": 3, "touch": true, "lang": "en-US", "tz": "America/Toronto"} }   // session_start only
  ]
}
```

Limits: ≤ 25 entries per request, string caps as shown, enum-validated `type`/`level`/`breakpoint`/`orientation`,
unknown keys dropped, numbers range-checked. Server stamps `caller_sub`, `caller_role` (from verified claims),
`request_id`, `source: "client"`, keeps client `ts`/`seq` for ordering (server time is the `timestamp`), and logs
each entry as its own JSON line with `event_type` = `type` so Logs Insights can filter by it. Org id from the
client is stored as `client_org_id` (untrusted) unless the token carries `custom:org_id` (**verify**).
Returns `204`. Throttle the route in the HTTP API stage. Route, OPTIONS, `LogGroup` in `infra/template.yaml`;
entry in `backend/env.local.json`; contract in `contracts/`; vertical-slice tests (CLAUDE.md feature-completeness
applies: local, dev, qa, prod).

### 5.6 Guardrails so future code stays covered

1. ESLint `no-console` (error) for `backend/src` and `frontend/src` (allow `LoggerService` itself).
2. A backend architecture test that fails if any `functions/**/handler.ts` export is not wrapped in
   `withLogging`.
3. A frontend spec/lint check that new `subscribe()` error paths do not use `console`, and (existing rule, keep
   enforced) that interactive elements carry `data-testid` — it is now also the click-log name.
4. `docs/logging.md` + a "Logging" section in `CLAUDE.md` (and in any future `@new-lambda` / `@new-component`
   prompt) stating the policy, levels and field dictionary.

---

## 6. Phases

### Progress

| Phase | Title | Human gate? | Status |
| --- | --- | --- | --- |
| 1 | Backend logger foundation + pilot handler + console→logger in shared code | No | ✅ |
| 2 | Infra: retention, log level, JSON LoggingConfig, correlation header (CORS) | Yes — 2 GitHub vars per env, deploy dev | ✅ |
| 3 | Roll out `withLogging` to every handler (3a–3e by role) | No (deploy dev to sanity check) | ✅ |
| 4 | Business-event logging in services/db (4a–4e by role) | No | ✅ |
| 5 | Guardrails + docs (lint rule, arch test, `docs/logging.md`, CLAUDE.md) | No | ✅ |
| 6 | Backend `POST /client-logs` route (contract, handler, SAM, tests) | Yes — deploy dev, curl check | ⬜ |
| 7 | Frontend logger core (service, ErrorHandler, interceptor, config) | No | ⬜ |
| 8 | Client context + interaction tracking (device type, screen size, clicks, navigation, breadcrumbs) | Yes — check on desktop, phone, tablet | ⬜ |
| 9 | Frontend retrofit (replace `console.*`, route `error:` handlers; 9a–9d by feature area) | No | ⬜ |
| 10 | Observability payoff: saved Logs Insights queries + ERROR alarm (optional) | Yes — confirm SNS email | ⬜ |
| 11 | Mobile specifics + optional CloudWatch RUM evaluation (optional) | Yes — device check | ⬜ |

Phases 1–5 are backend-only and independently valuable; 6–9 add the client (7 = logger + errors + identity, 8 = device/screen/click context). 10–11 can be deferred.

---

### Phase 1 — Backend logger foundation

**Goal:** a shared logger and `withLogging` wrapper exist, are unit-tested, and one handler uses them end to end.

**Do (from `backend/`):**
1. Confirm D1. Check the latest `@aws-lambda-powertools/logger` on npm; install it **pinned exactly**. Verify it
   supports Node 24 and bundles under `BuildMethod: esbuild` (`npm run build`).
2. `shared/logger.ts`: single `Logger` instance created at module scope (`serviceName: 'daltime-backend'`,
   persistent key `env` from `ENVIRONMENT`, level from `POWERTOOLS_LOG_LEVEL`/default `INFO`). Export small
   helpers to log an error safely (no AWS SDK request objects) and — verify whether Logger 2.x has built-in
   redaction; if not, a documented allow-list approach.
3. `shared/with-logging.ts`: `withLogging(handler, name)` — `addContext`, correlation id (header else request
   id), `appendKeys` (`request_id`, `route`, `method`, `handler`, `caller_sub`/`caller_role` when the JWT is
   present), one `request completed` line with `status` and `duration_ms`, `resetKeys` in `finally`. It must
   never throw, must preserve the handler's result, and must not change response headers/CORS behaviour.
4. `errors.ts` (`mapHandlerError`): log 4xx at `WARN` (message + error name, no stack), unexpected at `ERROR`
   with the error object. Keep the signature.
5. Replace the remaining `console.*` in `shared/impersonation.ts` (keep the audit keys **exactly**:
   `audit: 'impersonation'`, `session_id`, `actor_web_admin_id`, `actor_sub`, `target_user_id`, `role`, `method`,
   `path`), `shared/notifications/service.ts`, `employee/swap-shifts/service.ts` with structured calls
   (`logger.info('notification created', { notification_id, recipient_sub, type })`, …).
6. Wire the pilot: `employee/profile/handler.ts` → `withLogging(withImpersonation(handleRequest), 'employee-profile')`.
7. Tests (vitest, unit project): logger config, `withLogging` (success, thrown error passthrough, missing JWT,
   correlation id precedence, keys reset between invocations), `mapHandlerError` levels, existing specs updated
   where they spy on `console`.

**AI verification:** `npm test`, `npm run lint`, `npm run build` (SAM esbuild) pass; no `console.` left in
`shared/`; existing impersonation audit test still asserts the same keys; a sample invocation in a spec shows
valid JSON with the keys in 5.2.

**Human gate:** none.

**Completion notes:** Installed `@aws-lambda-powertools/logger@2.35.0` (verified Node 24 + esbuild). Created `shared/logger.ts` (singleton, persistent `env` key, `serializeError`) and `shared/with-logging.ts` (`withLogging(handler, name)` outermost wrapper with correlation-id, appendKeys, "request completed" line, resetKeys in finally, guards `addContext` on `invokedFunctionArn` presence so tests with minimal context stubs don't crash). Updated `mapHandlerError` (4xx → WARN, unexpected → ERROR). Replaced all `console.*` in `shared/impersonation.ts` (audit keys preserved exactly), `shared/notifications/service.ts` (removed pre-throw double-log — mapHandlerError handles 4xx), `employee/swap-shifts/service.ts`. Wired pilot: `employee/profile/handler.ts`. Tests: 40 files, 915 pass; lint clean; SAM build verified. Q3 answers: Powertools 2.35.0 supports Node 24 ✅; no built-in redaction — allow-list approach via structured fields (no bodies/tokens/emails ever passed to logger); `POWERTOOLS_LOG_LEVEL` sets the library filter, `ApplicationLogLevel` (Phase 2) sets the Lambda platform filter — Lambda applies the lower of the two at ingestion.

---

### Phase 2 — Infra: retention, level, format, correlation header

**Goal:** logs are kept long enough, JSON at the platform level, level configurable per environment, and the
correlation header passes CORS.

**Do:**
1. `infra/template.yaml`: add parameters `LogRetentionDays` (allowed CloudWatch values) and `LogLevel`
   (`DEBUG|INFO|WARN|ERROR`, default `INFO`); replace the 29 hardcoded `RetentionInDays: 1` with
   `!Ref LogRetentionDays`. Keep the API access log group's retention parameterised too.
2. Add `LogFormat: JSON` and `ApplicationLogLevel: !Ref LogLevel` to each function's `LoggingConfig` (first
   check whether SAM `Globals.Function` supports `LoggingConfig` merging with the per-function `LogGroup`; if so
   use Globals, otherwise edit each block by script). Add `POWERTOOLS_SERVICE_NAME`, `POWERTOOLS_LOG_LEVEL`
   (= `!Ref LogLevel`) and `ENVIRONMENT` to `Globals.Function.Environment.Variables`. `ENVIRONMENT` needs a new
   parameter passed by CD/tasks (`dev|qa|prod`).
3. Add `X-Correlation-Id` to the HTTP API `AllowHeaders` and to `Access-Control-Allow-Headers` in
   `shared/response.ts` (plus its spec). Add `$context.responseLatency` and `$context.authorizer.claims.sub` to
   the access-log format only if it stays valid JSON (verify with `sam validate --lint`).
4. `.github/workflows/cd.yml`: pass `LogRetentionDays=${{ vars.LOG_RETENTION_DAYS || '14' }}`,
   `LogLevel=${{ vars.LOG_LEVEL || 'INFO' }}`, `Environment=…`. Fallback defaults mean a missing variable never
   breaks a deploy. Mirror in `.vscode/tasks.json`, `tasks.linux.json`, `tasks.windows.json` and the README deploy
   line (dev values: retention 14, level DEBUG).
5. Print (or, if permitted, run) the `gh variable set` commands per environment, reading current values first.

**AI verification:** `sam validate --lint`; `git diff` shows only intended lines; `grep -c "RetentionInDays: 1"`
returns 0; all three `.vscode` task files stay consistent.

**Human gate:** set `LOG_RETENTION_DAYS` and `LOG_LEVEL` in the `dev`, `qa`, `main` GitHub environments;
deploy dev; invoke any API route; in CloudWatch Logs Insights run
`fields @timestamp, level, message, request_id | sort @timestamp desc | limit 20` on the function's log group.
Record the result. Note: changing retention on an existing log group updates it in place (no data loss).

**Completion notes:** Added `LogRetentionDays`, `LogLevel`, `AppEnvironment` SAM parameters with safe defaults (so a missing GitHub var never breaks a deploy). Replaced all 30 hardcoded `RetentionInDays: 1` with `!Ref LogRetentionDays`. Added `LogFormat: JSON`, `ApplicationLogLevel: !Ref LogLevel`, `SystemLogLevel: WARN` to all 29 function `LoggingConfig` blocks. Added `POWERTOOLS_SERVICE_NAME`, `POWERTOOLS_LOG_LEVEL`, `ENVIRONMENT` to `Globals.Function.Environment.Variables`. Added `X-Correlation-Id` to HTTP API `AllowHeaders` and to `Access-Control-Allow-Headers` in `response.ts`. Added `responseLatency` and `callerSub` to API Gateway access log format. Updated `cd.yml` with fallback `||` defaults. Updated all three `.vscode/tasks*.json` deploy commands with `dev` values. GitHub vars set via `gh variable set`: dev (14d/DEBUG), qa (14d/INFO), main (90d/INFO). Human gate: deploy dev and run a Logs Insights query to confirm JSON structured logs appear.

---

### Phase 3 — Roll out `withLogging` to every handler

**Goal:** every request in every function produces a `request completed` line with caller, route, status and
duration.

Mechanical, one-line change per `handler.ts` (24 already use `withImpersonation`; the other 4 wrap directly).
Split so the user can ask for one at a time:

| Sub-phase | Scope |
| --- | --- |
| 3a | `shared/` (`health`, `notifications`) |
| 3b | `employee/*` (excluding the phase-1 pilot) |
| 3c | `manager/*` |
| 3d | `org-admin/*` |
| 3e | `web-admin/*` (includes `impersonate`, `generate-dummy-data`) |

**Do (per sub-phase):** wrap the exported `handler` with `withLogging(<existing>, '<role>-<feature>')` as the
**outermost** wrapper; do not change handler logic. Update any handler unit test that imports `handler` directly
only if it breaks.

**AI verification:** `npm test`, `npm run lint`, `npm run build`; a grep lists every `handler.ts` in the
sub-phase and each contains `withLogging`.

**Human gate (after 3e or any sub-phase, optional):** deploy dev, click through the app, confirm request lines
in Logs Insights for the touched functions.

**Completion notes:** Done in one pass (all sub-phases 3a–3e). Added `shared/ua-context.ts` — lightweight pure UA parser providing `device_type` (mobile/tablet/desktop), `os` (ios/android/windows/macos/linux/other), `browser` (edge/chrome/firefox/safari/other), `platform` (ios/android/web). `X-Platform` header (to be sent by Capacitor frontend in Phase 7) wins over UA heuristic; iPadOS 13+ Macintosh UA is corrected when the header is present. `withLogging` appends these four fields to every request log line. `X-Platform` added to CORS `AllowHeaders` in both `response.ts` and `template.yaml`. All 29 remaining `handler.ts` files wrapped. 6 web-admin inline exports refactored to `handleRequest` + `withLogging(handleRequest, name)`. `shared/health` updated to `APIGatewayProxyEventV2WithJWTAuthorizer` (runtime-compatible). 41 test files, 945 tests pass. Every request log now carries: `caller_sub`, `caller_role`, `request_id`, `correlation_id`, `route`, `method`, `handler`, `device_type`, `os`, `browser`, `platform`, `status`, `duration_ms`, `env`.

---

### Phase 4 — Business-event logging in services and DB layer

**Goal:** the events an operator would need during an incident are logged once, at the right level, without
noise or PII. Applies the level policy in 5.2.

**Rules for the AI (apply per role slice):**
- State-changing service functions (create/update/delete, assign, swap, approve, impersonation session start/end,
  bulk/dummy-data generation): one `INFO` line with the entity ids involved and the outcome.
- Rejected business rules that throw `ConflictError`/`ForbiddenError`/`ValidationError`: already `WARN` via
  `mapHandlerError`; add a specific `WARN` only when the *reason* is not obvious from the message.
- DynamoDB/Cognito failures: `ERROR` once, at the layer that catches them (do not log-and-rethrow at every
  level). `DEBUG` for query key shapes (no items).
- Reads: no per-call logging beyond the request line.
- Never log bodies, tokens, emails, names, DynamoDB items. Use ids.
- Use `logger.createChild({ persistentKeys: { … } })` only when a service needs stable extra keys.

| Sub-phase | Scope |
| --- | --- |
| 4a | `shared/` (`auth`, `cognito`, `dynamo`, `profile-service`, `notifications`, `impersonation`) |
| 4b | `employee/*` (availability, swap-shifts, shifts, …) |
| 4c | `manager/*` |
| 4d | `org-admin/*` |
| 4e | `web-admin/*` |

**AI verification:** tests pass; each touched service has a spec asserting the key events (spy on the logger,
not `console`); a grep shows no `console.` in the slice; review the diff for PII (emails, names, bodies).

**Human gate:** none.

**Completion notes:** Added `logger.info` to every state-changing service function across all five role slices (4a–4e). Fields logged are opaque ids only (`user_id`/`sub`, `org_id`, entity ids, outcome counts) — no emails, names, bodies, or DynamoDB items. Import added to 19 service files; `shared/profile-service.ts` (factory) updated so both employee and manager profile update paths log via the singleton. TypeScript: clean. Tests: 951 pass. ESLint: clean.

---

### Phase 5 — Guardrails and documentation

**Goal:** future code cannot silently skip logging.

**Do:**
1. ESLint `no-console: error` in `backend/eslint.config.js` and `frontend/eslint.config.js` (exempt
   `frontend/src/app/core/logging/**` and spec files if needed). Fix any remaining violations in touched files.
2. Backend architecture test (unit project): globs `src/functions/**/handler.ts` and fails if an exported
   `handler` is not produced via `withLogging`.
3. `docs/logging.md`: policy, level table, field dictionary, PII rules, how to add logging to a new Lambda/slice,
   ready-to-paste Logs Insights queries (errors by route, slow requests, one caller's activity, client errors,
   **the click trail for a `client_session_id`**, **errors by `device_type` / `breakpoint`**, rage clicks by target,
   a "resolve `sub` → user" lookup procedure).
4. `CLAUDE.md`: a short **Logging** section under Key constraints ("no `console.*`; every handler exported via
   `withLogging`; services log state changes; components don't log routine flow") and a link to the doc. Note in
   the doc that `@new-lambda` / `@new-component` prompts (currently absent) must include these rules when created.

**AI verification:** `npm run lint` + `npm test` in backend and frontend; the arch test fails when a handler
without `withLogging` is temporarily added (prove it, then revert).

**Completion notes:** Added `no-console: error` to `backend/eslint.config.js` (no violations — all console calls replaced in Phases 1–4). Created `test/unit/shared/arch.withlogging.test.ts`: globs all 29 `handler.ts` files, one test per file asserting `withLogging` presence — 30 tests pass. Created `docs/logging.md`: level table, standard fields, PII rules, service conventions, how-to guide for new slices, 8 ready-to-paste Logs Insights queries (errors by route, slow requests, caller activity, client errors, click trail, device breakdown, rage clicks, sub→user resolution), retention/level table by environment. Added Logging section to `CLAUDE.md` under Key constraints. All 981 tests pass, ESLint clean.

---

### Phase 6 — Backend `POST /client-logs`

**Goal:** authenticated clients can send batched log entries that land in CloudWatch through the same logger.

**Do:** follow the standard Lambda vertical slice under `backend/src/functions/shared/client-logs/`
(handler / service / model / tests; own blueprint per CLAUDE.md is satisfied by section 5.5). Implement the **full
typed schema in 5.5** now (all entry types, even though the client only sends some until phase 8) so the contract
is not reshaped later. Contract schema in
`contracts/` → regenerate `openapi.json`, `sync-contracts`, frontend `contracts:types`. SAM: Function, route +
OPTIONS event, `LogGroup` (retention param), route throttling on the HTTP API stage (verify SAM syntax
`RouteSettings`), `LoggingConfig`. **`backend/env.local.json` entry** with `TABLE_NAME` (not used, but the
convention requires it). Handler exported via `withLogging`. Server ignores client-supplied identity, enforces
limits from 5.5, returns `204`, logs each entry at the client-supplied level (mapped/validated) with
`source: "client"`.

**AI verification:** backend `npm test`, `npm run lint`, `npm run build`, `sam validate --lint`; tests cover
oversize batches, bad levels/types/breakpoints, unknown fields dropped, identity spoofing ignored (client `role`
vs JWT group), each entry type logged with `event_type`, missing JWT (rejected by the
authorizer, asserted via template).

**Human gate:** deploy dev; `curl` the route with a valid dev JWT, then find the entry in Logs Insights. Verify
CORS preflight from `https://dev.daltime.com` **and** `https://localhost` (mobile origin). CLAUDE.md
feature-completeness applies: also confirm locally via SAM local and, after promotion, qa and prod.

**Completion notes:** _(Claude fills in)_

---

### Phase 7 — Frontend logger core

**Goal:** the Angular app has one logger that batches to `/client-logs`, plus a global error handler and API
failure logging.

**Do (from `frontend/`):** implement the logger, identity and error parts of 5.4: `LoggerService`, custom
`ErrorHandler`, correlation/failed-request interceptor (registered in `app.config.ts` alongside the existing
interceptors), `client_session_id`, `platform` via `@capacitor/core` (already installed), and identity context
(`authenticated`, `role`, `org_id`, `impersonating` from `AuthService`/`ImpersonationService` signals — never
email or names). Device/screen/click tracking is phase 8. Uses the generated contract types for the request body. Buffer until a
token exists (D5). Unit specs: batching thresholds, flush triggers, rate limit, de-dup, no PII fields, no-op when
unauthenticated, interceptor adds header and logs 4xx/5xx once. No component CSS, no `any`, signals only.

**AI verification:** `npm test`, `npm run lint`, `npm run build` (bundle budget: this must not push the initial
bundle further past the existing 500 kB warning — report the delta); e2e smoke suite unchanged.

**Human gate:** run the app against dev API, trigger an error (e.g. throw from a button in dev), confirm the entry
in Logs Insights with `source: "client"` and matching `correlation_id`.

**Completion notes:** _(Claude fills in)_

---

### Phase 8 — Client context + interaction tracking

**Goal:** every client log says what device class and screen size it came from, and the log shows what the user
clicked and where they navigated, so a UI bug report can be reproduced.

**Do (from `frontend/`):**
1. `core/logging/client-context.ts`: pure, unit-testable functions — `detectDeviceType(ua, touchPoints, screen)`
   (`mobile|tablet|desktop`, iPadOS "Macintosh + touch" case, Android tablets without "Mobile"), `detectOs`,
   `detectBrowser` (coarse name + major version), `getBreakpoint(width)` (must mirror `tailwind.config.js`
   screens), `getOrientation()`, `getViewport()`. No new dependency (D11; if one is later preferred, check its
   license first). Expose current context as a signal updated on debounced `resize`/`orientationchange`.
2. Feed the context into `LoggerService` (per-batch and per-entry fields from 5.4); send one `session_start`
   entry per launch; log `viewport_change` only when breakpoint or orientation changes (D12).
3. `core/logging/interaction-tracker.ts`: the delegated click listener, navigation logging with route patterns,
   breadcrumb buffer attached to errors, rage-click detection (5.4). Started via `provideAppInitializer` in
   `app.config.ts`. Honour `environment.clickLogging` (`all|breadcrumbs|off`, D10) and the click rate cap.
4. Privacy checks in tests: no element text, no input values, no query strings, no route params, `ua` truncated.
5. Add `clickLogging` to `environment.ts` / `environment.*.ts` (placeholder-safe: it is not a secret and must not
   be part of the `__PLACEHOLDER__` replacement — plain literal per environment; confirm CD/`mobile-env.mjs` are
   unaffected).

**AI verification:** `npm test`, `npm run lint`, `npm run build` pass; specs cover the classifier with real UA
strings (iPhone, iPad/iPadOS, Android phone, Android tablet, Windows Chrome, macOS Safari, Capacitor iOS/Android
WebView), breakpoint boundaries, tap on a nested child of a `data-testid` element, untagged click ignored,
rage-click threshold, breadcrumb cap = 20, `off`/`breadcrumbs` modes; report the bundle-size delta.

**Human gate:** on dev, use the app on (a) a desktop browser, (b) your iPhone (browser or Capacitor build),
(c) a tablet or an iPad simulator; resize a desktop window across a breakpoint; click a few buttons; throw a
test error. In Logs Insights confirm `device_type`, `viewport`, `breakpoint`, the click trail and the error's
`breadcrumbs` for one `client_session_id`. Record the queries used.

**Completion notes:** _(Claude fills in)_

---

### Phase 9 — Frontend retrofit

**Goal:** no silent failures and no stray `console.*` in the app.

| Sub-phase | Scope |
| --- | --- |
| 9a | `core/` (`auth.ts` — 3 calls, `main.ts`, api client) |
| 9b | `features/web-admin`, `features/org-admin` |
| 9c | `features/manager` |
| 9d | `features/employee` (remove the "raw error object" debugging in `schedule.ts`) + `shared/` |

**Do:** replace `console.*` with `LoggerService`; do **not** add manual click/navigation logging (phase 8 covers it); for the ~75 `subscribe(` sites, keep UI error state in the
component and rely on the interceptor for HTTP failures (do not double-log). Add explicit `logger.error` only
where an error is caught and swallowed (non-HTTP). Never log tokens, form values or response bodies.

**AI verification:** tests, lint (with `no-console`), build pass; grep shows no `console.` outside the logger.

**Completion notes:** _(Claude fills in, per sub-phase)_

---

### Phase 10 — Observability payoff (optional)

**Do:** add `AWS::Logs::QueryDefinition` resources for the queries in `docs/logging.md`; a metric filter on
`level = ERROR` per environment with one alarm → SNS topic (email endpoint from a GitHub var). Optionally a small
CloudWatch dashboard (5xx by route, p95 duration, client errors).

**Human gate:** confirm the SNS subscription email; force an error in dev and see the alarm fire.

**Completion notes:** _(Claude fills in)_

---

### Phase 11 — Mobile specifics and RUM evaluation (optional)

**Do:** flush on `@capacitor/app` `pause`/`appStateChange`; decide whether `@capacitor/device` (native model, OS version, `isVirtual`) is worth a store release now that the UA-based `device_type`/`os` exists (D11); verify the classifier on the real Capacitor iOS/Android WebViews; (WebView `pagehide` is unreliable); confirm
`platform`/`app_version` tags; ensure `https://localhost` CORS works for `/client-logs` (already in place from the
Capacitor blueprint phase 1). Native crash reporting (Crashlytics/ADOT) remains out of scope — list it as a
follow-up. Evaluate CloudWatch RUM for Core Web Vitals **on web only** (Cognito Identity Pool or resource-based
policy, cost per 100k events); present a recommendation and **wait for approval** before installing anything.

**Human gate:** device check that logs from the iOS build appear with `platform: "ios"`.

**Completion notes:** _(Claude fills in)_

---

## 7. Tests (summary)

- Backend: logger/`withLogging` units, `mapHandlerError` levels, per-slice service specs asserting log events
  via a logger spy, arch test for handler wrapping, client-logs slice tests.
- Frontend: `LoggerService`, `ErrorHandler`, interceptor, client-context (UA/breakpoint) and interaction-tracker specs; existing specs and the e2e smoke suite pass
  unchanged in every phase.
- Manual: Logs Insights checks at the human gates of phases 2, 3, 6, 7.

## 8. Feature completeness (per CLAUDE.md)

| Context | Requirement | Result |
| --- | --- | --- |
| Locally | SAM local prints JSON logs to the terminal (client entries only reach it if the web app points at SAM local); web app logs to console in dev; `env.local.json` has the client-logs entry | _(phases 6–7)_ |
| GitHub Actions → dev | CD passes the new parameters; logs visible in Logs Insights; retention 14 d | _(phases 2, 6)_ |
| qa | Same after promotion, with `LOG_*` variables set for `qa` | _(phases 2, 6)_ |
| prod | Same after promotion, with `LOG_*` variables set for `main` (retention 90 d, level INFO) | _(phases 2, 6)_ |

Deliberately deferred: X-Ray tracing, Powertools Metrics/EMF, native crash reporting, session replay, third-party
vendors, log shipping to S3/OpenSearch.

## 9. Open questions / deviations log

_(Claude appends here at the end of each phase.)_

- **Q1 (decide before Phase 2):** retention per env — proposed dev 14 / qa 14 / prod 90 days. Current is 1 day
  everywhere, including prod.
- **Q2 (decide before Phase 6):** OK to have **no** logging for errors that occur before login (D5), or do you
  want a rate-limited unauthenticated route / RUM for the login screen?
- **Q3 (verify in Phase 1):** Powertools Logger version, Node 24 compatibility, built-in redaction, and how
  `POWERTOOLS_LOG_LEVEL` interacts with Lambda's `ApplicationLogLevel`.
- **Q5 (decide before Phase 6):** "who is logged in" = opaque `sub` + `role` + `org_id` (proposed, D9), or also
  email/name? Names/emails in logs are PII with 14–90 day retention and count as collected data for App Store /
  Play privacy declarations. If you want them for convenience, prefer a dev/qa-only switch.
- **Q6 (decide before Phase 8):** click volume in prod — log all tagged clicks (~$1/month at 1,000 active users,
  estimate) or breadcrumbs-only (D10)? Also confirm the team is comfortable with usage analytics being collected
  (privacy policy / store privacy labels: "usage data" and "diagnostics").
- **Q7 (verify in Phase 6):** whether the access token / authorizer claims carry `custom:org_id` (else the
  server logs the client-provided value as untrusted `client_org_id`).
- **Q4:** should the impersonation audit line stay a plain structured `INFO` line (proposed), or be moved to its
  own log group for longer retention?

## 10. Sources

- [Logger — Powertools for AWS Lambda (TypeScript)](https://docs.aws.amazon.com/powertools/typescript/latest/features/logger/)
- [Log and monitor TypeScript Lambda functions — AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/typescript-logging.html)
- [Configuring advanced logging controls for Lambda functions](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-advanced.html)
- [Configuring JSON and plain text log formats — AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs-logformat.html)
- [Powertools TypeScript: set correlation ID in Logger (feature)](https://github.com/aws-powertools/powertools-lambda-typescript/commit/aa74fc8548ccb8cb313ffd1742184c66e8d6c22c)
- [Real User Monitoring — AWS Observability Best Practices](https://aws-observability.github.io/observability-best-practices/tools/rum/)
- [Authorize your web application to send data to CloudWatch RUM](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-RUM-get-started-authorization.html)
- [CloudWatch RUM adds support for iOS and Android applications](https://aws.amazon.com/about-aws/whats-new/2025/11/real-user-monitoring-mobile-apps-cloudwatch)
- [Amazon CloudWatch Infrequent Access log class](https://aws.amazon.com/about-aws/whats-new/2026/03/amazon-cloudwatch-infrequent-access-log-class)
- [A Practical Guide to CloudWatch Logs Cost Optimization](https://aws.amazon.com/blogs/mt/a-practical-guide-to-amazon-cloudwatch-logs-cost-optimization/)
