import { Capacitor } from '@capacitor/core';
import type { ClientLogContext, ClientLogEntry } from '../models/client-log.model';

/**
 * Pure, unit-testable device/screen detection for the client-logs pipeline (Phases 7-8a). The
 * reactive piece that watches resize/orientationchange and decides when to log a `viewport_change`
 * entry lives in `LoggerService` itself, not here — there is exactly one consumer today, so a
 * separate signal service would be an abstraction with no second caller (see Phase 8a completion
 * notes in docs/0-logging.blueprint.md).
 */

type Breakpoint = NonNullable<ClientLogEntry['breakpoint']>;
type Orientation = NonNullable<ClientLogEntry['orientation']>;
type Viewport = NonNullable<ClientLogEntry['viewport']>;

export function detectPlatform(): ClientLogContext['platform'] {
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : 'web';
}

export function detectOs(): ClientLogContext['os'] {
  if (Capacitor.getPlatform() === 'ios') return 'ios';
  if (Capacitor.getPlatform() === 'android') return 'android';

  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  if (/windows/.test(ua)) return 'windows';
  if (/macintosh|mac os x/.test(ua)) return 'macos';
  if (/linux/.test(ua)) return 'linux';
  return 'other';
}

/**
 * `touchPoints` and `screen` are only consulted when the UA alone is ambiguous:
 * - iPadOS 13+ reports as "Macintosh" in the UA; a real Mac has zero touch points.
 * - A WebView or unusual browser with no recognisable OS token still gets a reasonable guess from
 *   touch support + physical screen size, instead of always falling back to "desktop".
 */
export function detectDeviceType(
  ua: string = navigator.userAgent,
  touchPoints: number = navigator.maxTouchPoints || 0,
  screen: Viewport = { w: window.screen?.width ?? 0, h: window.screen?.height ?? 0 },
): ClientLogContext['device_type'] {
  const u = ua.toLowerCase();

  if (/ipad/.test(u)) return 'tablet';
  if (/iphone|ipod/.test(u)) return 'mobile';
  if (/macintosh/.test(u)) return touchPoints > 0 ? 'tablet' : 'desktop';
  if (/android/.test(u)) return /mobile/.test(u) ? 'mobile' : 'tablet';

  if (touchPoints > 0) return Math.min(screen.w, screen.h) >= 600 ? 'tablet' : 'mobile';
  return 'desktop';
}

export function detectBrowser(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/edg\//.test(ua)) return 'edge';
  if (/chrome\//.test(ua) && !/chromium/.test(ua)) return 'chrome';
  if (/firefox\//.test(ua)) return 'firefox';
  if (/safari\//.test(ua)) return 'safari';
  return 'other';
}

/** Mirrors tailwind.config.js's (default, unoverridden) `screens`. */
export function getBreakpoint(width: number): Breakpoint {
  if (width >= 1536) return '2xl';
  if (width >= 1280) return 'xl';
  if (width >= 1024) return 'lg';
  if (width >= 768) return 'md';
  if (width >= 640) return 'sm';
  return 'base';
}

export function getOrientation(width: number, height: number): Orientation {
  return width >= height ? 'landscape' : 'portrait';
}

export function getViewport(): Viewport {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  return { w: window.innerWidth, h: window.innerHeight };
}
