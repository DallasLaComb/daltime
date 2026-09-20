# Capacitor Mobile Shell (Frontend) — Blueprint

Status: **Approved for phased implementation — Phase 1 code done and GitHub vars set; dev deploy + curl preflight pending, then Phase 2.**

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

In scope: the shell, per-environment builds (dev/qa/prod), persistent token storage, native UX
polish, GitHub Actions pipelines that build and release the apps, and (optional, last) OTA live
updates for web-only fixes.

Out of scope: push notifications, biometric login, offline mode, store listing content
(screenshots, descriptions, review submission).

---

## 2. Version decisions

| Item | Choice | Why |
| --- | --- | --- |
| Capacitor | **8.x** (`@capacitor/core`, `cli`, `android`, `ios`, all on the same version) | Current active major (released 2025-12-08). v7 is Extended Support; older is End of Support. Capacitor does not use the term "LTS" — v8 is the supported line. Latest patch when this was written per npm: 8.5.2. |
| Angular compatibility | No constraint | Capacitor is framework-agnostic; it only consumes the built `index.html` + assets. |
| Node | 22+ required; repo uses **24** locally and in CI | No change |
| iOS | Xcode 26.0+, deployment target 15.0, Swift Package Manager (Capacitor 8 default) | Capacitor 8 requirement |
| Android | Android Studio 2025.2.1 (Otter)+, JDK 17+, Gradle 8.13, minSdk 24, compile/targetSdk 36 | Capacitor 8 requirement |

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
- `server.androidScheme: 'https'`, `server.iosScheme: 'https'` — both platforms serve from
  `https://localhost`, giving ONE origin to whitelist instead of `capacitor://localhost` +
  `http://localhost`
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
(`infra/template.yaml`). It must include `https://localhost`. Because CD passes
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
- **Android** (ubuntu): JDK 17, Node 24, `npm ci`, `npm run build`, placeholder replacement,
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
| 1 | CORS origin for the mobile WebView (infra + local + env vars) | Yes — set 3 GitHub env vars, deploy | ⏸ (code + vars done; deploy dev + preflight pending) |
| 2 | Capacitor scaffold (install, config, add platforms, hygiene) | Maybe — needs Xcode/CocoaPods/SPM for `cap add ios` | ⬜ |
| 3 | Environment support: Android flavors, config switching, build scripts | No | ⬜ |
| 4 | iOS environment targets/schemes | Yes — verify in Xcode | ⬜ |
| 5 | Persistent token storage (auth refactor) | No (tests are automated) | ⬜ |
| 6 | Native UX polish (safe areas, status bar, back button, splash) | Yes — visual check | ⬜ |
| 7 | Docs + verification checkpoint (regression + device acceptance) | Yes — device testing | ⬜ |
| 8 | CI: Android signed build workflow (artifact only) | Yes — keystore secrets | ⬜ |
| 9 | CI: Android release to Google Play | Yes — Play account + service account | ⬜ |
| 10 | CI: iOS build + TestFlight | Yes — Apple account + secrets | ⬜ |
| 11 | OTA live updates (optional) | Yes — vendor account | ⬜ |

Phases 1–7 need no paid accounts. Phases 8–11 can be deferred without blocking anything else.

---

### Phase 1 — CORS origin for the mobile WebView

**Goal:** the deployed API accepts requests from the Capacitor WebView origin
`https://localhost` in every environment, and local dev deploys keep working.

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
- **Human gate (still pending):** deploy dev, run the curl preflight, and record the result here.

```bash
# already run:
gh variable set ALLOWED_ORIGINS --env dev  --repo DallasLaComb/daltime --body 'http://localhost:4200,https://dev.daltime.com,https://localhost'
gh variable set ALLOWED_ORIGINS --env qa   --repo DallasLaComb/daltime --body 'https://qa.daltime.com,https://localhost'
gh variable set ALLOWED_ORIGINS --env main --repo DallasLaComb/daltime --body 'https://daltime.com,https://localhost'
```

- Preflight check: `curl -i -X OPTIONS <dev-api>/<any-route> -H 'Origin: https://localhost' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization'`
  → expect `access-control-allow-origin: https://localhost`. Result: _(human fills in)_
- Note for later phases: the Lambda `setRequestOrigin` falls back to the FIRST allowed origin when the
  request origin isn't listed, so a missing `https://localhost` shows up as a CORS mismatch, not a 403.


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

**Completion notes:** _(Claude fills in)_

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

**Completion notes:** _(Claude fills in)_

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

**Completion notes:** _(Claude fills in)_

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

**Completion notes:** _(Claude fills in)_

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

**Completion notes:** _(Claude fills in)_

---

### Phase 7 — Docs + verification checkpoint

**Goal:** the mobile shell is documented and proven end-to-end in dev before any release
automation is built.

**Do:**
1. README section (or `docs/mobile.md` linked from README): prerequisites (Xcode 26+, Android
   Studio Otter+, JDK 17+, Node 22+), one-time setup, the per-env build commands, how to run a
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
   (`dev|qa|main`), `environment:` set so env-scoped vars/secrets apply, JDK 17, Node 24,
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
