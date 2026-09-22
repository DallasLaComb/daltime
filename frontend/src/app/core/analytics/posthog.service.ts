import { Injectable, NgZone, inject } from '@angular/core';
import posthogJs from 'posthog-js';
import { environment } from '../../../environments/environment';

/**
 * Thin wrapper around `posthog-js` for UX analytics (session replay, heatmaps, click/pageview
 * autocapture, feature flags) — a separate concern from `LoggerService`, which stays the source of
 * truth for operational error logs in CloudWatch. See docs/posthog-guide.md.
 *
 * Privacy, matching this repo's no-PII-in-logs policy (docs/logging.md D9):
 * - `identify()` is called with the caller's opaque Cognito `sub` only — never email or name.
 * - Session replay masks all inputs and all text by default (`maskAllInputs`, `maskTextSelector: '*'`)
 *   because scheduling data (employee names, phone numbers) appears as plain page text, not just in
 *   form inputs — the posthog-js default (`maskAllInputs` only) would leave it visible in replays.
 * - `mask_all_text` strips element text (`$el_text`) from autocapture click events. Element
 *   *attributes* stay uncaptured-by-default off (`mask_all_element_attributes: false` is the
 *   posthog-js default) so autocapture can still use this repo's existing `data-testid` values —
 *   already required on every interactive element and already designed to be non-PII identifiers.
 * - `person_profiles: 'identified_only'` — no profile is created until `identify()` runs after login,
 *   so the pre-login screen never gets tracked as an anonymous user.
 */
@Injectable({ providedIn: 'root' })
export class PosthogService {
  private readonly ngZone = inject(NgZone);
  // An unsubstituted CD placeholder (e.g. "__VITE_POSTHOG_KEY__", present verbatim in unit tests,
  // which use the base environment.ts unresolved) must count as "not configured", not a real key.
  private readonly enabled =
    environment.posthog.enabled &&
    environment.posthog.apiKey.length > 0 &&
    !environment.posthog.apiKey.startsWith('__');

  // Held as an instance property (like AuthService.cognitoClient), not read from the module import
  // at call sites, so specs can substitute a stub directly instead of `vi.mock`-ing 'posthog-js' —
  // this project's test runner does not isolate module mocks reliably across the full suite.
  private readonly client: typeof posthogJs = posthogJs;

  /** Call once at app startup (see app.config.ts). No-ops when disabled or unconfigured. */
  init(): void {
    if (!this.enabled) return;

    // Outside the Angular zone: session recording's DOM observation otherwise triggers Angular
    // change detection on every mutation it records, which the docs call out as a real perf risk.
    this.ngZone.runOutsideAngular(() => {
      this.client.init(environment.posthog.apiKey, {
        api_host: environment.posthog.apiHost,
        person_profiles: 'identified_only',
        capture_pageview: 'history_change',
        mask_all_text: true,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: '*',
        },
      });
    });
  }

  /** Links subsequent events to this user. Pass the Cognito `sub` — never an email or name. */
  identify(distinctId: string, properties?: Record<string, string | boolean>): void {
    if (!this.enabled) return;
    this.client.identify(distinctId, properties);
  }

  /** Call on logout so the next login (possibly a different user, e.g. after impersonation) starts clean. */
  reset(): void {
    if (!this.enabled) return;
    this.client.reset();
  }

  /** Escape hatch for a custom event beyond what autocapture already covers. */
  capture(eventName: string, properties?: Record<string, unknown>): void {
    if (!this.enabled) return;
    this.client.capture(eventName, properties);
  }
}
