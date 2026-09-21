import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  GetUserCommand,
  UpdateUserAttributesCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { type UserRole, isValidRole, ROLE_DASHBOARD_MAP } from './user-role.model';
import { TokenStorage } from '../storage/token-storage';
import { BiometricLock } from './biometric-lock';

export const TOKEN_KEYS = {
  access: 'daltime_access_token',
  id: 'daltime_id_token',
  refresh: 'daltime_refresh_token',
} as const;

/** Shown for a wrong email or password; also how a stale saved biometric login is recognised. */
export const INCORRECT_CREDENTIALS_ERROR = 'Incorrect email or password.';

const AUTH_ERROR_MAP: Record<string, string> = {
  NotAuthorizedException: INCORRECT_CREDENTIALS_ERROR,
  UserNotFoundException: INCORRECT_CREDENTIALS_ERROR,
  UserNotConfirmedException: 'Account not confirmed. Contact your administrator.',
  CodeMismatchException: 'Invalid verification code.',
  ExpiredCodeException: 'Verification code has expired. Please request a new one.',
  LimitExceededException: 'Too many attempts. Please try again later.',
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly tokens = inject(TokenStorage);
  private readonly biometricLock = inject(BiometricLock);
  private readonly cognitoClient = new CognitoIdentityProviderClient({
    region: environment.cognito.region,
  });

  // --- Reactive state ---
  private readonly _isAuthenticated = signal(false);
  private readonly _role = signal<UserRole | null>(null);
  private readonly _authReady = signal(false);

  readonly isAuthenticatedSignal = this._isAuthenticated.asReadonly();
  readonly roleSignal = this._role.asReadonly();
  readonly authReady = this._authReady.asReadonly();

  // --- Scalar state ---
  accessToken: string | null = null;
  idToken: string | null = null;
  private readonly _orgId = signal<string | null>(null);
  readonly orgId = this._orgId.asReadonly();

  // Stores the authenticated user's given name and family name from Cognito attributes
  // so any view (e.g. navbar) can display a personalised greeting without an extra API call.
  private readonly _firstName = signal('');
  private readonly _lastName = signal('');
  readonly firstName = this._firstName.asReadonly();
  readonly lastName = this._lastName.asReadonly();

  // --- Challenge state (for NEW_PASSWORD_REQUIRED flow) ---
  private challengeSession: string | null = null;
  private challengeEmail: string | null = null;

  get hasPendingChallenge(): boolean {
    return this.challengeSession !== null;
  }

  async initialize(): Promise<void> {
    // Native app lock: a saved session is only restored after Face ID / Touch ID succeeds. On failure the
    // stored tokens are kept (the next launch, or the login page's biometric button, can unlock them)
    // but this launch shows the password login.
    if (this.hasSavedSession() && !(await this.biometricLock.unlock())) {
      this._authReady.set(true);
      return;
    }

    await this.restoreSession();
    this._authReady.set(true);
  }

  /** True when tokens from an earlier login are still stored (native: Keychain/Keystore). */
  hasSavedSession(): boolean {
    return !!(this.tokens.get(TOKEN_KEYS.access) || this.tokens.get(TOKEN_KEYS.refresh));
  }

  /**
   * The login page's "Sign in with Face ID" button: asks for a biometric and, on success, restores the
   * saved session (refreshing the access token if needed). Resolves false when there is no saved session,
   * the prompt fails, or the saved session can no longer be restored (e.g. the refresh token expired).
   */
  async signInWithBiometrics(): Promise<boolean> {
    if (!this.hasSavedSession() || !(await this.biometricLock.unlock())) return false;

    await this.restoreSession();
    return this._isAuthenticated();
  }

  private async restoreSession(): Promise<void> {
    let accessToken = this.tokens.get(TOKEN_KEYS.access);
    let idToken = this.tokens.get(TOKEN_KEYS.id);

    // An app relaunched after the 60-minute access token lapsed still holds a refresh token
    // (5 days): trade it for a fresh access/id token instead of forcing a new login.
    if (!accessToken || !idToken || this.isTokenExpired(accessToken)) {
      const refreshed = await this.refreshSession();
      accessToken = refreshed?.accessToken ?? null;
      idToken = refreshed?.idToken ?? null;
    }

    if (accessToken && idToken && !this.isTokenExpired(accessToken)) {
      this.accessToken = accessToken;
      this.idToken = idToken;
      this._isAuthenticated.set(true);

      const role = this.extractUserRole(accessToken);
      this._role.set(role);

      await this.getUserAttributes();

      if (role && ['/', '/login'].includes(globalThis.location.pathname)) {
        this.router.navigate([ROLE_DASHBOARD_MAP[role]]);
      }
    }
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ success: boolean; challenge?: string; error?: string }> {
    try {
      const response = await this.cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: environment.cognito.clientId,
          AuthParameters: {
            USERNAME: email,
            PASSWORD: password,
          },
        }),
      );

      if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        this.challengeSession = response.Session ?? null;
        this.challengeEmail = email;
        return { success: false, challenge: 'NEW_PASSWORD_REQUIRED' };
      }

      if (response.AuthenticationResult) {
        this.storeTokens(response.AuthenticationResult);
        return { success: true };
      }

      return { success: false, error: 'Unexpected response from authentication service.' };
    } catch (err: unknown) {
      return { success: false, error: this.mapAuthError(err) };
    }
  }

  async completeNewPassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (!this.challengeSession || !this.challengeEmail) {
      return { success: false, error: 'No pending password challenge.' };
    }

    try {
      const response = await this.cognitoClient.send(
        new RespondToAuthChallengeCommand({
          ClientId: environment.cognito.clientId,
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: this.challengeSession,
          ChallengeResponses: {
            USERNAME: this.challengeEmail,
            NEW_PASSWORD: newPassword,
          },
        }),
      );

      this.challengeSession = null;
      this.challengeEmail = null;

      if (response.AuthenticationResult) {
        this.storeTokens(response.AuthenticationResult);
        return { success: true };
      }

      return { success: false, error: 'Unexpected response from authentication service.' };
    } catch (err: unknown) {
      return { success: false, error: this.mapAuthError(err) };
    }
  }

  logout(): void {
    this._isAuthenticated.set(false);
    this._role.set(null);
    this.accessToken = null;
    this.idToken = null;
    this._orgId.set(null);
    // Clear name signals so a subsequent login as a different user doesn't flash
    // the previous user's name before the new attributes are fetched.
    this._firstName.set('');
    this._lastName.set('');
    this.challengeSession = null;
    this.challengeEmail = null;

    void this.clearStoredTokens();

    this.router.navigate(['/']);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  routeToDashboardForRole(role: UserRole): string {
    return ROLE_DASHBOARD_MAP[role];
  }

  async getUserAttributes(): Promise<void> {
    if (!this.accessToken) return;

    try {
      const response = await this.cognitoClient.send(
        new GetUserCommand({ AccessToken: this.accessToken }),
      );

      const orgIdAttr = response.UserAttributes?.find((attr) => attr.Name === 'custom:org_id');
      if (orgIdAttr?.Value) {
        this._orgId.set(orgIdAttr.Value);
      }

      // Extract the user's given_name and family_name so the navbar can display a
      // personalised name without a separate Cognito call on every navigation event.
      const firstNameAttr = response.UserAttributes?.find((attr) => attr.Name === 'given_name');
      const lastNameAttr = response.UserAttributes?.find((attr) => attr.Name === 'family_name');
      if (firstNameAttr?.Value) this._firstName.set(firstNameAttr.Value);
      if (lastNameAttr?.Value) this._lastName.set(lastNameAttr.Value);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('GetUser failed:', message);
    }
  }

  async updateUserAttribute(attributeName: string, attributeValue: string): Promise<boolean> {
    if (!this.accessToken) return false;

    try {
      await this.cognitoClient.send(
        new UpdateUserAttributesCommand({
          AccessToken: this.accessToken,
          UserAttributes: [{ Name: attributeName, Value: attributeValue }],
        }),
      );
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('UpdateUserAttributes failed:', message);
      return false;
    }
  }

  private async persistTokens(result: {
    AccessToken?: string;
    IdToken?: string;
    RefreshToken?: string;
  }): Promise<void> {
    this.accessToken = result.AccessToken ?? null;
    this.idToken = result.IdToken ?? null;

    await Promise.all([
      result.AccessToken && this.tokens.set(TOKEN_KEYS.access, result.AccessToken),
      result.IdToken && this.tokens.set(TOKEN_KEYS.id, result.IdToken),
      result.RefreshToken && this.tokens.set(TOKEN_KEYS.refresh, result.RefreshToken),
    ]);
  }

  private async clearStoredTokens(): Promise<void> {
    await Promise.all(Object.values(TOKEN_KEYS).map((key) => this.tokens.remove(key)));
  }

  /**
   * Exchanges the stored refresh token for a new access/id token (REFRESH_TOKEN_AUTH).
   * Returns null when there is no refresh token or Cognito rejects it (expired/revoked),
   * in which case the stored tokens are cleared so the user lands on the login screen.
   */
  private async refreshSession(): Promise<{ accessToken: string; idToken: string } | null> {
    const refreshToken = this.tokens.get(TOKEN_KEYS.refresh);
    if (!refreshToken) return null;

    try {
      const response = await this.cognitoClient.send(
        new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: environment.cognito.clientId,
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      );

      const result = response.AuthenticationResult;
      if (result?.AccessToken && result.IdToken) {
        // Cognito only returns a new refresh token when rotation is enabled; otherwise keep ours.
        await this.persistTokens(result);
        return { accessToken: result.AccessToken, idToken: result.IdToken };
      }
    } catch {
      // Refresh token expired or revoked — fall through and clear.
    }

    await this.clearStoredTokens();
    return null;
  }

  private async storeTokens(result: {
    AccessToken?: string;
    IdToken?: string;
    RefreshToken?: string;
  }): Promise<void> {
    await this.persistTokens(result);

    this._isAuthenticated.set(true);

    const role = this.extractUserRole(this.accessToken);
    this._role.set(role);

    await this.getUserAttributes();

    if (role) {
      this.router.navigate([ROLE_DASHBOARD_MAP[role]]);
    }
  }

  private extractUserRole(accessToken: string | null): UserRole | null {
    if (!accessToken) return null;

    try {
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const groups: unknown[] = payload['cognito:groups'] ?? [];
      const role = groups.find((g) => isValidRole(g)) as UserRole | undefined;
      if (role) return role;
    } catch {
      // malformed token
    }

    console.warn('No valid Cognito group found in access token.');
    return null;
  }

  private isTokenExpired(token: string): boolean {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return Date.now() >= payload.exp * 1000;
    } catch {
      return true;
    }
  }

  private mapAuthError(err: unknown): string {
    if (!(err instanceof Error)) return 'An unexpected error occurred. Please try again.';
    if (err.name === 'InvalidPasswordException' || err.name === 'InvalidParameterException')
      return err.message;
    return AUTH_ERROR_MAP[err.name] ?? 'An unexpected error occurred. Please try again.';
  }

  async forgotPassword(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.cognitoClient.send(
        new ForgotPasswordCommand({
          ClientId: environment.cognito.clientId,
          Username: email,
        }),
      );
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: this.mapAuthError(err) };
    }
  }

  async confirmForgotPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.cognitoClient.send(
        new ConfirmForgotPasswordCommand({
          ClientId: environment.cognito.clientId,
          Username: email,
          ConfirmationCode: code,
          Password: newPassword,
        }),
      );
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: this.mapAuthError(err) };
    }
  }
}
