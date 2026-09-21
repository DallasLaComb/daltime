# Capacitor Mobile Shell (Frontend) — Blueprint

Status: **Approved for phased implementation — Phases 1–6b code complete (6b awaits the real-iPhone gate); Phase 7 is next.**

---

## 0. How to use this blueprint (protocol for Claude)

The work is split into numbered phases (section 6). The user will say **"implement phase N"**.
When they do:

1. Read this whole file, then `CLAUDE.md`. Note: `CLAUDE.md` references `ai/context/*` and
   `ai/prompts/*`, which do **not exist** in this repo — follow `CLAUDE.md` itself and the
   existing conventional-commit style in `git log` instead.
2. Confirm every earlier phase is ✅ in the progress table. If not, stop and tell the user.
3. Implement **only** phase N. Do not start phase N+1 or pull work forward.
4. Follow the repo rules: Tailwind only, no `any`, signals only, ESM `.js` imports in backend,
   `data-testid` on interactive elements, all imports of shared components via `@common-daltime`.
   Stage every touched file with `git add`, run `npx lint-staged`, and fix **all** lint errors in
   every file touched (pre-existing ones included).
5. Do not commit or push unless the user asks. You may propose a commit message.
   Working branch: **do not implement on `dev` directly** — a push to `dev`/`qa`/`main`
   triggers CD. Use a feature branch (e.g. `feature/capacitor`) and tell the user if the current
   branch is `dev`.
6. Run the phase's **AI verification** checklist and report real results (failures included).
7. **Human gates** listed in a phase are things Claude cannot do (Xcode, device testing, Apple /
   Google accounts, GitHub secrets, store consoles). Do the AI part, then list the human
   steps clearly. If a later phase depends on an unfinished human gate, mark it ⏸ Blocked.
8. At the end of the phase, **update this file**: set the phase status in the progress table,
   fill in that phase's *Completion notes* (what was done, files touched, deviations, anything
   the next phase must know), and add any new open questions to section 9.
9. Finish your reply with a short summary and the line: **"Phase N complete — ready for
   Phase N+1."** (or state what is blocking).

Status legend: ⬜ not started · 🟡 in progress · ✅ done · ⏸ blocked on a human step

---

## 1. Summary

Wrap the existing Angular app in a Capacitor native shell to ship Android and iOS apps that
supplement the web app. Same Angular codebase, same backend, same Cognito user pools. No Ionic
UI framework (see section 3). The native shells are build outputs of the existing `ng build`; they
add no new features and no new backend routes.

In scope: the shell, an optional Face ID / Touch ID app lock (phase 6b), per-environment builds (dev/qa/prod), persistent token storage, native UX
polish, GitHub Actions pipelines that build and release the apps, and (optional, last) OTA live
updates for web-only fixes.

Out of scope: push notifications, offline mode, store listing content
(screenshots, descriptions, review submission).

---

## 2. Version decisions

| Item | Choice | Why |
| --- | --- | --- |
| Capacitor | **8.x** (`@capacitor/core`, `cli`, `android`, `ios`, all on the same version) | Current active major (released 2025-12-08). v7 is Extended Support; older is End of Support. Capacitor does not use the term "LTS" — v8 is the supported line. Latest patch when this was written per npm: 8.5.2. |
| Angular compatibility | No constraint | Capacitor is framework-agnostic; it only consumes the built `index.html` + assets. |
| Node | 22+ required; repo uses **24** locally and in CI | No change |
| iOS | Xcode 26.0+, deployment target 15.0, Swift Package Manager (Capacitor 8 default) | Capacitor 8 requirement |
| Android | Android Studio 2025.2.1 (Otter)+ (or command-line tools), **JDK 21** (JDK 17 fails: `invalid source release: 21` compiling `capacitor-android`), Gradle 8.13, minSdk 24, compile/targetSdk 36 | Capacitor 8 requirement |

Pin exact Capacitor versions in `package.json` (no floating `^` between core/cli/platforms — all
four stay on the same version). Re-check the latest 8.x on npm when phase 2 runs.

---

## 3. Ionic — decision: do NOT add Ionic Framework

Ionic Angular v9 supports Angular 18–22, so it is *compatible*. We still recommend against it.

What Ionic would give us: mobile-native-feeling components (`ion-list`, `ion-modal`, etc.), page
transitions and swipe-back via `ion-router-outlet`, safe-area/theming utilities, and
`@ionic/angular-toolkit`.

Why it does not fit DalTime:

1. **Styling rules conflict.** Project rule: Tailwind utility classes only, no component CSS,
   shared components from `@common-daltime`. Ionic ships its own CSS variables/shadow-DOM theming
   — a second, competing styling system.
2. **Duplicated component inventory.** We already have `<app-button>` and a shared component set.
   Ionic means duplicating them or rewriting every screen — defeating "same as the Angular app."
3. **Routing coupling.** Ionic wants `ion-router-outlet` in place of Angular's `router-outlet`.
   That changes routes, guards flow and e2e behavior for the *web* app too (one codebase).
4. **Native APIs need nothing from it.** Capacitor plugins cover them directly.
5. **Bundle size.** Adds weight against the 500 kB warning / 1 MB error initial budgets.

Revisit if the mobile UX feels non-native. Cheaper mitigation first: Tailwind tweaks for touch
targets and safe areas (`env(safe-area-inset-*)`).

---

## 4. Decisions and assumptions

Defaults below are used unless the user changes them **before the phase that needs them**.

| # | Decision | Default | Needed by |
| --- | --- | --- | --- |
| D1 | App / bundle ID | `com.daltime.app` (`.dev`, `.qa` suffix for non-prod) | Phase 2 |
| D2 | Token storage plugin | A Keychain/Keystore-backed secure-storage plugin **if** it supports Capacitor 8 (verify by web search in phase 5); otherwise `@capacitor/preferences` and record the tradeoff | Phase 5 |
| D3 | Prod in scope for first cut | Yes for code and CORS; store release to prod only via manual approval | Phase 1 |
| D4 | Apple Developer + Google Play accounts | Assumed **not yet available**; phases 2–8 do not need them. Phases 9–10 are ⏸ until the user has them | Phase 9 |
| D5 | Where per-env CORS values live | **Resolved:** GitHub environment variable `ALLOWED_ORIGINS` (per env: dev/qa/main), passed in `.github/workflows/cd.yml` (`AllowedOrigins=${{ vars.ALLOWED_ORIGINS }}`). Local: hardcoded `--parameter-overrides` in `.vscode/tasks.json`, `tasks.linux.json`, `tasks.windows.json`. The template default is only a fallback | — |
| D6 | Mobile frontend build source | Rebuild in the mobile workflow (`npm run build`) and replace placeholders with the same values `cd.yml` uses; do **not** reuse the CD artifact-resolution logic | Phase 3 |
| D7 | OTA vendor | Decide at phase 11 (Capgo vs Capawesome Cloud); re-verify pricing and current docs then | Phase 11 |

---

## 5. Design reference

### 5.1 Planned files

```
frontend/
  capacitor.config.ts                # appId/appName/webDir/server scheme, per-env via NODE_ENV
  android/                           # generated by `npx cap add android` — committed
  ios/                               # generated by `npx cap add ios` — committed
  scripts/mobile-env.mjs             # replaces __PLACEHOLDERS__ in the built bundle per environment
  src/app/core/storage/
    token-storage.ts                 # abstraction: sessionStorage (web) / native storage (mobile)
    token-storage.spec.ts
  src/app/core/auth/auth.ts          # refactor: use token-storage instead of sessionStorage directly
  0-capacitor.blueprint.md           # this file
infra/template.yaml                  # AllowedOrigins default gains the Capacitor WebView origin
.vscode/tasks*.json                  # local deploy overrides gain the origin
.github/workflows/mobile-*.yml       # Android / iOS build + release (phases 8–10)
.gitignore / sonar-project.properties   # exclude native build output (ESLint already scoped to src)
```

`token-storage.ts` lives in `core/` (cross-cutting, like `core/auth`, `core/guards`). No new
shared UI components are introduced.

### 5.2 `capacitor.config.ts` essentials

- `appId`, `appName`
- `webDir: 'dist/frontend/browser'` (verify it contains `index.html`; the build also emits
  `prerendered-routes.json` — confirm this doesn't break the shell's `index.html`)
- `server.androidScheme: 'https'` — Android serves from `https://localhost`.
  **iOS cannot use https**: `WKWebView` already handles `http`/`https`, so Capacitor ignores an `https`
  `iosScheme` and falls back to `capacitor://localhost` (`CAPInstanceDescriptor.swift`). *(The original plan
  assumed one shared `https://localhost` origin; wrong, found on the first real iPhone test.)*
- **`plugins.CapacitorHttp.enabled: true`** — required for iOS. API Gateway **HTTP APIs reject non-http(s)
  origins** in `CorsConfiguration` ("Invalid format for origin capacitor://localhost" — CloudFormation rolled
  the dev stack back when this was tried), so the API can never allow the iOS origin. `CapacitorHttp` sends
  `fetch`/`XMLHttpRequest` through the native HTTP stack on device: no `Origin` header, no CORS. Web unaffected.
- **No** `server.url` (that would load a remote site and defeat bundled assets), except an
  optional, clearly-labeled live-reload dev config

### 5.3 Environments

