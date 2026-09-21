/**
 * Business-logic layer for the web-admin profile feature.
 *
 * Two pure service functions — `getProfile` and `updateProfile` — live here so
 * the handler stays thin and these functions can be unit-tested without AWS SDK
 * mocks (tests mock db.ts and cognito.ts instead).
 *
 * Auth guard (`requireWebAdminWithLookup`) is called by the handler before
 * reaching these functions so that `sub` here is always a verified, ACTIVE
 * WebAdmin identity.
 */

import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { stripKeys } from '../../shared/dynamo.js';
import { ValidationError, NotFoundError } from '../../shared/errors.js';
import { enrichSingleWithCognitoStatus } from '../../shared/cognito.js';
import * as db from './db.js';
import type { UpdateProfileRequest, WebAdminProfile } from './model.js';
import { logger } from '../../shared/logger.js';

/** Max/min length limits for name fields — prevents absurdly short or long values. */
const NAME_MIN = 1;
const NAME_MAX = 100;
/**
 * Allowed character set for name fields: letters (any Unicode letter via \p{L}),
 * hyphens, apostrophes, spaces, and periods — sufficient for virtually all
 * human names while rejecting control characters and injection-relevant symbols.
 */
const NAME_PATTERN = /^[\p{L}\p{M}'\-. ]+$/u;

/**
 * Validate a single name field value.
 *
 * Enforces: non-empty, within length bounds, and restricted to the name
 * character set. Throws `ValidationError` with a field-specific message so
 * callers get actionable feedback.
 */
function validateNameField(fieldName: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed.length < NAME_MIN) {
    throw new ValidationError(`${fieldName} cannot be empty`);
  }
  if (trimmed.length > NAME_MAX) {
    throw new ValidationError(`${fieldName} must be ${NAME_MAX} characters or fewer`);
  }
  if (!NAME_PATTERN.test(trimmed)) {
    throw new ValidationError(
      `${fieldName} contains invalid characters — only letters, hyphens, apostrophes, spaces, and periods are allowed`,
    );
  }
}

/**
 * Return the caller's own WebAdmin profile, enriched with the live Cognito
 * UserStatus so the frontend can display an accurate account state.
 *
 * `enrichSingleWithCognitoStatus` is best-effort — if the Cognito call fails
 * the original DynamoDB item is returned unchanged rather than surfacing a 500.
 */
export async function getProfile(
  sub: string,
  cognitoClient: CognitoIdentityProviderClient,
): Promise<WebAdminProfile> {
  const record = await db.getWebAdminProfile(sub);
  if (!record) throw new NotFoundError('WebAdmin profile not found');

  // Strip PK/SK/GSI keys before enrichment so they are never included in the
  // response. Cast through `unknown` because `stripKeys` returns `Omit<T, ...>`
  // which TypeScript cannot directly assign back to `WebAdminProfile`.
  const stripped = stripKeys(record) as unknown as WebAdminProfile;
  return enrichSingleWithCognitoStatus(stripped, cognitoClient);
}

/**
 * Apply a partial update to the caller's own WebAdmin profile.
 *
 * Validates that at least one field is provided and that each provided field
 * passes length/character-set checks before touching DynamoDB. Returns the
 * full updated profile (without PK/SK keys) via `ReturnValues: 'ALL_NEW'`.
 */
export async function updateProfile(
  sub: string,
  body: UpdateProfileRequest,
): Promise<WebAdminProfile> {
  // Require at least one field — an empty PUT body is a caller error, not a
  // no-op, so we surface a 400 rather than silently writing only `updated_at`.
  const hasFirst = body.first_name !== undefined;
  const hasLast = body.last_name !== undefined;
  if (!hasFirst && !hasLast) {
    throw new ValidationError('At least one of first_name or last_name must be provided');
  }

  // Validate each field that was actually supplied — skip fields not present
  // in the body (partial update semantics: omitting a field means "leave it").
  if (hasFirst) validateNameField('first_name', body.first_name as string);
  if (hasLast) validateNameField('last_name', body.last_name as string);

  // Build the trimmed-field map to write — only include fields the caller
  // provided so `buildUpdateExpression` skips the undefined ones.
  const fields: { first_name?: string; last_name?: string } = {};
  if (hasFirst) fields.first_name = (body.first_name as string).trim();
  if (hasLast) fields.last_name = (body.last_name as string).trim();

  const updatedAt = new Date().toISOString();
  const updated = await db.updateWebAdminProfile(sub, fields, updatedAt);
  if (!updated) throw new NotFoundError('WebAdmin profile not found');
  logger.info('web admin profile updated', { user_id: sub });

  return stripKeys(updated) as unknown as WebAdminProfile;
}
