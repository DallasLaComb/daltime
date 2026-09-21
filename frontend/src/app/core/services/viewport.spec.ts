import { TestBed } from '@angular/core/testing';
import { MOBILE_MEDIA_QUERY, Viewport } from './viewport';

type ChangeListener = (event: MediaQueryListEvent) => void;

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<ChangeListener>();
  const query = {
    matches,
    addEventListener: vi.fn((_: string, l: ChangeListener) => listeners.add(l)),
    removeEventListener: vi.fn((_: string, l: ChangeListener) => listeners.delete(l)),
  };
  const matchMedia = vi.fn().mockReturnValue(query);
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    matchMedia,
    query,
    fire: (next: boolean) => listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent)),
  };
}

describe('Viewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('is not mobile when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(TestBed.inject(Viewport).isMobile()).toBe(false);
  });

  it('reads the initial match for the md breakpoint', () => {
    const { matchMedia } = stubMatchMedia(true);
    expect(TestBed.inject(Viewport).isMobile()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(MOBILE_MEDIA_QUERY);
  });

  it('updates when the viewport crosses the breakpoint', () => {
    const { fire } = stubMatchMedia(false);
    const viewport = TestBed.inject(Viewport);
    expect(viewport.isMobile()).toBe(false);

    fire(true);
    expect(viewport.isMobile()).toBe(true);

    fire(false);
    expect(viewport.isMobile()).toBe(false);
  });

  it('stops listening when destroyed', () => {
    const { query } = stubMatchMedia(false);
    TestBed.inject(Viewport);

    TestBed.resetTestingModule();

    expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