Branch names are environment names: `dev`, `qa`, `main` (prod). Angular configs also include
`local` and `development`.

| Env | Android flavor / iOS scheme | appId |
| --- | --- | --- |
| dev | `dev` / "App Dev" | `com.daltime.app.dev` |
| qa | `qa` / "App QA" | `com.daltime.app.qa` |
| prod (`main`) | `main` / "App" | `com.daltime.app` |

Follows Capacitor's [environment-specific configuration guide](https://capacitorjs.com/docs/guides/environment-specific-configurations):
Android product flavors with `applicationIdSuffix`, duplicated Xcode targets/schemes, and a
`capacitor.config.ts` switching on `NODE_ENV`. Distinct IDs let dev/qa/prod install side by side.

**How the web bundle gets its values (important):** CI builds once with `npm run build` using the
base `environment.ts`, whose values are placeholders (`__API_BASE_URL__`,
`__VITE_COGNITO_USER_POOL_ID__`, `__VITE_COGNITO_CLIENT_ID__`, `__VITE_COGNITO_REGION__`,
`__VITE_COGNITO_DOMAIN__`). CD then `sed`-replaces them from the foundation and SAM stack outputs
of each environment. The mobile build must do the same replacement per environment (D6).
`environment.dev.ts` and others contain hardcoded values and are used by local `ng serve`
configs, not by the CD path. Do not assume `-c dev` / `-c qa` builds produce identical config to
CD — use the placeholder route for CI and local scripts alike so there is one source of truth.

The `local` config (SAM local at localhost) is web-only. Mobile testing runs against the deployed
dev API, since a device/emulator cannot reach the dev machine's SAM local without extra networking.

### 5.4 Backend / infra

**CORS** (blocks the feature if missed). `AllowedOrigins` feeds both API Gateway
`CorsConfiguration.AllowOrigins` and the `ALLOWED_ORIGINS` Lambda env var
(`infra/template.yaml`). It must include `https://localhost` (Android WebView). `capacitor://localhost` (iOS) **cannot** be added — API Gateway rejects it — so iOS relies on `CapacitorHttp` (5.2) instead. Because CD passes
`vars.ALLOWED_ORIGINS` explicitly, **changing only the template default does nothing in deployed
environments** — the three GitHub environment variables must also be updated (a human step, and
must happen before the next CD run or the deploy will drop the origin).

- Security: `https://localhost` is inside the device sandbox; every route still requires a valid
  Cognito JWT. Prod inclusion is intentional.
- Headers already allowed: `Content-Type`, `Authorization`, `X-Impersonate-User` — no change.
- No new routes: no `env.local.json`, Lambda or LogGroup changes.

**Cognito:** auth is direct Cognito SDK calls (`auth.ts`), no Hosted UI redirect, so no deep
links or callback URLs are needed. No app-client changes expected.

### 5.5 Token storage (required, not optional)

`auth.ts` keeps access/id/refresh tokens in **`sessionStorage`** (`auth.ts:68` etc.);
`impersonation.service.ts` uses it for impersonation context. On mobile `sessionStorage` is
cleared when the app is killed, so users would log in on every cold start and the refresh token
would be lost. `localStorage` doesn't fix it either (the OS can evict WebView storage).

Design: a `TokenStorage` service in `core/storage/`. To avoid turning the whole auth surface async
(guards and interceptors likely read auth state synchronously), keep an **in-memory cache that is
hydrated once at startup** (`provideAppInitializer`) from native storage, with **write-through**
to native storage. Web behavior stays exactly as today (`sessionStorage`). Impersonation context
stays in `sessionStorage` (intentionally short-lived). Read `auth.ts`, the guards and the
interceptor before deciding the final shape; record any deviation.

### 5.6 UI / UX (web-safe, Tailwind only)

- `viewport-fit=cover` in `index.html`; Tailwind padding with `env(safe-area-inset-*)` on
  navbar/footer containers (Capacitor 8 removed margin handling in favor of CSS env variables /
  the System Bars plugin).
- `@capacitor/status-bar`, `@capacitor/splash-screen`; default splash is acceptable.
- Android hardware back button: default closes the app at the root; verify it walks Angular router
  history (`@capacitor/app` `backButton` listener if not).
- Touch targets ≥ 44 px on primary actions; `data-testid` on every new interactive element.

### 5.7 Repo hygiene

- Commit `android/` and `ios/`; gitignore build output (`android/app/build`, `android/.gradle`,
  `android/local.properties`, `ios/App/Pods` if present, `ios/**/DerivedData`, `*.keystore`,
  `*.jks`, `*.p12`, `*.mobileprovision`, `*.p8`, `google-services.json` if added, fastlane
  output). Never commit signing material.
- ESLint runs on `src` only, so native dirs are already excluded (verify). Add `android/` and
  `ios/` to `sonar.exclusions` in `sonar-project.properties`.
- lint-staged config location was not found in the repo root or `frontend/package.json` — locate
  it in phase 2 and confirm its globs don't match native files (Kotlin/Java/Swift/XML/Gradle).

### 5.8 CI/CD pipelines (phases 8–10)

- Trigger: `workflow_dispatch` (input: environment `dev|qa|main`) and optionally tags such as
  `mobile-v*`. **Not on every push** — macOS runner minutes are the expensive part.
- Environment protection: secrets/vars scoped to GitHub environments `dev`, `qa`, `main`, so
  prod release can require manual approval.
- Build numbers: `versionCode` (Android) and `CFBundleVersion` (iOS) from `github.run_number`;
  marketing version from a single source (e.g. `frontend/package.json` version or a tag).
- **Android** (ubuntu): JDK 21, Node 24, `npm ci`, `npm run build`, placeholder replacement,
  `npx cap sync android`, Gradle `bundleRelease` for the env's flavor, sign with keystore from
  secrets, upload AAB as an artifact; later upload to Google Play (internal track for dev/qa,
  production track behind approval).
  Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`.
- **iOS** (macOS): the runner image must have **Xcode 26+** (Capacitor 8) — verify current
  `macos-*` image contents before writing the workflow; select Xcode explicitly. fastlane with
  `match` (or a documented alternative) for signing, build the env's scheme, upload to
  TestFlight. Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_PASSWORD`,
  plus a private certificates repo or equivalent.
- Pin third-party actions to commit SHAs like the existing workflows do.

### 5.9 OTA live updates (phase 11, optional)

Lets installed apps pick up new web bundles without a store release. Rules: Apple guideline 3.3.2
allows only JavaScript/web-asset updates, not native code or major new functionality; Google
exempts WebView JavaScript. Anything touching plugins, permissions, `android/` or `ios/` needs a
full store release. Vendor options: **Capgo** (designed to run from your own GitHub Actions,
self-hostable) and **Capawesome Cloud**; Ionic Appflow is shutting down (2027-12-31) — do not use.
Both vendor comparisons are vendor-authored; verify independently. One update channel per
environment, and bundles must be tied to compatible native versions so an OTA bundle never
reaches an older native shell it can't run on.

---

## 6. Phases

### Progress

