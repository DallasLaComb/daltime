# PostHog — UX analytics guide

Session replay, heatmaps, click/pageview analytics and feature flags for the DalTime frontend. This is a
separate, optional tool from the backend structured logging system (`docs/logging.md`) — PostHog never touches
CloudWatch, and CloudWatch never touches PostHog. If a request fails, you'll still find it in CloudWatch Logs
Insights exactly as before; if you want to *watch* the user's screen leading up to the failure, that's PostHog.

Background and the build-vs-buy decision are recorded in `docs/0-logging.blueprint.md`, decision D13 and Phase 8b.

---

## 1. What it's for

| Question | Tool |
| --- | --- |
| "Did request X fail, and why?" | CloudWatch Logs Insights (`docs/logging.md`) |
| "What did the user actually see/click before it broke?" | PostHog session replay |
| "Where in the app do people get stuck or rage-click?" | PostHog heatmaps + autocapture |
| "What fraction of managers use feature X?" | PostHog product analytics (events, funnels) |
| "Roll out a new UI to 10% of orgs first" | PostHog feature flags |

## 2. Sign-up (one-time, human step)

1. Go to [posthog.com](https://posthog.com) → sign up for a free account (no credit card required).
2. Create a project. Pick a **region** when asked — **US cloud** (`app.posthog.com`) is the default this repo
   assumes (matches AWS `us-east-1`). If you need EU data residency, pick EU cloud instead and use
   `https://eu.i.posthog.com` as `POSTHOG_HOST` everywhere below.
3. In the project's **Settings → Project API Key**, copy the key (starts with `phc_`). This is **not a secret**
   — it's designed to ship inside the public web bundle, the same way the Cognito App Client ID already does.
   Don't worry about it appearing in the built JS.
4. Free tier limits (2026 pricing): 1,000,000 events/month, 5,000 session replay recordings/month, 1,500 survey
   responses/month, feature flags included. At DalTime's current scale this is very unlikely to be exceeded — if
   it ever is, PostHog degrades to usage-based billing rather than cutting you off; there's no surprise outage.

## 3. Turning it on

The integration is fully wired but **off by default everywhere** (`environment.posthog.enabled` / the
`POSTHOG_KEY` GitHub variable are unset). Nothing sends data until you opt in.

### Local development

**Do not commit a real key.** `environment.local.ts`/`environment.dev.ts`/`environment.qa.ts` are tracked files —
anything you save there becomes part of git history the moment you commit, even though PostHog project keys
aren't secret in the security sense (see below), it's still not something to check in casually, and getting it
back out of history after the fact is real cleanup work. Edit the file locally, test, then either revert it
(`git checkout -- frontend/src/environments/environment.local.ts`) or just leave it unstaged and never `git add`
it — don't include it in a commit.

```ts
posthog: {
  apiKey: 'phc_your_real_key_here',
  apiHost: 'https://us.i.posthog.com',
  enabled: true,
},
```

Run the app (`npm start` or `npm run start:dev`), click around, log in. Within a few seconds a session should
appear in the PostHog dashboard under **Session replay**.

(Why it's not a *secret* secret: a PostHog project key is write-only — it can send events to your project but
can't read data or do anything else, which is why it's designed to ship inside the public web bundle for real
deploys, the same trust model as the Cognito App Client ID already committed in these files. That's a reason not
to panic if it does end up in history, not a reason to commit it on purpose.)

### Dev / QA / Prod (real deploys)

These go through `.github/workflows/cd.yml`'s placeholder substitution, driven by GitHub repository/environment
variables (**Settings → Environments → `dev`/`qa`/`main` → Variables**, or **Settings → Secrets and variables →
Actions → Variables** for repo-wide):

| Variable | Value | Required? |
| --- | --- | --- |
| `POSTHOG_KEY` | your project's API key (`phc_...`) | No — unset means PostHog stays disabled for that environment, deploy still succeeds |
| `POSTHOG_HOST` | `https://us.i.posthog.com` (or your EU host) | No — defaults to US cloud if unset |

```bash
gh variable set POSTHOG_KEY --env dev --body "phc_your_real_key_here"
gh variable set POSTHOG_HOST --env dev --body "https://us.i.posthog.com"
# repeat for qa, main
```

One PostHog project is shared across dev/qa/prod in this setup (simpler than three separate projects) — use the
PostHog dashboard's environment/property filters to separate them if needed; `context.authenticated`/`role`/
`org_id` are already sent per event and can be extended with an explicit `environment` property later if you
want harder separation.

### Mobile (Capacitor)

`frontend/.env.mobile.<env>` (git-ignored, see `.env.mobile.example`) needs the same two optional lines:

```
POSTHOG_KEY=phc_your_real_key_here
POSTHOG_HOST=https://us.i.posthog.com
```

Leave them blank/absent to keep PostHog disabled in mobile builds — `npm run mobile:build:*` will not fail over
a missing PostHog key (unlike the five required Cognito/API values).

## 4. Privacy — what's captured and what's masked

DalTime has an existing strict no-PII policy for the backend logger (`docs/logging.md` D9: opaque `sub`/`role`/
`org_id` only, never email or name). The PostHog integration follows the same principle, adapted for a tool whose
whole point is *watching the screen*:

- **Identity**: `posthog.identify()` is called with the Cognito `sub` only. Never an email or name. Set once
  after login (`AuthService.identifyAnalytics()`), reset on logout.
- **Session replay text**: masked entirely (`maskTextSelector: '*'`). Scheduling data — employee names, phone
  numbers, shift times — renders as plain page text throughout this app, not just in form inputs, so masking
  only inputs (posthog-js's own default) would still leak it into every replay. The tradeoff: replays show
  layout, navigation flow, click positions, scroll behavior and rage-clicks, but not readable text. That's
  usually enough to diagnose a UI bug (where did they get stuck, what did they click) without reading real data.
- **Session replay inputs**: masked (`maskAllInputs: true`, also the posthog-js default — kept explicit here).
- **Autocapture click events**: `mask_all_text: true` strips the clicked element's text (`$el_text`) from
  analytics events. Element **attributes** are still captured (the default) — this app already puts a stable,
  non-PII `data-testid` on every interactive element (CLAUDE.md), so autocapture's click events are still
  meaningful (`button:shift-save-btn`, not the button's visible label) without any extra instrumentation.
- **Pre-login**: `person_profiles: 'identified_only'` — no profile is created for anyone who never logs in, so
  the login screen itself isn't tracked as an anonymous visitor.

### Loosening it later

If the team decides some specific text is safe to see in replays (e.g. static nav labels, page headings that
never contain user data), unmask it explicitly rather than turning off masking globally:

```html
<h1 data-testid="page-title" data-ph-unmask>Schedule</h1>
```

Never do this for anything that could ever render a real name, phone number, email or shift note. When in doubt,
leave it masked — this mirrors the "mask-first, unmask explicitly" rule already used for backend log fields.

## 5. Using it day to day

- **Session replay** (left nav → *Session replay*): filter by `role` or `org_id` (properties on every identified
  session) to find a specific user's session. Click a recording to watch it — you'll see cursor movement, clicks,
  scrolling and page transitions, with all text/input content blurred per the masking config above.
- **Heatmaps**: derived automatically from replay data — no separate setup.
- **Autocapture events**: every click on a `data-testid`-tagged element and every route change is already
  captured with no extra code. Browse them under *Events* (event name `$autocapture`, filter by `$el_text`... no
  wait, that's masked — filter by the element's `data-testid` via the `$elements` property instead, or by
  `$pathname` for navigation).
- **Funnels / retention**: build these in the PostHog UI from the autocaptured events — e.g. "logged in → viewed
  schedule → created a shift" to see where managers drop off, no code changes needed.
- **Feature flags**: create one in PostHog's UI, then gate a component with
  `posthogService.capture(...)`-adjacent flag checks (not yet wired into a helper method in this repo — add one
  to `PosthogService` if/when the team actually uses a flag: `posthog.isFeatureEnabled('flag-key')` inside the
  same zone-aware wrapper pattern already used for `identify`/`capture`).
- **Cost/limits**: PostHog's own **Usage** page in the dashboard shows events/replays consumed against the free
  tier in real time — check it occasionally, no CloudWatch involvement.

## 6. What this does *not* replace

- **CloudWatch structured logs** (`docs/logging.md`) — still the source of truth for request traces, 4xx/5xx,
  business events, and the audit trail. PostHog has no idea what a Lambda did.
- **`LoggerService`/`AppErrorHandler`** (the Phase 7 client error pipeline) — unchanged. A thrown frontend error
  still lands in CloudWatch via `POST /shared/client-logs` exactly as before; PostHog additionally sees it as a
  session it can replay, but doesn't receive the structured error payload itself unless you explicitly call
  `posthogService.capture('error', {...})` somewhere (not currently done — CloudWatch already has this).
