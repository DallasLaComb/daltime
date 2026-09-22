import { DestroyRef, Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth';
import { ImpersonationService } from '../services/impersonation.service';
import {
  detectBrowser,
  detectDeviceType,
  detectOs,
  detectPlatform,
  getBreakpoint,
  getOrientation,
  getViewport,
} from './client-context';
import type { ClientLogBatch, ClientLogContext, ClientLogEntry } from '../models/client-log.model';

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT_ENTRY_COUNT = 10;
const MAX_QUEUE_SIZE = 50;
const MAX_ENTRIES_PER_BATCH = 25;
const MAX_LOG_RATE_PER_MIN = 30;
const MESSAGE_MAX_LENGTH = 500;
const STACK_MAX_LENGTH = 2000;
const USER_AGENT_MAX_LENGTH = 200;
const RESIZE_DEBOUNCE_MS = 250;

/** Entry types exempt from the log/error rate limit: one-off system events, not user-triggered spam. */
const UNTHROTTLED_TYPES: ReadonlySet<ClientLogEntry['type']> = new Set(['session_start', 'viewport_change']);

type NewEntry = Pick<ClientLogEntry, 'type' | 'level' | 'message' | 'stack' | 'http' | 'session'>;

/**
 * Batches structured log entries to `POST /shared/client-logs` so they land in CloudWatch via the
 * same backend logger. Buffers in memory and never sends while unauthenticated (D5 in the logging
 * blueprint) — a pre-login error is dropped if the user never signs in. Uses `fetch(..., {
 * keepalive: true })` rather than `HttpClient` so a flush on page-hide/app-pause survives
 * navigation/teardown, and because `navigator.sendBeacon` cannot carry an Authorization header.
 *
 * Every entry also carries `viewport`/`breakpoint`/`orientation` (Phase 8a), a `session_start`
 * entry is queued once at construction, and a `viewport_change` entry is queued whenever the
 * breakpoint or orientation actually changes (debounced resize/orientationchange — not every pixel).
 */
@Injectable({ providedIn: 'root' })
export class LoggerService {
  private readonly auth = inject(AuthService);
  private readonly impersonation = inject(ImpersonationService);

  private readonly sessionId = crypto.randomUUID();
  private queue: ClientLogEntry[] = [];
  private seq = 0;
  private lastErrorKey: string | null = null;
  private rateWindowStart = Date.now();
  private rateCount = 0;
  private lastBreakpoint: ClientLogEntry['breakpoint'] | null = null;
  private lastOrientation: ClientLogEntry['orientation'] | null = null;

  constructor() {
    if (typeof document === 'undefined') return;

    const timer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') this.flush();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onViewportEvent = (): void => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.checkViewportChange(), RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', onViewportEvent);
    window.addEventListener('orientationchange', onViewportEvent);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('resize', onViewportEvent);
      window.removeEventListener('orientationchange', onViewportEvent);
    });

    this.recordViewportBaseline();
    this.sendSessionStart();
    void this.registerNativeFlush();
  }

  debug(message: string): void {
    this.enqueue({ type: 'log', level: 'debug', message });
  }

  info(message: string): void {
    this.enqueue({ type: 'log', level: 'info', message });
  }

  warn(message: string): void {
    this.enqueue({ type: 'log', level: 'warn', message });
  }

  /** `err` is never logged raw — only its message/stack, never a full object, token or body. */
  error(message: string, err?: unknown): void {
    const stack = err instanceof Error ? err.stack : undefined;
    const detail = err instanceof Error ? err.message : err !== undefined ? String(err) : undefined;
    this.enqueue({
      type: 'error',
      level: 'error',
      message: detail ? `${message}: ${detail}` : message,
      stack,
    });
  }

  /** Used by the logging interceptor to record a failed API call without the response body. */
  logHttpFailure(method: string, path: string, status: number, correlationId: string): void {
    this.enqueue({
      type: 'error',
      level: status >= 500 ? 'error' : 'warn',
      message: `${method} ${path} failed with ${status} (correlation_id: ${correlationId})`,
      http: { method, path, status },
    });
  }

  private enqueue(entry: NewEntry): void {
    if (!UNTHROTTLED_TYPES.has(entry.type) && !this.withinRateLimit()) return;

    const message = entry.message?.slice(0, MESSAGE_MAX_LENGTH);
    const stack = entry.stack?.slice(0, STACK_MAX_LENGTH);

    if (entry.type === 'error') {
      const key = `${message ?? ''}|${stack ?? ''}`;
      if (key === this.lastErrorKey) return;
      this.lastErrorKey = key;
    }

    const viewport = getViewport();
    this.queue.push({
      ...entry,
      message,
      stack,
      route: typeof location === 'undefined' ? undefined : location.pathname,
      viewport,
      breakpoint: getBreakpoint(viewport.w),
      orientation: getOrientation(viewport.w, viewport.h),
      ts: new Date().toISOString(),
      seq: this.seq++,
    });

    if (this.queue.length > MAX_QUEUE_SIZE) this.queue.shift();
    if (this.queue.length >= FLUSH_AT_ENTRY_COUNT) this.flush();
  }

  private withinRateLimit(): boolean {
    const now = Date.now();
    if (now - this.rateWindowStart > 60_000) {
      this.rateWindowStart = now;
      this.rateCount = 0;
    }
    if (this.rateCount >= MAX_LOG_RATE_PER_MIN) return false;
    this.rateCount++;
    return true;
  }

  private flush(): void {
    if (this.queue.length === 0) return;
    // Buffered until a token exists; dropped (never persisted elsewhere) if the user never logs in.
    if (!this.auth.isAuthenticatedSignal()) return;
    const token = this.auth.getAccessToken();
    if (!token) return;

    const entries = this.queue.splice(0, MAX_ENTRIES_PER_BATCH);
    const batch: ClientLogBatch = { context: this.buildContext(), entries };

    void fetch(`${environment.api.baseUrl}/shared/client-logs`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Correlation-Id': crypto.randomUUID(),
        'X-Platform': detectPlatform(),
      },
      body: JSON.stringify(batch),
    }).catch(() => {
      // Best-effort: a dropped log batch must never surface to the user or retry indefinitely.
    });
  }

  private buildContext(): ClientLogContext {
    return {
      client_session_id: this.sessionId,
      platform: detectPlatform(),
      device_type: detectDeviceType(),
      os: detectOs(),
      browser: detectBrowser(),
      is_native: Capacitor.isNativePlatform(),
      authenticated: this.auth.isAuthenticatedSignal(),
      role: this.auth.roleSignal() ?? undefined,
      org_id: this.auth.orgId() ?? undefined,
      impersonating: this.impersonation.viewingAs() !== null,
    };
  }

  /** One entry per launch with the session-level fields the contract only allows on `session_start`. */
  private sendSessionStart(): void {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return;

    this.enqueue({
      type: 'session_start',
      level: 'info',
      session: {
        user_agent: navigator.userAgent.slice(0, USER_AGENT_MAX_LENGTH),
        screen: { w: window.screen?.width ?? 0, h: window.screen?.height ?? 0 },
        dpr: window.devicePixelRatio || 1,
        touch: (navigator.maxTouchPoints || 0) > 0,
        lang: navigator.language,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
  }

  /** Establishes the starting breakpoint/orientation so the first resize doesn't log a false "change". */
  private recordViewportBaseline(): void {
    const viewport = getViewport();
    this.lastBreakpoint = getBreakpoint(viewport.w);
    this.lastOrientation = getOrientation(viewport.w, viewport.h);
  }

  private checkViewportChange(): void {
    const viewport = getViewport();
    const breakpoint = getBreakpoint(viewport.w);
    const orientation = getOrientation(viewport.w, viewport.h);

    if (breakpoint === this.lastBreakpoint && orientation === this.lastOrientation) return;

    this.lastBreakpoint = breakpoint;
    this.lastOrientation = orientation;
    this.enqueue({ type: 'viewport_change', level: 'info' });
  }

  private async registerNativeFlush(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const { App } = await import('@capacitor/app');
      await App.addListener('pause', () => this.flush());
    } catch {
      // Best-effort: missing native flush hook must not break app startup.
    }
  }
}