| Phase | Title | Human gate? | Status |
| --- | --- | --- | --- |
| 1 | CORS origin for the mobile WebView (infra + local + env vars) | Yes — set 3 GitHub env vars, deploy | ✅ (Android origin only; iOS via CapacitorHttp — see notes) |
| 2 | Capacitor scaffold (install, config, add platforms, hygiene) | Maybe — needs Xcode/CocoaPods/SPM for `cap add ios` | ✅ (simulator/emulator run still optional) |
| 3 | Environment support: Android flavors, config switching, build scripts | No | ✅ |
| 4 | iOS environment targets/schemes | Yes — verify in Xcode | ✅ (simulator side-by-side verified by Claude; Xcode eyeball optional) |
| 5 | Persistent token storage (auth refactor) | Yes — relaunch check on a device/simulator | ✅ (verified on a physical iPhone) |
| 6 | Native UX polish (safe areas, status bar, back button, splash) | Yes — visual check | ✅ (iOS simulator screenshot verified by Claude; physical iPhone + Android emulator check is yours) |
| 6b | Face ID / Touch ID app lock (added 2026-09-20 at the user's request) | Yes — real device | 🟡 code done; ⏸ real-iPhone check is yours |
| 7 | Docs + verification checkpoint (regression + device acceptance) | Yes — device testing | ⬜ |
| 8 | CI: Android signed build workflow (artifact only) | Yes — keystore secrets | ⬜ |
| 9 | CI: Android release to Google Play | Yes — Play account + service account | ⬜ |
| 10 | CI: iOS build + TestFlight | Yes — Apple account + secrets | ⬜ |
| 11 | OTA live updates (optional) | Yes — vendor account | ⬜ |

Phases 1–7 need no paid accounts. Phases 8–11 can be deferred without blocking anything else.

---

### Phase 1 — CORS origin for the mobile WebView

**Goal:** the deployed API accepts requests from the Capacitor Android WebView origin
`https://localhost` in every environment, and local dev deploys keep working. (iOS is handled by `CapacitorHttp`, see 5.2.)

**Do:**
1. `infra/template.yaml`: add `https://localhost` to the `AllowedOrigins` parameter default
   (keep `http://localhost:4200`). Update its description.
2. `.vscode/tasks.json`, `.vscode/tasks.linux.json`, `.vscode/tasks.windows.json`: add
   `https://localhost` to each `'AllowedOrigins=…'` override in the "Backend: Deploy to Dev" task,
   keeping the three files consistent.
3. Grep for any other consumer of `ALLOWED_ORIGINS` / `AllowedOrigins` (backend code, `bruno/`,
   docs, `env.local.json`) and update or report.
4. Write the exact `gh` commands the human must run to update the `ALLOWED_ORIGINS` variable in
   each GitHub environment (`dev`, `qa`, `main`), **first reading the current values**
   (`gh variable list --env <env> --repo DallasLaComb/daltime`) so existing origins such as
   `https://dev.daltime.com` are preserved and only `https://localhost` is appended. Do not run
   the `set` commands yourself — these are outward-facing changes; print them for the user.

**AI verification:** `sam validate --template-file infra/template.yaml --lint` (if `sam` is
installed; otherwise say so), git diff shows only intended lines, no other `AllowedOrigins`
consumer missed.

**Human gate:** run the printed `gh variable set` commands for dev, qa, main; deploy dev (task
"Backend: Deploy to Dev" or push via normal flow); then verify preflight:
`curl -i -X OPTIONS <dev-api>/<any-route> -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'`
returns `access-control-allow-origin: https://localhost`. Record the result in Completion notes.

**Completion notes:** (2026-09-20, branch `feature/capacitor`, created from `dev`; nothing committed)

- Files touched: `infra/template.yaml` (`AllowedOrigins` default now `http://localhost:4200,https://localhost`,
  description updated); `.vscode/tasks.json`, `tasks.linux.json`, `tasks.windows.json` and `README.md`
  (deploy command override now `AllowedOrigins=http://localhost:4200,https://dev.daltime.com,https://localhost`).
  README was not listed in the plan but contained the same override, so it was kept consistent.
- Other consumers: `backend/src/functions/shared/response.ts` reads `ALLOWED_ORIGINS` from the Lambda env
  (fed by the template) — no change needed. `cd.yml:265` passes `vars.ALLOWED_ORIGINS` — no change needed.
  `bruno/` and `env.local.json` have no reference to it.
- Verification: `sam validate --lint` passes (SAM CLI 1.165.0). `actionlint` not installed (n/a this phase).
- Current GitHub env values (read 2026-09-20): dev = `http://localhost:4200,https://dev.daltime.com`;
  qa = `https://qa.daltime.com`; main = `https://daltime.com`.
- **GitHub variables set (2026-09-20, via `gh variable set`, read back and verified):** dev, qa and main
  `ALLOWED_ORIGINS` now include `https://localhost` (values below).
- **Deployed:** commit `862e37f` pushed to `dev` on 2026-09-20; CI and `CD — dev` (run 35540589369) succeeded.
- **Preflight result (2026-09-20):** `OPTIONS https://ddy3hzd0ef.execute-api.us-east-1.amazonaws.com/employee/shifts`
  with `Origin: https://localhost` → `HTTP/2 200`, `access-control-allow-origin: https://localhost`,
  `access-control-allow-headers: authorization,content-type,x-impersonate-user`. Passes for dev.
  qa and prod have the variable set but will only pick it up on their next CD deploy; verify then (phase 7).

```bash
# already run:
gh variable set ALLOWED_ORIGINS --env dev  --repo DallasLaComb/daltime --body 'http://localhost:4200,https://dev.daltime.com,https://localhost'
gh variable set ALLOWED_ORIGINS --env qa   --repo DallasLaComb/daltime --body 'https://qa.daltime.com,https://localhost'
gh variable set ALLOWED_ORIGINS --env main --repo DallasLaComb/daltime --body 'https://daltime.com,https://localhost'
```

- Preflight check: `curl -i -X OPTIONS <dev-api>/<any-route> -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'`
  → expect `access-control-allow-origin: https://localhost`. Result: see above.
- Note for later phases: the Lambda `setRequestOrigin` falls back to the FIRST allowed origin when the
  request origin isn't listed, so a missing `https://localhost` shows up as a CORS mismatch, not a 403.
- **REOPENED then RESOLVED 2026-09-20 (first iPhone test: login worked, then "Failed to load schedule").**
  iOS sends `Origin: capacitor://localhost` (not `https://localhost`). API Gateway access logs showed preflight
  `OPTIONS` 200 with no following `GET`: the response carried no matching `access-control-allow-origin`, so the
  WebView blocked every real request (login still worked — it goes straight to Cognito).
  - **Attempt 1 (failed, reverted):** add `capacitor://localhost` to `AllowedOrigins` (template, tasks, README,
    GitHub vars). CD then **failed** (`daltime-backend-dev` → `UPDATE_ROLLBACK_COMPLETE`, dev left on the previous
    good version): `Invalid format for origin capacitor://localhost` from API Gateway V2. The three GitHub
    variables and the template were restored to `…,https://localhost` (commit revert of `522b241`).
    **Lesson:** never put a non-http(s) origin in `AllowedOrigins`; it breaks every deploy in that environment.
  - **Fix that stays:** `CapacitorHttp` (5.2). Verify on device after `npm run mobile:ios:dev` → ⌘R.
  - Note: `https://localhost` remains in the variables/template for Android's WebView origin and is harmless.

---

### Phase 2 — Capacitor scaffold

**Goal:** the Angular app builds and `npx cap sync` copies it into generated `android/` and
`ios/` projects. No behavior changes to the web app.

**Do (from `frontend/`):**
1. Check the latest Capacitor 8.x on npm; install `@capacitor/core`, `@capacitor/cli`,
   `@capacitor/android`, `@capacitor/ios` all at the **same exact version**.
2. `npx cap init "DalTime" com.daltime.app --web-dir dist/frontend/browser`; convert to
   `capacitor.config.ts` per 5.2 (`androidScheme`/`iosScheme` = `https`, no `server.url`).
3. Run `npm run build`; confirm `dist/frontend/browser/index.html` exists and is the real app
   shell (investigate `prerendered-routes.json`); then `npx cap add android` and
   `npx cap add ios`, then `npx cap sync`. If `cap add ios` fails for missing Xcode/SPM tooling,
   report the exact error and stop that sub-step (mark the phase 🟡 with the iOS sub-step ⏸).
4. Hygiene per 5.7: `.gitignore` entries, `sonar.exclusions`, locate lint-staged config and
   confirm it ignores native files, confirm `eslint src` doesn't touch native dirs.
5. Add npm scripts: `cap:sync` (`npm run build && npx cap sync`), `cap:open:android`,
   `cap:open:ios`.

**AI verification:** `npm run build` passes (budgets OK); `npm run lint` and `npm test` pass;
`npx cap doctor` output reviewed; `git status` shows native folders present and no build
artifacts or secrets staged; `npx lint-staged` passes.

**Human gate (optional now, needed by phase 7):** `npm run cap:open:android` /
`cap:open:ios` and run the default build on an emulator/simulator to confirm the shell loads
(login screen renders; API calls will fail CORS-wise until phase 1 is deployed — expected).

**Completion notes:** (2026-09-20, branch `feature/capacitor`; staged, not committed)

- Installed `@capacitor/core|android|ios` (dependencies) and `@capacitor/cli` (devDependency), all pinned
  exactly to **8.5.2** (latest 8.x on npm at the time). `npx cap doctor` reports iOS and Android healthy.
- `frontend/capacitor.config.ts` per 5.2: `appId com.daltime.app`, `appName DalTime`,
  `webDir dist/frontend/browser`, `androidScheme`/`iosScheme` = `https`, no `server.url`.
  Per-env switching on `NODE_ENV` is phase 3.
- `dist/frontend/browser/index.html` is the real app shell. There is **no** `prerendered-routes.json` in
  the output (no SSR/prerender configured), so nothing to handle there.
- `cap add android` and `cap add ios` both succeeded; `iOS uses Swift Package Manager` (no CocoaPods needed).
  `npm run cap:sync` exits 0. Native projects are committed (73 files); Capacitor's own `android/.gitignore`
  and `ios/.gitignore` already exclude generated output (`public/`, `capacitor.config.json`, `config.xml`, build dirs).
- Hygiene: root `.gitignore` gained signing-material/build patterns (`*.keystore`, `*.jks`, `*.p12`,
  `*.mobileprovision`, `*.p8`, `google-services.json`, `GoogleService-Info.plist`, `.env.mobile.*` except
  `.env.mobile.example`, Pods, DerivedData, Gradle, fastlane output). `sonar.exclusions` gained
  `frontend/android/**,frontend/ios/**`. `eslint src` only lints `src`, so native dirs and
  `capacitor.config.ts` are untouched by lint.
- **lint-staged does not exist in this repo** (no config in root/`frontend`/`backend`, no `package.json`
  entry, no `.husky`, no git hooks). `npx lint-staged` therefore fails with "could not find any valid
  configuration"; CLAUDE.md's lint-staged rules are aspirational. `npm run lint` (`eslint src`) is the real gate.
- npm scripts added: `cap:sync`, `cap:open:android`, `cap:open:ios`.
- Verification: `npm run build` passes (pre-existing warnings only: initial bundle 560.61 kB vs the 500 kB
  warning budget, NG8102 in organizations.html, `bowser` CommonJS; none introduced here); `npm run lint`
  clean; `npm test` 39 files / 538 tests pass; staged files contain no build artifacts or secrets.
- Environment notes: Xcode 27.0 is installed. The Xcode license had to be accepted (`sudo xcodebuild -license accept`)
  before `/usr/bin/git` worked, and `xcodebuild -runFirstLaunch` was still pending (simulator tools missing)
  when checked. Android SDK/JDK not checked yet (needed in phase 3).
- **Simulator smoke test (2026-09-20, iPhone 18 Pro, iOS 27.0 simulator):** `cap run ios` built successfully
  (xcodebuild 124 s) and the shell loads the real landing page ("Scheduling made simple."). Observed for phase 6:
  the navbar renders **under** the status bar (clock overlaps the logo) because safe-area insets are not applied yet.
  `cap run ios` then fails at the deploy step ("Simulator.app does not exist" — Xcode 27 no longer ships
  `Simulator.app` at the path Capacitor 8.5.2 expects). Workaround: `xcrun simctl boot <id>`,
  `xcrun simctl install <id> ios/DerivedData/<id>/Build/Products/Debug-iphonesimulator/App.app`,
  `xcrun simctl launch <id> com.daltime.app`. Physical device runs go through Xcode (⌘R) instead.
- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` was generated by the first
  build and is committed to pin the SPM dependency versions.
- **Human gate (optional now, needed by phase 7):** `npm run cap:open:ios`, run on a simulator or a device
  and confirm the shell loads the login screen. API calls will still show placeholder values until phase 3's
  `mobile-env.mjs` runs (the build contains `__API_BASE_URL__` etc.), so login will not work yet.


---

### Phase 3 — Environments (Android + config + scripts)

**Goal:** dev, qa and prod builds of the Android app exist as separate flavors with separate app
IDs, each pointing at the right backend; one script produces a ready-to-sync bundle per env.

**Do:**
1. `frontend/scripts/mobile-env.mjs`: takes `dev|qa|main`, and replaces the placeholders in
   `dist/frontend/browser` (same five placeholders and file types as `cd.yml` "Replace
   environment placeholders"). Values come from env vars (`API_BASE_URL`,
   `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION`, `COGNITO_DOMAIN`) so CI can
   supply stack outputs; for local runs, read known dev values from a git-ignored
   `frontend/.env.mobile.<env>` file (add an example file `frontend/.env.mobile.example`, no real
   secrets — these values are not secret but keep the pattern). Fail loudly if any placeholder
   remains after replacement or a required var is missing.
2. `capacitor.config.ts`: switch `appId`/`appName` on `NODE_ENV` per 5.3
   (`DalTime Dev`, `DalTime QA`, `DalTime`).
3. Android: add `productFlavors` `dev`, `qa`, `main` in `android/app/build.gradle` with
   `applicationIdSuffix` (`.dev`, `.qa`, none) and per-flavor `app_name` resources. Keep
   Capacitor's generated structure intact so `cap sync` keeps working.
4. npm scripts: `mobile:build:<env>` (build → `mobile-env.mjs` → `cap sync android`), plus
   `mobile:android:<env>` to open/run that flavor.
5. Document required env values and where to find them (the foundation stack outputs / SAM stack
   outputs used in `cd.yml`).

**AI verification:** `node scripts/mobile-env.mjs` fails clearly with missing vars and with a
leftover placeholder (unit-style test in `scripts/` or a small vitest spec); `./gradlew
assembleDevDebug` (in `android/`) succeeds if a JDK/Android SDK is present, otherwise report as
not verified; web `npm run build && npm test && npm run lint` still pass.

**Human gate:** install `devDebug` and `qaDebug` side by side on an emulator; confirm both
launch and show distinct names.

**Completion notes:** (2026-09-20, branch `feature/capacitor`; staged, not committed) — done iPhone-first at the user's request.

- **Scripts (`frontend/scripts/`, all dependency-free Node ESM):**
  - `mobile-env.mjs <dev|qa|main> [--dist dir]` replaces the same five placeholders in `.html/.js/.txt` as `cd.yml`.
    Values: real env vars (CI) override `frontend/.env.mobile.<env>`. Fails loudly on missing vars (lists all),
    unknown env, unsafe characters (values are inlined into JS strings), a leftover `__…__` placeholder, a missing
    bundle, or **zero** replacements (already-processed bundle — running it twice on one build fails on purpose).
  - `mobile-env-pull.mjs <env>` writes `.env.mobile.<env>` from CloudFormation outputs using the `daltime-<dev|qa|prod>`
    AWS profiles (`ApiEndpoint` from `daltime-backend-<dev|qa|prod>`; `UserPoolId`, `UserPoolClientId`,
    `CognitoRegion`, `CognitoDomain` from `daltime-foundation-<dev|qa|main>`). Not added by the blueprint; added so
    "where do the values come from" lives in code. The dev file was generated and matches `environment.dev.ts`.
  - `mobile-build.mjs <env> [ios|android|all] [--open]` = `npm run build` → `mobile-env.mjs` → `cap sync <platform>`
    with `NODE_ENV=<env>` → optional `cap open`. A Node orchestrator instead of `cross-env` (no new dependency;
    also works on Windows).
  - `mobile-env.test.mjs`: 8 `node:test` cases (`npm run test:scripts`), all pass.
- **npm scripts:** `mobile:env:pull:{dev,qa,main}`, `mobile:build:{dev,qa,main}` (build + sync **both** platforms),
  `mobile:ios:{…}` and `mobile:android:{…}` (build + sync + open that platform), `test:scripts`.
  (Syncing iOS here pulls the "also run `cap sync ios`" item forward from phase 4; the Xcode targets/schemes
  themselves are still phase 4.)
- **`capacitor.config.ts`:** `appId`/`appName` switch on `NODE_ENV` (`dev` → `com.daltime.app.dev` / "DalTime Dev",
  `qa` → `.qa` / "DalTime QA", `main` **and anything else/unset** → `com.daltime.app` / "DalTime"). Verified:
  `mobile:build:dev` writes `com.daltime.app.dev` into both native `capacitor.config.json` files. This does **not**
  change the iOS bundle identifier (that lives in the Xcode project — phase 4).
- **Android flavors (`android/app/build.gradle`):** `flavorDimensions env` with `dev` (`.dev`), `qa` (`.qa`), `prod`
  (no suffix); per-flavor `app_name`/`title_activity_main` in `android/app/src/{dev,qa}/res/values/strings.xml`.
  **Deviation:** the production flavor is named **`prod`, not `main`** — AGP reserves `main` (the default source set),
  so a flavor with that name is rejected. The environment is still called `main` everywhere else; scripts map
  `main` → `prod`. Variants: `devDebug|qaDebug|prodDebug` (+ `…Release`); release bundle task is
  `bundleProdRelease` etc. — **phase 8 must use these names.** `cap sync android` leaves `build.gradle` untouched
  (checked with a diff).
- **Verification run:** `npm run mobile:build:dev` succeeded end to end for both platforms; the real dev API URL is
  in `ios/App/App/public/chunk-*.js` and `android/.../public/chunk-*.js`; no `__API_BASE_URL__`/`__VITE_*`
  left; `xcodebuild` Debug build for the iPhone 18 Pro simulator **BUILD SUCCEEDED** and the app launches;
  `npm run lint`, `npm test` (39 files / 538 tests) and `npm run test:scripts` pass.
- **Android verified (2026-09-20):** installed via Homebrew — `openjdk@21`, `android-commandlinetools` (SDK root
  `/opt/homebrew/share/android-commandlinetools`; packages `platform-tools`, `platforms;android-36`,
  `build-tools;36.0.0`, `emulator`, `system-images;android-36;google_apis;arm64-v8a`; licenses accepted by the user)
  and an AVD `DalTime_Pixel_API36` (Pixel 8, API 36). `frontend/android/local.properties` (`sdk.dir=…`, git-ignored)
  points Gradle at the SDK; Gradle needs
  `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`.
  `./gradlew assembleDevDebug assembleQaDebug assembleProdDebug` → **BUILD SUCCESSFUL**. `aapt2 dump badging`:
  `com.daltime.app.dev` "DalTime Dev", `com.daltime.app.qa` "DalTime QA", `com.daltime.app` "DalTime" (so the
  flavors coexist). `devDebug` and `qaDebug` installed side by side on the emulator; `devDebug` launches, loads
  `https://localhost`, registers `CapacitorHttp`, and renders the landing page. (`adb shell monkey` did not
  foreground it; `adb shell am start -n com.daltime.app.dev/com.daltime.app.MainActivity` did.)
  **Caveat:** all flavors package whatever bundle the last `cap sync` copied. Run `npm run mobile:build:<env>`
  for the environment you are about to install; the QA APK built above contains the **dev** bundle.
