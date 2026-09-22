import { TestBed } from '@angular/core/testing';
import { IS_NATIVE_PLATFORM, SECURE_STORAGE_LOADER, TokenStorage } from '../storage/token-storage';
import { LoggerService } from '../logging/logger.service';
import {
  BIOMETRIC_LOADER,
  BIOMETRIC_LOCK_KEY,
  BIOMETRIC_LOGIN_KEY,
  BiometricLock,
} from './biometric-lock';

// `then` mimics Capacitor's plugin proxy, which forwards ANY property read (including `then`) to
// native: if BiometricLock ever resolves a promise with the plugin itself, that promise would hang.
const plugin = {
  isAvailable: vi.fn(),
  verifyIdentity: vi.fn(),
  setCredentials: vi.fn(),
  getSecureCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
  then: vi.fn(),
};
const secureStorage = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
};

const FACE_ID = 2;
const logger = { warn: vi.fn(), error: vi.fn() };

function createService(native: boolean): BiometricLock {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IS_NATIVE_PLATFORM, useValue: native },
      { provide: BIOMETRIC_LOADER, useValue: async () => ({ plugin }) },
      { provide: SECURE_STORAGE_LOADER, useValue: async () => ({ plugin: secureStorage }) },
      { provide: LoggerService, useValue: logger },
    ],
  });
  return TestBed.inject(BiometricLock);
}

/** A native service whose stored preference has been hydrated. */
async function createNative(stored?: string, savedLogin = false): Promise<BiometricLock> {
  secureStorage.get.mockImplementation(async ({ key }: { key: string }) => {
    if (key === BIOMETRIC_LOCK_KEY && stored !== undefined) return { value: stored };
    if (key === BIOMETRIC_LOGIN_KEY && savedLogin) return { value: 'saved' };
    throw new Error('Item with given key does not exist');
  });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IS_NATIVE_PLATFORM, useValue: true },
      { provide: BIOMETRIC_LOADER, useValue: async () => ({ plugin }) },
      { provide: SECURE_STORAGE_LOADER, useValue: async () => ({ plugin: secureStorage }) },
    ],
  });
  await TestBed.inject(TokenStorage).hydrate([BIOMETRIC_LOCK_KEY, BIOMETRIC_LOGIN_KEY]);
  return TestBed.inject(BiometricLock);
}

