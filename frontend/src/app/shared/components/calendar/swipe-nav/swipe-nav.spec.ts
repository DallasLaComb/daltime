import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwipeNavDirective } from './swipe-nav';

@Component({
  imports: [SwipeNavDirective],
  template: `<div appSwipeNav (swipedPrev)="prev = prev + 1" (swipedNext)="next = next + 1"></div>`,
})
class HostComponent {
  prev = 0;
  next = 0;
}

function touch(target: Element, type: string, x: number, y: number, count = 1): void {
  const point = { clientX: x, clientY: y } as Touch;
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    touches: type === 'touchend' ? [] : new Array<Touch>(count).fill(point),
    changedTouches: [point],
  });
  target.dispatchEvent(event);
}

function swipe(target: Element, from: [number, number], to: [number, number]): void {
  touch(target, 'touchstart', from[0], from[1]);
  touch(target, 'touchend', to[0], to[1]);
}

describe('SwipeNavDirective', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { host: fixture.componentInstance, target: fixture.nativeElement.firstElementChild };
  }

  it('emits swipedNext for a leftward swipe', () => {
    const { host, target } = setup();
    swipe(target, [300, 200], [150, 210]);
    expect([host.prev, host.next]).toEqual([0, 1]);
  });

  it('emits swipedPrev for a rightward swipe', () => {
    const { host, target } = setup();
    swipe(target, [100, 200], [260, 190]);
    expect([host.prev, host.next]).toEqual([1, 0]);
  });

  it('ignores short movements', () => {
    const { host, target } = setup();
    swipe(target, [200, 200], [170, 200]);
    expect([host.prev, host.next]).toEqual([0, 0]);
  });

  it('ignores mostly-vertical gestures so scrolling never navigates', () => {
    const { host, target } = setup();
    swipe(target, [200, 100], [120, 400]);
    expect([host.prev, host.next]).toEqual([0, 0]);
  });

  it('ignores multi-touch gestures', () => {
    const { host, target } = setup();
    touch(target, 'touchstart', 300, 200, 2);
    touch(target, 'touchend', 100, 200);
    expect([host.prev, host.next]).toEqual([0, 0]);
  });
});
