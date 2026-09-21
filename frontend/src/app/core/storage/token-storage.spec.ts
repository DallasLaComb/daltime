import { TestBed } from '@angular/core/testing';
import { IS_NATIVE_PLATFORM, SECURE_STORAGE_LOADER, TokenStorage } from './token-storage';

// A fake plugin. `then` mimics Capacitor's plugin proxy, which forwards ANY property read
// (including `then`) to native: if TokenStorage ever resolves a promise with the plugin itself,
// the promise hangs and `then` gets called.
const plugin = {
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  then: vi.fn(),
};
const pluginThen = plugin.then;

function createService(native: boolean): TokenStorage {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: IS_NATIVE_PLATFORM, useValue: native },
      { provide: SECURE_STORAGE_LOADER, useValue: async () => ({ plugin }) },
    ],
  });
  return TestBed.inject(TokenStorage);
}

describe('TokenStorage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
    plugin.get.mockRejectedValue(new Error('Item with given key does not exist'));
    plugin.set.mockResolvedValue({ value: true });
    plugin.remove.mockResolvedValue({ value: true });
  });

  describe('web', () => {
    it('reads, writes and removes via sessionStorage', async () => {
      const storage = createService(false);

      await storage.set('k', 'v');
      expect(sessionStorage.getItem('k')).toBe('v');
      expect(storage.get('k')).toBe('v');

      await storage.remove('k');
      expect(sessionStorage.getItem('k')).toBeNull();
      expect(storage.get('k')).toBeNull();
    });

    it('never touches the native plugin and hydrate is a no-op', async () => {
      const storage = createService(false);

      await storage.hydrate(['k']);
      await storage.set('k', 'v');
      await storage.remove('k');

      expect(plugin.get).not.toHaveBeenCalled();
      expect(plugin.set).not.toHaveBeenCalled();
      expect(plugin.remove).not.toHaveBeenCalled();
    });
  });

  describe('native', () => {
    it('hydrate loads stored values into the synchronous cache and skips missing keys', async () => {
      plugin.get.mockImplementation(async ({ key }) => {
        if (key === 'present') return { value: 'secret' };
        throw new Error('Item with given key does not exist');
      });
      const storage = createService(true);

      expect(storage.get('present')).toBeNull(); // not hydrated yet

      await storage.hydrate(['present', 'missing']);

      expect(storage.get('present')).toBe('secret');
      expect(storage.get('missing')).toBeNull();
    });

    it('never resolves a promise with the plugin proxy itself (would hang on plugin.then)', async () => {
      const storage = createService(true);

      await storage.hydrate(['k']);
      await storage.set('k', 'v');
      await storage.remove('k');

      expect(pluginThen).not.toHaveBeenCalled();
    });

    it('does not use sessionStorage', async () => {
      const storage = createService(true);

      await storage.set('k', 'v');

      expect(sessionStorage.getItem('k')).toBeNull();
    });

    it('set updates the cache immediately and writes through to the plugin', async () => {
      const storage = createService(true);

      const pending = storage.set('k', 'v');
      expect(storage.get('k')).toBe('v');
      await pending;

      expect(plugin.set).toHaveBeenCalledWith({ key: 'k', value: 'v' });
    });

    it('remove clears the cache immediately and writes through to the plugin', async () => {
      const storage = createService(true);
      await storage.set('k', 'v');

      const pending = storage.remove('k');
      expect(storage.get('k')).toBeNull();
      await pending;

      expect(plugin.remove).toHaveBeenCalledWith({ key: 'k' });
    });

    it('keeps the in-memory value when the plugin write fails', async () => {
      plugin.set.mockRejectedValue(new Error('keychain unavailable'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const storage = createService(true);

      await expect(storage.set('k', 'v')).resolves.toBeUndefined();

      expect(storage.get('k')).toBe('v');
      expect(consoleError).toHaveBeenCalled();
    });

    it('remove of a key that was never stored does not log an error', async () => {
      plugin.remove.mockRejectedValue(new Error('Item with given key does not exist'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const storage = createService(true);

      await expect(storage.remove('never-set')).resolves.toBeUndefined();

      expect(consoleError).not.toHaveBeenCalled();
    });
  });
});