describe('BiometricLock', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    plugin.isAvailable.mockResolvedValue({ isAvailable: true, biometryType: FACE_ID });
    plugin.verifyIdentity.mockResolvedValue(undefined);
    secureStorage.get.mockRejectedValue(new Error('Item with given key does not exist'));
    secureStorage.set.mockResolvedValue({ value: true });
    secureStorage.remove.mockResolvedValue({ value: true });
    plugin.setCredentials.mockResolvedValue(undefined);
    plugin.deleteCredentials.mockResolvedValue(undefined);
    plugin.getSecureCredentials.mockResolvedValue({ username: 'a@b.com', password: 'pw' });
  });

  describe('web', () => {
    it('unlock resolves true without touching the plugin', async () => {
      const lock = createService(false);

      expect(await lock.unlock()).toBe(true);
      await lock.refreshSupport();

      expect(plugin.isAvailable).not.toHaveBeenCalled();
      expect(plugin.verifyIdentity).not.toHaveBeenCalled();
      expect(lock.supported()).toBe(false);
    });

    it('setEnabled does nothing', async () => {
      const lock = createService(false);

      expect(await lock.setEnabled(true)).toBe(false);
      expect(plugin.verifyIdentity).not.toHaveBeenCalled();
    });
  });

  describe('native unlock', () => {
    it('resolves true after a successful prompt', async () => {
      const lock = await createNative();

      expect(await lock.unlock()).toBe(true);
      expect(plugin.verifyIdentity).toHaveBeenCalledTimes(1);
    });

    it('resolves false when the prompt is cancelled or fails', async () => {
      plugin.verifyIdentity.mockRejectedValue(new Error('User canceled'));
      const lock = await createNative();

      expect(await lock.unlock()).toBe(false);
    });

    it('resolves true without prompting when the device has no biometrics or passcode', async () => {
      plugin.isAvailable.mockResolvedValue({ isAvailable: false, biometryType: 0 });
      const lock = await createNative();

      expect(await lock.unlock()).toBe(true);
      expect(plugin.verifyIdentity).not.toHaveBeenCalled();
    });

    it('resolves true without prompting when the user turned the lock off', async () => {
      const lock = await createNative('off');

      expect(await lock.unlock()).toBe(true);
      expect(plugin.isAvailable).not.toHaveBeenCalled();
      expect(plugin.verifyIdentity).not.toHaveBeenCalled();
    });

    it('fails closed when the availability check throws', async () => {
      plugin.isAvailable.mockRejectedValue(new Error('plugin broke'));
      const lock = await createNative();

      expect(await lock.unlock()).toBe(false);
      expect(plugin.verifyIdentity).not.toHaveBeenCalled();
    });

    it('fails closed when the plugin cannot be loaded', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          { provide: IS_NATIVE_PLATFORM, useValue: true },
          {
            provide: BIOMETRIC_LOADER,
            useValue: async () => {
              throw new Error('chunk failed');
            },
          },
          { provide: SECURE_STORAGE_LOADER, useValue: async () => ({ plugin: secureStorage }) },
        ],
      });
      await TestBed.inject(TokenStorage).hydrate([BIOMETRIC_LOCK_KEY]);

      expect(await TestBed.inject(BiometricLock).unlock()).toBe(false);
    });

    it('never resolves a promise with the plugin proxy itself', async () => {
      const lock = await createNative();

      await lock.unlock();
      await lock.refreshSupport();

      expect(plugin.then).not.toHaveBeenCalled();
    });
  });

  describe('refreshSupport', () => {
    it('reports support and the biometric label', async () => {
      const lock = await createNative();

      await lock.refreshSupport();

      expect(lock.supported()).toBe(true);
      expect(lock.label()).toBe('Face ID');
    });

    it('reports unsupported when nothing is available or the check throws', async () => {
      plugin.isAvailable.mockResolvedValue({ isAvailable: false, biometryType: 0 });
      const lock = await createNative();
      await lock.refreshSupport();
      expect(lock.supported()).toBe(false);

      plugin.isAvailable.mockRejectedValue(new Error('nope'));
      await lock.refreshSupport();
      expect(lock.supported()).toBe(false);
    });
  });

  describe('setEnabled', () => {
    it('defaults to enabled', async () => {
      expect((await createNative()).enabled()).toBe(true);
    });

    it('turning off persists the preference without prompting', async () => {
      const lock = await createNative();

      expect(await lock.setEnabled(false)).toBe(false);

      expect(lock.enabled()).toBe(false);
      expect(plugin.verifyIdentity).not.toHaveBeenCalled();
      expect(secureStorage.set).toHaveBeenCalledWith({ key: BIOMETRIC_LOCK_KEY, value: 'off' });
    });

    it('turning on requires a successful prompt', async () => {
      const lock = await createNative('off');

      expect(await lock.setEnabled(true)).toBe(true);

      expect(plugin.verifyIdentity).toHaveBeenCalledTimes(1);
      expect(lock.enabled()).toBe(true);
      expect(secureStorage.set).toHaveBeenCalledWith({ key: BIOMETRIC_LOCK_KEY, value: 'on' });
    });

    it('stays off when the enabling prompt is declined', async () => {
      plugin.verifyIdentity.mockRejectedValue(new Error('User canceled'));
      const lock = await createNative('off');

      expect(await lock.setEnabled(true)).toBe(false);

      expect(lock.enabled()).toBe(false);
      expect(secureStorage.set).not.toHaveBeenCalled();
    });
  });

  describe('saved login', () => {
    it('is not saved by default', async () => {
      expect((await createNative()).hasCredentials()).toBe(false);
    });

    it('saveCredentials stores behind biometrics and remembers it', async () => {
      const lock = await createNative();

      expect(await lock.saveCredentials('a@b.com', 'pw')).toBe(true);

      expect(plugin.setCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'a@b.com', password: 'pw', accessControl: 2 }),
      );
      expect(lock.hasCredentials()).toBe(true);
      expect(secureStorage.set).toHaveBeenCalledWith({ key: BIOMETRIC_LOGIN_KEY, value: 'saved' });
    });

    it('saveCredentials stores nothing when the plugin rejects', async () => {
      plugin.setCredentials.mockRejectedValue(new Error('User canceled'));
      const lock = await createNative();

      expect(await lock.saveCredentials('a@b.com', 'pw')).toBe(false);

      expect(lock.hasCredentials()).toBe(false);
      expect(secureStorage.set).not.toHaveBeenCalled();
    });

    it('getCredentials returns the saved login after a biometric', async () => {
      const lock = await createNative(undefined, true);

      expect(lock.hasCredentials()).toBe(true);
      expect(await lock.getCredentials()).toEqual({ username: 'a@b.com', password: 'pw' });
      expect(plugin.then).not.toHaveBeenCalled();
    });

    it('getCredentials returns null when cancelled or when nothing is saved', async () => {
      const saved = await createNative(undefined, true);
      plugin.getSecureCredentials.mockRejectedValue(new Error('User canceled'));
      expect(await saved.getCredentials()).toBeNull();

      const none = await createNative();
      expect(await none.getCredentials()).toBeNull();
      expect(plugin.getSecureCredentials).toHaveBeenCalledTimes(1);
    });

    it('clearCredentials forgets the login even if the plugin has nothing to delete', async () => {
      plugin.deleteCredentials.mockRejectedValue(new Error('not found'));
      const lock = await createNative(undefined, true);

      await lock.clearCredentials();

      expect(lock.hasCredentials()).toBe(false);
      expect(secureStorage.remove).toHaveBeenCalledWith({ key: BIOMETRIC_LOGIN_KEY });
    });

    it('does nothing on web', async () => {
      const lock = createService(false);

      expect(await lock.saveCredentials('a@b.com', 'pw')).toBe(false);
      expect(await lock.getCredentials()).toBeNull();
      await lock.clearCredentials();
      expect(plugin.setCredentials).not.toHaveBeenCalled();
      expect(plugin.deleteCredentials).not.toHaveBeenCalled();
    });
  });
});
