import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Tailwind's `md` breakpoint is 768px, so "mobile" is anything narrower. */
export const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

/**
 * Reactive viewport size. Pages use `isMobile()` in `@if` blocks so exactly one layout is in the DOM
 * (unlike `hidden md:block` pairs, which duplicate content and every `data-testid` inside it).
 *
 * Reports `false` where `matchMedia` is unavailable (SSR, jsdom), so desktop layouts are the default in tests.
 */
@Injectable({ providedIn: 'root' })
export class Viewport {
  private readonly _isMobile = signal(false);
  readonly isMobile = this._isMobile.asReadonly();

  constructor() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(MOBILE_MEDIA_QUERY);
    this._isMobile.set(query.matches);

    const onChange = (event: MediaQueryListEvent): void => this._isMobile.set(event.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
}
