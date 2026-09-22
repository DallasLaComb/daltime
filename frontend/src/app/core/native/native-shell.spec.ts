import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { IS_NATIVE_PLATFORM } from '../storage/token-storage';
import { LoggerService } from '../logging/logger.service';
import { NATIVE_SHELL_LOADER, NativeShell } from './native-shell';

type BackButtonListener = (event: { canGoBack: boolean }) => void;

// `then` mimics Capacitor's plugin proxy, which forwards ANY property read (including `then`) to
// native: if NativeShell ever resolves a promise with a plugin itself, that promise would hang.
const app = {
  addListener: vi.fn(),
  exitApp: vi.fn(),
  then: vi.fn(),
};
const statusBar = {
  setStyle: vi.fn(),
  then: vi.fn(),
};
const statusBarStyle = { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' };

const router = { url: '/' };
const location = { back: vi.fn() };
const logger = { error: vi.fn() };

function createService(native: boolean, loader?: () => Promise<unknown>): NativeShell {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IS_NATIVE_PLATFORM, useValue: native },
      {
        provide: NATIVE_SHELL_LOADER,
        useValue: loader ?? (async () => ({ app, statusBar, statusBarStyle })),
      },
      { provide: Router, useValue: router },
      { provide: Location, useValue: location },
      { provide: LoggerService, useValue: logger },
    ],
  });
  return TestBed.inject(NativeShell);
}

/** Runs init() and returns the registered back-button listener. */
async function initAndGetListener(service: NativeShell): Promise<BackButtonListener> {
  await service.init();
  expect(app.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
  return app.addListener.mock.calls[0][1] as BackButtonListener;
}

describe('NativeShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    router.url = '/';
    app.addListener.mockResolvedValue({ remove: vi.fn() });
    app.exitApp.mockResolvedValue(undefined);
    statusBar.setStyle.mockResolvedValue(undefined);
  });

  describe('web', () => {
    it('does nothing and never loads the native plugins', async () => {
      const loader = vi.fn();
      const service = createService(false, loader);

      await service.init();

      expect(loader).not.toHaveBeenCalled();
      expect(app.addListener).not.toHaveBeenCalled();
      expect(statusBar.setStyle).not.toHaveBeenCalled();
    });
  });

  describe('native', () => {
    it('sets light status bar text for the dark navbar', async () => {
      await createService(true).init();

      expect(statusBar.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
    });

    it('does not resolve a promise with a plugin proxy', async () => {
      await createService(true).init();

      expect(app.then).not.toHaveBeenCalled();
      expect(statusBar.then).not.toHaveBeenCalled();
    });

    it('navigates back on a nested route when history exists', async () => {
      router.url = '/manager/employees';
      const listener = await initAndGetListener(createService(true));

      listener({ canGoBack: true });

      expect(location.back).toHaveBeenCalledOnce();
      expect(app.exitApp).not.toHaveBeenCalled();
    });

    it.each([
      '/',
      '/login',
      '/web-admin',
      '/org-admin',
      '/manager',
      '/employee',
      '/employee/schedule',
    ])('exits the app at the root page %s', async (url) => {
      router.url = url;
      const listener = await initAndGetListener(createService(true));

      listener({ canGoBack: true });

      expect(app.exitApp).toHaveBeenCalledOnce();
      expect(location.back).not.toHaveBeenCalled();
    });

    it('ignores query string and fragment when detecting a root page', async () => {
      router.url = '/manager?week=2#top';
      const listener = await initAndGetListener(createService(true));

      listener({ canGoBack: true });

      expect(app.exitApp).toHaveBeenCalledOnce();
    });

    it('exits the app on a nested route when there is no history to go back to', async () => {
      router.url = '/manager/employees';
      const listener = await initAndGetListener(createService(true));

      listener({ canGoBack: false });

      expect(app.exitApp).toHaveBeenCalledOnce();
      expect(location.back).not.toHaveBeenCalled();
    });

    it('still registers the back button when the status bar call fails', async () => {
      statusBar.setStyle.mockRejectedValue(new Error('not implemented'));

      await createService(true).init();

      expect(app.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
      expect(logger.error).toHaveBeenCalledWith('Status bar style failed', expect.any(Error));
    });

    it('never throws when the plugins fail to load', async () => {
      const service = createService(true, async () => {
        throw new Error('chunk load failed');
      });

      await expect(service.init()).resolves.toBeUndefined();

      expect(app.addListener).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith('Native shell plugins failed to load', expect.any(Error));
    });
  });
});
