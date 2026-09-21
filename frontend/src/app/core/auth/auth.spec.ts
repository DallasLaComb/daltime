import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { AuthService, TOKEN_KEYS } from './auth';

// The shared APP_TEST_PROVIDERS replace AuthService with a mock, so this spec wires the real
// service (and the real TokenStorage, i.e. sessionStorage on web) with a stubbed Router.

function jwt(payload: Record<string, unknown>): string {
  return `h.${btoa(JSON.stringify(payload))}.s`;
}

const inSeconds = (s: number) => Math.floor(Date.now() / 1000) + s;
const validAccess = () => jwt({ exp: inSeconds(3600), 'cognito:groups': ['Employee'] });
const expiredAccess = () => jwt({ exp: inSeconds(-60), 'cognito:groups': ['Employee'] });

describe('AuthService', () => {
  let service: AuthService;
  let send: ReturnType<typeof vi.fn>;

  function create(): AuthService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: { navigate: vi.fn() } }] });
    const auth = TestBed.inject(AuthService);
    // @ts-expect-error — replace the private Cognito client with a stub
    auth.cognitoClient = { send };
    return auth;
  }

  beforeEach(() => {
    sessionStorage.clear();
    send = vi.fn().mockResolvedValue({ UserAttributes: [] });
    service = create();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initialize', () => {
    it('restores a session from stored, unexpired tokens', async () => {
      const access = validAccess();
      sessionStorage.setItem(TOKEN_KEYS.access, access);
      sessionStorage.setItem(TOKEN_KEYS.id, 'id-token');

      await service.initialize();

      expect(service.isAuthenticatedSignal()).toBe(true);
      expect(service.roleSignal()).toBe('Employee');
      expect(service.getAccessToken()).toBe(access);
      expect(service.authReady()).toBe(true);
    });

    it('stays logged out with no stored tokens', async () => {
      await service.initialize();

      expect(service.isAuthenticatedSignal()).toBe(false);
      expect(service.authReady()).toBe(true);
      expect(send).not.toHaveBeenCalled();
    });

    it('refreshes an expired access token with the stored refresh token', async () => {
      const fresh = validAccess();
      sessionStorage.setItem(TOKEN_KEYS.access, expiredAccess());
      sessionStorage.setItem(TOKEN_KEYS.id, 'old-id');
      sessionStorage.setItem(TOKEN_KEYS.refresh, 'refresh-1');
      send.mockImplementation(async (command: unknown) =>
        command instanceof InitiateAuthCommand
          ? { AuthenticationResult: { AccessToken: fresh, IdToken: 'new-id' } }
          : { UserAttributes: [] },
      );

      await service.initialize();

      const refreshCall = send.mock.calls
        .map(([c]) => c)
        .find((c): c is InitiateAuthCommand => c instanceof InitiateAuthCommand);
      expect(refreshCall?.input.AuthFlow).toBe('REFRESH_TOKEN_AUTH');
      expect(refreshCall?.input.AuthParameters).toEqual({ REFRESH_TOKEN: 'refresh-1' });
      expect(service.isAuthenticatedSignal()).toBe(true);
      expect(sessionStorage.getItem(TOKEN_KEYS.access)).toBe(fresh);
      expect(sessionStorage.getItem(TOKEN_KEYS.id)).toBe('new-id');
      // No rotation: the existing refresh token is kept.
      expect(sessionStorage.getItem(TOKEN_KEYS.refresh)).toBe('refresh-1');
    });

    it('clears all tokens and stays logged out when the refresh token is rejected', async () => {
      sessionStorage.setItem(TOKEN_KEYS.access, expiredAccess());
      sessionStorage.setItem(TOKEN_KEYS.id, 'old-id');
      sessionStorage.setItem(TOKEN_KEYS.refresh, 'revoked');
      send.mockRejectedValue(Object.assign(new Error('revoked'), { name: 'NotAuthorizedException' }));

      await service.initialize();

      expect(service.isAuthenticatedSignal()).toBe(false);
      expect(service.authReady()).toBe(true);
      for (const key of Object.values(TOKEN_KEYS)) expect(sessionStorage.getItem(key)).toBeNull();
    });
  });

  describe('login', () => {
    it('persists access, id and refresh tokens', async () => {
      const access = validAccess();
      send.mockImplementation(async (command: unknown) =>
        command instanceof InitiateAuthCommand
          ? { AuthenticationResult: { AccessToken: access, IdToken: 'id', RefreshToken: 'refresh' } }
          : { UserAttributes: [] },
      );

      const result = await service.login('a@b.com', 'pw');

      expect(result).toEqual({ success: true });
      expect(sessionStorage.getItem(TOKEN_KEYS.access)).toBe(access);
      expect(sessionStorage.getItem(TOKEN_KEYS.id)).toBe('id');
      expect(sessionStorage.getItem(TOKEN_KEYS.refresh)).toBe('refresh');
    });
  });

  describe('logout', () => {
    it('clears all three stored tokens and the auth state', async () => {
      sessionStorage.setItem(TOKEN_KEYS.access, validAccess());
      sessionStorage.setItem(TOKEN_KEYS.id, 'id');
      sessionStorage.setItem(TOKEN_KEYS.refresh, 'refresh');
      await service.initialize();

      service.logout();

      expect(service.isAuthenticatedSignal()).toBe(false);
      expect(service.getAccessToken()).toBeNull();
      for (const key of Object.values(TOKEN_KEYS)) expect(sessionStorage.getItem(key)).toBeNull();
    });
  });
});