- **iPhone verified by the user (2026-09-20):** `mobile:ios:dev` build runs on a physical iPhone 16, login works and
  data loads after the `CapacitorHttp` fix (see phase 1 notes).
- **Machine setup for later phases:** add to `~/.zshrc`: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
  and `export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools`; emulator:
  `$ANDROID_HOME/emulator/emulator -avd DalTime_Pixel_API36`.
- **Human gate:** done in effect (iPhone by the user, Android emulator by Claude). Optional: eyeball the two
  launcher entries "DalTime Dev" / "DalTime QA" in the emulator's app drawer.

---

### Phase 4 — iOS environments

**Goal:** dev, qa and prod iOS targets/schemes with distinct bundle IDs and display names.

**Risk note:** this edits Xcode project files, which is the most fragile AI-edited artifact in
this blueprint. Prefer the least invasive mechanism that works with Capacitor 8's Swift Package
Manager project (build configurations + `.xcconfig` overriding `PRODUCT_BUNDLE_IDENTIFIER` and
`INFOPLIST_KEY_CFBundleDisplayName`, or duplicated targets per Capacitor's guide). If edits to
`project.pbxproj` cannot be made safely, do **not** hand-hack it: write step-by-step Xcode
instructions for the human instead and mark the phase ⏸.

**Do:** create schemes `App Dev`, `App QA`, `App` mapped to bundle IDs
`com.daltime.app.dev`, `.qa`, and `com.daltime.app`; make `xcodebuild -list` show all three; make
`mobile:build:<env>` also run `cap sync ios`; document the mapping.

**AI verification:** `xcodebuild -list -project ios/App/App.xcodeproj` (or workspace) lists the
schemes; `xcodebuild -scheme "App Dev" -showBuildSettings | grep PRODUCT_BUNDLE_IDENTIFIER`
shows the right ID per scheme (if Xcode is installed; otherwise report not verified).

**Human gate:** open in Xcode 26+, run each scheme on a simulator; confirm they install side by
side. (Signing/provisioning is not needed until phase 10.)

**Completion notes:** (2026-09-20, branch `feature/capacitor`; staged, not committed)

- **Mechanism:** one target, three schemes, extra **build configurations** (no duplicated targets, so `cap sync`,
  SPM and the `CapApp-SPM` package are untouched). `project.pbxproj` gained 8 `XCBuildConfiguration` blocks
  (`Debug Dev`, `Release Dev`, `Debug QA`, `Release QA` at project *and* target level) and the two
  `XCConfigurationList`s reference them. Existing `Debug`/`Release` = prod. Copies were made programmatically from the
  existing blocks, so everything except the values below is identical to prod.
- **Per-env values (target-level build settings):** `PRODUCT_BUNDLE_IDENTIFIER` (`com.daltime.app.dev` / `.qa` /
  `com.daltime.app`) and a new `APP_DISPLAY_NAME` (`DalTime Dev` / `DalTime QA` / `DalTime`). `App/Info.plist`
  `CFBundleDisplayName` changed from the literal `DalTime` to `$(APP_DISPLAY_NAME)`.
- **Schemes** (shared, `App.xcodeproj/xcshareddata/xcschemes/`): `App Dev` → Debug Dev / Release Dev, `App QA` →
  Debug QA / Release QA, `App` → Debug / Release (run/test/analyze use Debug*, profile/archive use Release*).
  Note: the shared scheme dir did not exist before, so `App` is now an explicit shared scheme too.
- **Mapping:**

  | Env | Scheme | Bundle ID | Display name |
  | --- | --- | --- | --- |
  | dev | `App Dev` | `com.daltime.app.dev` | DalTime Dev |
  | qa | `App QA` | `com.daltime.app.qa` | DalTime QA |
  | prod (`main`) | `App` | `com.daltime.app` | DalTime |

- `mobile:build:<env>` already ran `cap sync ios` (pulled forward in phase 3); `mobile-build.mjs` now also prints which
  scheme/bundle ID to pick in Xcode. Xcode does **not** pick the scheme automatically — select it in the scheme menu
  after `mobile:ios:<env>` opens the project.
- **Pre-existing uncommitted change kept:** `DEVELOPMENT_TEAM = N6MGLJF4HC` (user's Xcode signing, from the first device
  run) was in the working tree; the new configurations carry it too so all three schemes sign for a device.
- **Verification (all real runs):** `xcodebuild -list` shows configs Debug/Release/Debug Dev/Release Dev/Debug QA/
  Release QA and schemes `App`, `App Dev`, `App QA`, `CapApp-SPM`. `-showBuildSettings` per scheme gives the right
  `PRODUCT_BUNDLE_IDENTIFIER`, `APP_DISPLAY_NAME`, `CONFIGURATION`. Simulator builds of all three **BUILD SUCCEEDED**;
  built `Info.plist`s show the right ID + display name; all three installed **side by side** on the iPhone 18 Pro
  simulator (`simctl listapps`). `npm run test:scripts` 8/8 pass. (Web build/lint/test not re-run — no `src` changes.)
- **Caveat (same as Android):** every scheme packages whatever bundle the last `cap sync` copied into
  `ios/App/App/public`. Run `npm run mobile:ios:<env>` for the environment you are about to run.
- **Not done / for later:** signing/provisioning per bundle ID (phase 10); app icon differences per env (optional polish,
  phase 6). App IDs `.dev`/`.qa` must be registered in the Apple Developer portal before a device run of those
  schemes — Xcode's automatic signing usually creates them on first run.
- **Human gate (optional):** `npm run mobile:ios:dev` → in Xcode pick `App Dev` and run on a device/simulator; repeat for
  `App QA`; confirm both icons appear next to each other on the home screen.

---

### Phase 5 — Persistent token storage

**Goal:** login survives app restarts on native, with zero behavior change on web.

**Do:**
1. Read `core/auth/auth.ts`, the auth guards, the HTTP interceptor and `impersonation.service.ts`
   and their specs. Confirm the design in 5.5 fits; record any deviation in Completion notes.
2. Web-search current secure-storage options and confirm **Capacitor 8 compatibility** of the
   chosen plugin (decision D2). Record the plugin, version and source in Completion notes. If none
   is compatible, use `@capacitor/preferences` and note that the refresh token is then
   unencrypted at rest.
3. Add `core/storage/token-storage.ts`: web → `sessionStorage` (unchanged behavior); native →
   the plugin; in-memory cache hydrated at startup via `provideAppInitializer` in `app.config.ts`,
   write-through on set/remove. Use `Capacitor.isNativePlatform()`.
4. Refactor `auth.ts` to use it (access, id, refresh keys; `TOKEN_KEYS` reused). Public auth API
   and signal behavior unchanged. Leave impersonation context in `sessionStorage`.
5. Tests: `token-storage.spec.ts` (web branch; mocked native branch; hydration; write-through),
   updated `auth.spec.ts` (persist/restore, logout clears all three keys). Add a property-based
   test only if it fits existing patterns (`fast-check` is available).
6. `npx cap sync` so the plugin is registered in both native projects.

**AI verification:** `npm test`, `npm run lint`, `npm run build` all pass; web login flow
unchanged (existing specs green; e2e smoke suite still applicable and untouched).

**Human gate:** on an emulator/simulator: log in, kill the app, relaunch → still logged in; sign
out → tokens gone; relaunch → login screen.

**Completion notes:** (2026-09-20, branch `feature/capacitor`; staged, not committed)

- **Plugin (D2 resolved): `capacitor-secure-storage-plugin@0.13.0`** (exact pin) — iOS Keychain / Android KeyStore +
  encrypted SharedPreferences. Peer dep `@capacitor/core >=8.0.0`, ships a `Package.swift` (SPM), `cap sync` lists it for
  both platforms. Its README still says "Capacitor v7 → latest", but the 0.13.0 manifest declares `>=8` and both native
  builds pass (below). Considered `@aparajita/capacitor-secure-storage@8.0.0` (also Capacitor 8 + SPM) but it declares
  `@capacitor/app`/`keyboard` as regular dependencies; `@capgo/capacitor-native-biometric` is for the optional Face ID idea
  (section 9).
- **`core/storage/token-storage.ts` (`TokenStorage`, root service):** web → `sessionStorage`, unchanged. Native (via
  `Capacitor.isNativePlatform()`) → in-memory `Map` filled by `hydrate(keys)`, `set`/`remove` update memory first then write
  through to the plugin (async, errors logged, never thrown; a failed write keeps the in-memory value for the session).
  The plugin is `import()`ed lazily so it is not in the web startup path. The plugin rejects for a missing key — treated as
  "no value".
- **`app.config.ts`:** `provideAppInitializer(() => inject(TokenStorage).hydrate(Object.values(TOKEN_KEYS)))` so the cache is
  full before `App.ngOnInit` → `AuthService.initialize()` reads it synchronously. Guards/interceptors unchanged (they read
  `AuthService` state, which is still synchronous). `TOKEN_KEYS` is now exported from `auth.ts`.
- **`auth.ts`:** all token reads/writes go through `TokenStorage`. Public API and signals unchanged. Impersonation context
  stays in `sessionStorage` (as designed).
- **Deviation (added, not in the plan): refresh on startup.** The app never used the refresh token, and the Cognito client has
  access/id tokens valid 60 min (`infra/foundation.yaml`), refresh 5 days. Persisting tokens alone would still force a login
  on any relaunch after an hour. `initialize()` now, when the access token is missing/expired but a refresh token exists,
  calls `InitiateAuth` `REFRESH_TOKEN_AUTH` (already permitted: `ALLOW_REFRESH_TOKEN_AUTH`); on success it persists the new
  access/id token (keeps the refresh token unless Cognito rotates it), on failure it clears all three keys and the user
  lands on login. This also applies on web (only when the access token is expired at load, e.g. an old tab reload) —
  previously that logged the user out. There is still **no mid-session refresh**: a token that expires while the app stays
  open gets 401s until the next launch. Candidate for a follow-up (interceptor-level refresh).
- **Bug found on the first iPhone run and fixed (2026-09-20):** Xcode showed `[error] ERROR {"code":"UNIMPLEMENTED"}` at launch. Cause: `TokenStorage.loadPlugin()` was `async` and returned the Capacitor plugin proxy; resolving a promise with it reads `plugin.then`, which the proxy forwards to native as a method named `then` → `UNIMPLEMENTED`, and the promise never settles — so `hydrate()` (run by `provideAppInitializer`) could hang app startup. Fix: the loader returns `{ plugin }` (never the bare proxy) and is exposed as the `SECURE_STORAGE_LOADER` injection token (typed, so returning the bare plugin no longer compiles). **Rule for later phases: never return/await a Capacitor plugin object directly from an async function.** Confirmed on the iOS simulator: launch log now shows three native `SecureStoragePlugin get` calls. With an empty keychain Capacitor logs `[error] {"message":"Item with given key does not exist"}` once per key — expected on a first launch or after sign-out, caught by `hydrate`.
- **Tests:** `token-storage.spec.ts` (9; native flag and plugin are injected via `IS_NATIVE_PLATFORM` / `SECURE_STORAGE_LOADER` because `vi.mock` of `@capacitor/core` proved flaky in the Angular test builder — alternating pass/fail on identical code. Covers: web passthrough, plugin never called on web, native hydrate incl. missing keys,
  cache-before-write ordering, write-through set/remove, write failure keeps memory value, no error for removing an unset
  key). `auth.spec.ts` rewritten (the shared `APP_TEST_PROVIDERS` swap `AuthService` for a mock, so the old spec tested
  nothing): restore from stored tokens, logged out when empty, refresh success (flow + params, refresh token kept),
  refresh rejected clears all keys, login persists all three, logout clears all three. `Router` is stubbed.
- **Verification (real runs):** `npm test` 40 files / 553 tests pass (was 538; 4 consecutive full runs stable); `npm run lint` clean; `npm run build` OK
  (initial 570.27 kB vs 560.61 kB — +~10 kB, same pre-existing >500 kB warning, under the 1 MB budget);
  `npm run mobile:build:dev` synced both platforms and registered the plugin; `xcodebuild` "App Dev" simulator build
  **BUILD SUCCEEDED**; `./gradlew assembleDevDebug` succeeded. Native changes: `ios/App/CapApp-SPM/Package.swift`,
  `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`.
- **Human gate passed (2026-09-20, iPhone 16, dev build, by the user):** login persists after killing the app; sign-out clears it. (Refresh after >60 min and Android still unverified on device.)
- Original gate text: actual persistence on a device — needs a real login. On an emulator/simulator/iPhone
  with the **dev** build: log in → kill the app → relaunch → still logged in (dashboard, no login screen); sign out → kill →
  relaunch → login screen. To test refresh, relaunch after >60 min (or temporarily shorten `AccessTokenValidity`).
- Notes: iOS Keychain items survive an app delete/reinstall (iOS behavior), so a reinstall can come back already logged in
  until the refresh token expires; Android's encrypted prefs can be restored by auto-backup without the Keystore key —
  `hydrate` treats undecryptable values as missing, so the result is just a login prompt.
- Xcode rewrote the project settings in `project.pbxproj` and the three `.xcscheme` files ("upgrade to recommended
  settings", e.g. `LastUpgradeCheck`, script sandboxing) while it was open — **not** staged here; decide separately whether to
  keep them.

---

### Phase 6 — Native UX polish

**Goal:** the app feels correct on notched phones and Android hardware back, without changing the
web layout.

**Do:**
1. `index.html`: `viewport-fit=cover`.
2. Tailwind-only safe-area handling (`pt-[env(safe-area-inset-top)]` and equivalents) on the
   navbar/footer and full-screen containers; verify web layout is unchanged where the insets are 0.
3. Install and configure `@capacitor/status-bar` and `@capacitor/splash-screen` (defaults
   acceptable; light/dark status bar style to match the navbar).
4. `@capacitor/app` `backButton` listener in a small core service, initialised at startup only on
   native: navigate back through router history, exit only at the root. Signals only; spec it.
5. Touch-target audit on primary actions in shared components (≥ 44 px) — Tailwind changes only.
   No raw `<button>`; keep `data-testid`.
6. App icon / splash source assets: **only if the user provides a source image**; then use
   `@capacitor/assets` to generate. Otherwise skip and note it.
7. `npx cap sync`.

**AI verification:** `npm test`, `npm run lint`, `npm run build` pass; new service has a spec;
no component CSS files or inline styles introduced.

**Human gate:** visual check on a notched iPhone simulator and an Android emulator with gesture
navigation; back button behavior at a nested route and at root.

**Completion notes:**
- **Safe areas (the "content behind the clock/battery" bug).** `viewport-fit=cover` added to `index.html`, `index.dev.html`,
  `index.qa.html`. Tailwind tokens added in `tailwind.config.js`: spacing `safe-top|bottom|left|right` (→ `env(safe-area-inset-*)`)
  and `max-h-safe-dvh`. They resolve to 0 in a normal browser, so web layout is unchanged.
  - `app.ts` host: **web** keeps its small gutter (`max(0.5rem, inset)` sides, top gap `max(0, 0.5rem - inset-top)`, `md:` 0.75rem).
    **Native** (`IS_NATIVE_PLATFORM`) is edge-to-edge — no gutter, no top gap, only `pl-safe-left pr-safe-right` for landscape notches
    (changed at the user's request after seeing white side strips on device). The navbar paints under the status bar.
  - `navbar.html`: `pt-safe-top` on the `<nav>`; the mobile dropdown offset is `top-[calc(4rem+env(safe-area-inset-top))]`.
  - `footer.html`: bottom bar `pb-[calc(1.25rem+env(safe-area-inset-bottom))]` (clears the home indicator).
  - 9 modal files (10 bottom-sheet containers): container `pt-safe-top pb-safe-bottom`, panel `max-h-dvh` → `max-h-safe-dvh`.
    (`sm:p-4` / `sm:max-h-[90vh]` still override at ≥640px.) The centered schedule shift modal already has `p-4` and was left alone.
- **Plugins** (exact pins, all peer `@capacitor/core >=8`): `@capacitor/status-bar` 8.0.3, `@capacitor/splash-screen` 8.0.2,
  `@capacitor/app` 8.1.1. `cap sync` found all 4 plugins on iOS and Android.
- **`core/native/native-shell.ts` (+ spec, 11 tests):** native-only, plugins lazy-loaded via `NATIVE_SHELL_LOADER` (returns a wrapper
  object — phase 5 lesson). Sets status bar `Style.Dark` (light text; the navbar is always dark blue, including logged-out). Registers the
  Android `backButton` listener: `Location.back()` when `canGoBack` and the current path is not a root page; otherwise `App.exitApp()`.
  Root pages: `/`, `/login`, `/web-admin`, `/org-admin`, `/manager`, `/employee`, `/employee/schedule`. Started fire-and-forget from
  `provideAppInitializer` in `app.config.ts` so it can never delay or fail bootstrap. No signals needed (no state).
- **Android edge-to-edge:** Capacitor 8's built-in `SystemBars` handles insets: with `viewport-fit=cover`, `env(safe-area-inset-*)` is
  correct on WebView ≥ 140 and is 0 (webview padded natively) on older ones — so the same Tailwind classes work on both. `@capacitor/status-bar`'s
  `overlaysWebView`/`backgroundColor` are ignored on Android 15+.
- **Touch targets (Tailwind/CSS only, no layout change on desktop):** `.btn-dt` gets `min-h-11` under `@media (pointer: coarse)` in
  `styles.css` (was 36px, `sm` 28px) — covers `<app-button>` incl. the notification bell. Navbar hamburger `p-2` → `p-2.5` (44px).
  Modal close "×" (10 files) got `-m-2.5 min-w-11 p-2.5` (44px hit area, same visual size/position). Raw `<button>` "×" is pre-existing.
- **Splash / icons:** skipped — no source image provided. Splash uses the plugin defaults (auto-hide after 500 ms).
- **Verification:** `npm run lint` clean, `npm test` 41 files / 568 tests pass, `npm run mobile:build:dev` (build + placeholders + sync
  both platforms) OK, `xcodebuild` scheme `App Dev` for iPhone 18 Pro simulator BUILD SUCCEEDED, screenshot confirms the navbar sits below
  the status bar with light text. Android native build / emulator **not run** this phase.
- **Human gate:** `npm run mobile:ios:dev` → Run on your iPhone; check the top of a logged-in screen, a bottom-sheet modal, the footer and
  a landscape orientation. Android emulator (gesture nav): back at a nested route goes back, at the dashboard exits.


---

### Phase 6b — Face ID / Touch ID app lock

Added 2026-09-20 at the user's request; runs right after phase 6 and before phase 7.

**Goal:** on native, a relaunched app that has a saved login asks for Face ID / Touch ID (Android: fingerprint/face)
before showing the app; if it fails, is cancelled, or is unavailable, the user falls back to the normal password login.
Web behavior is unchanged.

**Design (proposal — confirm details when starting):** keep tokens in the Keychain/Keystore exactly as phase 5. Add a
`core/auth/biometric-lock` service that runs *after* `TokenStorage.hydrate()` and *before* `AuthService.initialize()`
restores the session: if native + a refresh/access token exists + biometrics are available + the lock is enabled, prompt;
on success continue, on failure/cancel clear the in-memory session (do not delete the stored tokens, so a later successful
prompt still works) and show login. Plugin candidate: `@capgo/capacitor-native-biometric` (8.6.11, peer
`@capacitor/core >=8`) — re-verify Capacitor 8 support and maintenance when starting. Needs `NSFaceIDUsageDescription`
in `ios/App/App/Info.plist`. Open choices for the user: an on/off toggle in profile settings (default on?), prompt on
every cold start vs after N minutes in background, and whether "Sign out" or "Use password instead" is the fallback.
Remember: never return/await a Capacitor plugin object directly from an async function (phase 5 lesson).

**AI verification:** unit tests for the lock service (available/unavailable/failed/cancelled/success paths with an injected
plugin, like `SECURE_STORAGE_LOADER`), `npm test`, `npm run lint`, `npm run build`, iOS + Android native builds.

**Human gate:** on a real iPhone (the simulator can only fake Face ID): cold start prompts Face ID; success → dashboard;
cancel/fail → login screen; disabling Face ID in Settings → falls back gracefully.

**Completion notes:** (2026-09-20, branch `feature/capacitor-face-id` from `dev`; staged, not committed)

- **Plugin:** `@capgo/capacitor-native-biometric@8.6.11` (exact pin; peer `@capacitor/core >=8`, npm latest, modified 2026-09-19). `cap sync` registers it on iOS (SPM) and Android
  (5 plugins each).
- **Decisions taken (the blueprint left them open — change any of these on request):** lock is **on by default** with an on/off toggle; it prompts on **every cold start only**
  (not when returning from background); the fallback is **the normal password login** (Cancel / "Use password" on Android, and on iOS the device passcode is offered
  after Face ID fails because `useFallback: true`); if the device has **no biometrics and no passcode** the lock is skipped; if the plugin **errors or fails to load** it **fails closed** to the password screen.
- **`core/auth/biometric-lock.ts` (`BiometricLock`, root service) + `biometric-lock.spec.ts` (14 tests):** `unlock()` (used at startup), `refreshSupport()` / `supported` / `label`
  (Face ID, Touch ID, fingerprint unlock…), `setEnabled()` (turning **on** requires a successful prompt first, so nobody enables a lock that can't open) and `enabled`.
  Plugin loaded lazily via `BIOMETRIC_LOADER` returning `{ plugin }` (phase 5 rule; a spec asserts `then` is never touched). Web: everything is a no-op and `unlock()` is true.
- **Preference storage:** key `daltime_biometric_lock` (`'off'` when disabled, absent = on) lives in `TokenStorage` (Keychain/Keystore on native), hydrated in `app.config.ts` next to the token keys.
  It is **not** cleared on sign-out, so the choice persists across accounts on the device.
- **`AuthService.initialize()`:** if an access/refresh token is stored, it first `await`s `BiometricLock.unlock()`; on false it sets `authReady` and returns logged out — **no refresh call, stored
  tokens kept** — so a later launch (or successful prompt) can still restore the session. Logging in with a password replaces the tokens as usual. 3 new `auth.spec.ts` cases.
- **Login-page button (added after the first device try, at the user's request):** "Sign in with Face ID" (`data-testid="biometric-sign-in-btn"`, `app-button` `primary-outline`, below Sign In). Shown only when a saved
  session exists **and** the device supports biometrics **and** the lock is on — i.e. after a cancelled/failed cold-start prompt. It calls `AuthService.signInWithBiometrics()` (prompt → `restoreSession()`, which
  refreshes an expired access token and navigates to the dashboard); on failure the login page shows "Face ID didn't work…". `initialize()` was split into `restoreSession()` (shared) + the gate; `hasSavedSession()` is now public.
  After an explicit **Sign out** the tokens are cleared, so no button — you sign in with the password once, then Face ID works again on later launches. The same is true once the 5-day refresh token expires.
  Tests: 5 `signInWithBiometrics` + 3 startup-gate cases in `auth.spec.ts`, new `login/login.spec.ts` (6). **Correction:** the first version of these notes claimed the 3 startup-gate `auth.spec.ts` cases existed; that edit had silently not applied and they were only written in this follow-up.
- **Saved sign-in behind Face ID (added after the user signed out and saw no button — 2026-09-20, user approved the Keychain approach):** the session-restore button can't survive **Sign out** (tokens are cleared), so like
  other apps the email + password can now be stored with `NativeBiometric.setCredentials({ accessControl: BIOMETRY_ANY })` (iOS Keychain access control / Android biometric-bound Keystore key; readable only via
  `getSecureCredentials` after a biometric). `BiometricLock` gained `saveCredentials` / `getCredentials` / `clearCredentials` / `hasCredentials`; a `daltime_biometric_login = 'saved'` marker in `TokenStorage`
  (hydrated in `app.config.ts`) lets the login page know synchronously. Login page: a **"Use Face ID to sign in next time" checkbox (checked by default — say if you want it unchecked)** appears on native when
  biometrics work, the lock is on, and nothing is saved; a successful password login then saves it. The **"Sign in with Face ID" button** shows when a login is saved *or* a session is still stored; with a saved login it
  prompts, then calls `AuthService.login()` (fresh tokens; survives Sign out and refresh-token expiry). A stale saved password (`INCORRECT_CREDENTIALS_ERROR`) or a new-password challenge deletes the saved login and
  says so. Profile → the Face ID card shows a **Forget** button (`biometric-forget-btn`) while a login is saved. Sign out does **not** delete the saved login (that is the point); Forget or a stale password does.
  Security note: the password is stored only in hardware-backed, biometric-gated storage; if Face ID enrollment is fully removed on iOS the item becomes unreadable (`BIOMETRY_ANY` survives *adding* faces) and the next
  password login re-saves it. Tests: `biometric-lock.spec.ts` 21, `login.spec.ts` 17 tests across visibility / checkbox / tap / stale-password paths. Verification: lint clean, `ng test --no-watch` 51 files / 670 tests pass,
  `mobile:build:dev` OK, iOS `App Dev` simulator build succeeded and the **built app's Info.plist contains `NSFaceIDUsageDescription`** (closes the earlier "not verified" item), `assembleDevDebug` succeeded. Still needs the real-iPhone check.
- **UI:** the shared `ProfilePageComponent` (used by all four roles) shows an "Unlock with Face ID" checkbox card **only when `supported()`** (native + capable device). Tailwind only, `data-testid` `biometric-lock-toggle` / `biometric-lock-section`.
  No new shared component, no raw buttons.
- **Native config:** `NSFaceIDUsageDescription` added to `ios/App/App/Info.plist`; `USE_BIOMETRIC` added to `AndroidManifest.xml` (confirmed in the built APK with `aapt2`). Package/Gradle plugin wiring
  regenerated by `cap sync` (`Package.swift`, `capacitor.settings.gradle`, `capacitor.build.gradle`).
- **Verification (real runs):** `npm run lint` clean; `npx ng test --no-watch` 51 files / 670 tests pass (after the login-button and saved-sign-in follow-ups); `npm run mobile:build:dev` OK; `xcodebuild` "App Dev" iOS-simulator build **BUILD SUCCEEDED**;
  `./gradlew assembleDevDebug` **BUILD SUCCESSFUL**; web `ng build` OK (initial 592.89 kB — same pre-existing >500 kB warning, under the 1 MB error budget; the plugin is a lazy chunk).
  **Not verified:** the `NSFaceIDUsageDescription` inside the built `.app` (only the source plist was checked with `plutil`), any actual biometric prompt, and Android on an emulator/device.
- **Known limits / follow-ups:** not re-locked when the app returns from background; turning the lock *off* does not require a biometric; on Android, `negativeButtonText` is the only "use password" path (the device
  PIN cannot be combined with the cancel button — plugin constraint). Note `npm test` (`ng test`) runs in watch mode here; use `npx ng test --no-watch` for a one-shot run.
- **Human gate (real iPhone, dev build):** `npm run mobile:ios:dev` → ⌘R with the `App Dev` scheme. (1) Log in, kill the app, relaunch → Face ID prompt → success lands on the dashboard.
  (2) Relaunch and cancel / fail Face ID → password login screen; relaunch again and succeed → still restored. (3) Profile → untick "Unlock with Face ID", relaunch → no prompt, still logged in;
  re-tick → Face ID prompt required. (4) Settings → DalTime Dev → Face ID off → relaunch behaves gracefully (passcode prompt or, if the device has no passcode, no prompt).

---

### Phase 7 — Docs + verification checkpoint

**Goal:** the mobile shell is documented and proven end-to-end in dev before any release
automation is built.

**Do:**
1. README section (or `docs/mobile.md` linked from README): prerequisites (Xcode 26+, Android
   Studio Otter+, JDK 21, Node 22+), one-time setup, the per-env build commands, how to run a
   flavor/scheme, where env values come from, why local SAM isn't reachable from a device,
   troubleshooting (CORS 403 → CORS var missing; logged out on every launch → token storage).
2. Regression checklist: web app via `tasks.json` "Start Full Stack (with install)" still works;
   `npm run build`, `npm test`, `npm run lint`, e2e smoke suite unchanged.
3. Update section 8 (Feature completeness) with the actual results per context.

**Human gate (the checkpoint):** on a real device or emulator using the **dev** build: log in,
load a data screen (no CORS errors), kill and relaunch (still logged in), sign out. Repeat for
**qa** and **prod** builds once those environments' CORS variable has been deployed. Do not
start phase 8 until dev passes.

**Completion notes:** _(Claude fills in)_

---

### Phase 8 — CI: Android signed build workflow

**Goal:** a GitHub Actions workflow builds a signed Android AAB/APK for a chosen environment and
uploads it as a workflow artifact. No store upload yet.

**Do:**
1. Read `.github/workflows/cd.yml` (foundation outputs, stack outputs, environment usage, action
   SHA pinning, AWS OIDC role setup) and mirror its conventions.
2. New `.github/workflows/mobile-android.yml`: `workflow_dispatch` with `environment` input
   (`dev|qa|main`), `environment:` set so env-scoped vars/secrets apply, JDK 21, Node 24,
   `npm ci`, `npm run build`, fetch the same stack outputs as `cd.yml` (same AWS role/OIDC),
   run `mobile-env.mjs`, `cap sync android`, decode keystore from secret, Gradle `bundle<Env>Release`
   with `versionCode = github.run_number`, upload AAB (and optionally APK for sideload testing).
   Pin all actions to commit SHAs. Never echo secrets.
3. Actionlint the workflow if available. Document required secrets/vars and how to create the
   keystore (`keytool` command) in the README/docs; do **not** generate or commit a keystore.

**AI verification:** `actionlint` (or `yamllint` + careful review) clean; every secret referenced
is documented; no secret values printed in logs; workflow does not trigger on push.

**Human gate:** create the upload keystore, add the secrets to each GitHub environment, run the
workflow for `dev`, download the artifact, install the APK/AAB-derived build on a device.

**Completion notes:** _(Claude fills in)_

---

### Phase 9 — CI: Android release to Google Play

**Blocked until:** a Google Play developer account, the app created in Play Console, and a Play
service account JSON with release permission (⏸ — see D4).

**Do:** extend `mobile-android.yml` (or add a reusable job) to upload the AAB with a pinned,
well-maintained action or fastlane `supply`: `dev` and `qa` → internal testing track; `main` →
production track only behind the `main` environment's required-reviewer approval (configure by
human). Add a `dry-run` input that builds and validates without uploading. Document the manual
first upload requirement (Play requires the first release via the console) if applicable —
verify current Play requirements by web search before writing.

**AI verification:** actionlint clean; dry-run path works without secrets; no upload happens on
`dev`/`qa` unless the input opts in.

**Human gate:** first Play Console setup, then a `dev` release to the internal track, install
from the Play link.

**Completion notes:** _(Claude fills in)_

---

### Phase 10 — CI: iOS build + TestFlight

**Blocked until:** Apple Developer Program membership, App IDs and App Store Connect app records
for the three bundle IDs, an App Store Connect API key, and a signing strategy (⏸ — see D4).

**Do:**
1. Verify the current GitHub-hosted `macos-*` image has **Xcode 26+**; if not, document the
   constraint and stop rather than guessing.
2. Add `fastlane/Fastfile` + `Gemfile` under `frontend/ios/` (or repo-root `fastlane/` if that
   fits better), with lanes `beta_dev`, `beta_qa`, `release_main` using `match` (or a documented
   alternative), `build_app` on the environment's scheme, `upload_to_testflight`.
   Build number = `github.run_number`.
3. New `.github/workflows/mobile-ios.yml`: `workflow_dispatch` with `environment` input,
   `macos` runner, same frontend build + placeholder steps as Android, `cap sync ios`, run the
   lane. Pin actions to SHAs; cache Ruby gems and SPM appropriately; secrets per 5.8.
4. Document the signing setup (match repo, API key creation) and required secrets.

**AI verification:** actionlint clean; `bundle exec fastlane lanes` lists the lanes locally if
Ruby/fastlane are installed; no secret printed; workflow is manual-trigger only.

**Human gate:** create signing assets and App Store Connect records, add secrets, run for `dev`,
install the build from TestFlight.

**Completion notes:** _(Claude fills in)_

---

### Phase 11 — OTA live updates (optional)

**Only do this after phase 7 passes and at least one store release is out.** Skip entirely if web
fixes can wait for a store release.

**Do:**
1. Decide the vendor (D7): re-research Capgo vs Capawesome Cloud (current pricing, Capacitor 8
   support, self-hosting, rollback support, GitHub Actions integration). Present the choice to
   the user with a recommendation and **wait for approval** before installing anything.
2. Install the chosen plugin; call the "app ready" notification at startup so bad bundles roll
   back automatically; one channel per environment (`dev`, `qa`, `main`); bind channels to
   compatible native versions (5.9).
3. Add an "upload web bundle" step/workflow (manual `workflow_dispatch` per environment) after
   the build + placeholder replacement, using the vendor's CLI and a GitHub environment secret.
4. Document the policy: what may ship OTA (web-only fixes) vs what needs a store release
   (plugins, permissions, native config, big features), per Apple 3.3.2 / Google policy.
5. `npx cap sync` and native-project changes only if the plugin requires them.

**AI verification:** build, lint and tests pass; actionlint clean; rollback path documented;
plugin's Capacitor 8 support cited.

**Human gate:** create the vendor account and API key/secret, publish a test bundle to `dev`,
confirm an installed dev app updates and can roll back.

**Completion notes:** _(Claude fills in)_

---

## 7. Tests (summary)

- Unit: `token-storage.spec.ts`, updated `auth.spec.ts`, back-button service spec,
  `mobile-env.mjs` tests.
- Existing web unit tests and the e2e smoke suite must pass unchanged in every phase.
- Manual device acceptance is the phase 7 human gate.

---

## 8. Feature completeness (per CLAUDE.md)

| Context | Requirement | Result |
| --- | --- | --- |
| Locally | Web app via `tasks.json` unchanged (regression). Mobile emulator/simulator runs against the dev API | _(phase 7)_ |
| GitHub Actions → dev | Existing web deploy still passes; CORS change deployed; mobile dev build logs in and loads data | _(phase 7)_ |
| qa | Same after promotion, with the `com.daltime.app.qa` build | _(phase 7)_ |
| prod | Same after promotion; `ALLOWED_ORIGINS` for `main` includes `https://localhost` | _(phase 7)_ |

---

## 9. Open questions / deviations log

_(Claude appends here at the end of each phase: new questions, decisions made, deviations from the
plan, and why.)_

- Phase 1: implemented on new branch `feature/capacitor` (was on `dev`). CLAUDE.md's `ai/*` docs still don't exist (as noted in section 0).
- Phase 1: README deploy command also updated (not in original plan).
- Phase 1 (reopened): the 'one origin for both platforms' assumption was wrong — iOS WKWebView forces `capacitor://localhost`, which API Gateway HTTP APIs refuse in CORS config. Fixed with `CapacitorHttp` on native instead (unverified on device until the human gate). Open question: since `CapacitorHttp` also applies on Android, `https://localhost` in `AllowedOrigins` may be unnecessary — leave as is until Android is tested.
- Phase 3: Android flavor for prod is `prod` (AGP forbids `main`); phase 8's `bundle<Env>Release` becomes `bundleProdRelease`. Android build now verified (JDK **21**, not 17).
- Phase 3: blueprint said JDK 17+; Capacitor 8's Android code needs **JDK 21** (17 fails to compile). Fixed in section 2 and later phases.
- Phase 3: `mobile:build:*` syncs iOS too (pulled forward from phase 4's sync item).
- Phase 2: lint-staged is not configured anywhere in the repo (CLAUDE.md assumes it). Decide whether to add it or update CLAUDE.md; does not block the mobile work.
- Phase 2: `cap run ios` cannot open the simulator on Xcode 27 (Simulator.app path); use `xcrun simctl` or Xcode. Revisit if a newer Capacitor fixes it.
- Phase 2: the built app has placeholder API/Cognito values until phase 3, so a simulator run cannot log in yet.
- Phase 4: implemented with extra build configurations + shared schemes (not duplicated targets); `Info.plist` display name now comes from `APP_DISPLAY_NAME`. Physical-device runs of `.dev`/`.qa` need those App IDs registered (Xcode automatic signing normally does this).
- Phase 5: D2 resolved → `capacitor-secure-storage-plugin@0.13.0` (see phase 5 notes for why not the alternatives).
- Phase 5: added refresh-token exchange at startup (not in the original plan) so persisted login survives past the 60-minute access token. Mid-session refresh is still missing — open question whether to add an interceptor-level refresh.
- Decision 2026-09-20: **Face ID / Touch ID is now in scope as phase 6b** (after phase 6). Original note: **Face ID / Touch ID.** Feasible on top of phase 5 as an app lock: keep tokens in Keychain, prompt biometrics on cold start (before/around `initialize()`), fall back to the password screen. Would use `@capgo/capacitor-native-biometric` (8.6.11, peer `@capacitor/core >=8`) + `NSFaceIDUsageDescription` in `Info.plist`; needs a real device to verify. Decide whether to add as a phase between 6 and 7.
- Phase 6b: Face ID lock implemented on `feature/capacitor-face-id` with the defaults listed in its completion notes (on by default, cold-start only, password fallback). Open question: re-lock after N minutes in background, and whether disabling the lock should require a biometric.
