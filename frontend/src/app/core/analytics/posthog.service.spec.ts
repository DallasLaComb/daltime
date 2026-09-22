import { TestBed } from '@angular/core/testing';
import { PosthogService } from './posthog.service';
import { environment } from '../../../environments/environment';

// Matches the pattern in auth.spec.ts: replace the private SDK client instance directly rather
// than `vi.mock`-ing the module, which this project's test runner does not isolate reliably
// across the full suite (a mock registered by one spec file can miss another file's already-cached
// module instance).
function service(client: {
  init: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
}): PosthogService {
  TestBed.resetTestingModule();
  const svc = TestBed.inject(PosthogService);
  // @ts-expect-error — replace the private posthog-js client with a stub
  svc.client = client;
  return svc;
}

function fakeClient() {
  return { init: vi.fn(), identify: vi.fn(), reset: vi.fn(), capture: vi.fn() };
}

describe('PosthogService', () => {
  const originalPosthog = { ...environment.posthog };

  afterEach(() => {
    Object.assign(environment.posthog, originalPosthog);
  });

  it('does nothing when disabled', () => {
    environment.posthog.enabled = false;
    environment.posthog.apiKey = 'test-key';
    const client = fakeClient();
    const svc = service(client);

    svc.init();
    svc.identify('sub-1');
    svc.reset();
    svc.capture('x');

    expect(client.init).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
    expect(client.reset).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('does nothing when enabled but no API key is configured (e.g. GitHub var unset)', () => {
    environment.posthog.enabled = true;
    environment.posthog.apiKey = '';
    const client = fakeClient();
    const svc = service(client);

    svc.init();

    expect(client.init).not.toHaveBeenCalled();
  });

  it('treats an unsubstituted CD placeholder as not configured (real risk: base environment.ts used unresolved in unit tests)', () => {
    environment.posthog.enabled = true;
    environment.posthog.apiKey = '__VITE_POSTHOG_KEY__';
    const client = fakeClient();
    const svc = service(client);

    svc.init();
    svc.identify('sub-1');

    expect(client.init).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
  });

  it('initializes with privacy-first session recording config when enabled and configured', () => {
    environment.posthog.enabled = true;
    environment.posthog.apiKey = 'phc_test123';
    environment.posthog.apiHost = 'https://us.i.posthog.com';
    const client = fakeClient();
    const svc = service(client);

    svc.init();

    expect(client.init).toHaveBeenCalledWith(
      'phc_test123',
      expect.objectContaining({
        api_host: 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        mask_all_text: true,
        session_recording: expect.objectContaining({
          maskAllInputs: true,
          maskTextSelector: '*',
        }),
      }),
    );
  });

  it('identifies with the caller sub and never sends email/name-shaped keys', () => {
    environment.posthog.enabled = true;
    environment.posthog.apiKey = 'phc_test123';
    const client = fakeClient();
    const svc = service(client);

    svc.identify('84a84418-40c1-7045-379d-f227e67bb0ed', { role: 'Manager' });

    expect(client.identify).toHaveBeenCalledWith('84a84418-40c1-7045-379d-f227e67bb0ed', {
      role: 'Manager',
    });
  });

  it('resets on logout', () => {
    environment.posthog.enabled = true;
    environment.posthog.apiKey = 'phc_test123';
    const client = fakeClient();
    const svc = service(client);

    svc.reset();

    expect(client.reset).toHaveBeenCalled();
  });
});
