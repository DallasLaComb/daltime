export interface UaContext {
  device_type: 'mobile' | 'tablet' | 'desktop';
  os: 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'other';
  browser: string;
  platform: 'ios' | 'android' | 'web';
}

/**
 * Derives coarse device/platform context from the User-Agent string and an
 * optional X-Platform header (sent by the Angular/Capacitor frontend, values:
 * 'web' | 'ios' | 'android'). Pure function, no dependencies, testable in isolation.
 *
 * Limitations by design (Phase 8 adds richer client-side detection):
 * - iPadOS 13+ reports as "Macintosh" in the UA; without X-Platform: ios it
 *   will be classified as desktop/macos, which is corrected once the frontend
 *   sends the header.
 * - Android tablets have no reliable UA marker; classified as tablet when
 *   "Android" is present but "Mobile" is absent.
 */
export function parseUaContext(ua: string, platformHeader?: string): UaContext {
  const u = ua.toLowerCase();

  // Platform: explicit header always wins (Capacitor sets this in Phase 7+)
  let platform: UaContext['platform'] = 'web';
  if (platformHeader === 'ios' || platformHeader === 'android' || platformHeader === 'web') {
    platform = platformHeader;
  } else if (/iphone|ipad|ipod/.test(u)) {
    platform = 'ios';
  } else if (/android/.test(u)) {
    platform = 'android';
  }

  // OS
  let os: UaContext['os'] = 'other';
  if (/iphone|ipad|ipod/.test(u)) os = 'ios';
  else if (/android/.test(u)) os = 'android';
  else if (/windows/.test(u)) os = 'windows';
  else if (/macintosh|mac os x/.test(u)) os = 'macos';
  else if (/linux/.test(u)) os = 'linux';

  // If X-Platform says ios but UA says macintosh (iPadOS 13+), correct os
  if (platform === 'ios' && os === 'macos') os = 'ios';

  // Device type
  let device_type: UaContext['device_type'] = 'desktop';
  if (/iphone/.test(u) || (/android/.test(u) && /mobile/.test(u))) {
    device_type = 'mobile';
  } else if (/ipad/.test(u) || (/android/.test(u) && !/mobile/.test(u))) {
    device_type = 'tablet';
  }
  // iPadOS 13+ with explicit X-Platform: ios header — treat as tablet (conservative)
  if (platform === 'ios' && device_type === 'desktop') {
    device_type = 'tablet';
  }

  // Browser (coarse name only — no version, that's a Phase-8 client-side concern)
  let browser = 'other';
  if (/edg\//.test(u)) browser = 'edge';
  else if (/chrome\//.test(u) && !/chromium/.test(u)) browser = 'chrome';
  else if (/firefox\//.test(u)) browser = 'firefox';
  else if (/safari\//.test(u)) browser = 'safari';

  return { device_type, os, browser, platform };
}
