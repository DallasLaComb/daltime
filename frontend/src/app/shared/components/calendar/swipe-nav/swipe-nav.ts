import { DestroyRef, Directive, ElementRef, inject, output } from '@angular/core';

/** Minimum horizontal travel (px) for a touch to count as a swipe. */
export const SWIPE_MIN_DISTANCE = 60;
/** The gesture must be at least this many times wider than it is tall, so vertical scrolling never navigates. */
export const SWIPE_HORIZONTAL_DOMINANCE = 1.5;

/**
 * Emits `swipedNext` (finger moved left) / `swipedPrev` (finger moved right) for a horizontal swipe on the host.
 * Listeners are passive, so vertical scrolling is never blocked. Buttons remain the accessible alternative.
 */
@Directive({ selector: '[appSwipeNav]' })
export class SwipeNavDirective {
  readonly swipedPrev = output<void>();
  readonly swipedNext = output<void>();

  constructor() {
    const el: HTMLElement = inject(ElementRef).nativeElement;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onStart = (event: TouchEvent): void => {
      // Multi-touch (pinch) is not a swipe.
      tracking = event.touches.length === 1;
      if (!tracking) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };

    const onEnd = (event: TouchEvent): void => {
      if (!tracking) return;
      tracking = false;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return;
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_HORIZONTAL_DOMINANCE) return;
      if (dx < 0) this.swipedNext.emit();
      else this.swipedPrev.emit();
    };

    const onCancel = (): void => {
      tracking = false;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    });
  }
}
