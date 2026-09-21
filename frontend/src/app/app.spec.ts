import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { APP_TEST_PROVIDERS } from '../test-setup';
import { IS_NATIVE_PLATFORM } from './core/storage/token-storage';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: APP_TEST_PROVIDERS,
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('keeps a page gutter on web', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.className).toContain('pl-[max(0.5rem,env(safe-area-inset-left))]');
  });

  it('is edge-to-edge on native: no gutter, only safe-area insets', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [...APP_TEST_PROVIDERS, { provide: IS_NATIVE_PLATFORM, useValue: true }],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.className).toContain('pl-safe-left');
    expect(el.className).toContain('pr-safe-right');
    expect(el.className).not.toContain('pt-');
    expect(el.className).not.toContain('px-');
  });
});
