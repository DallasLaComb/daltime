/**
 * Unit tests for contract-backed request validation.
 *
 * These cover the seam introduced by the OpenAPI contract migration: request
 * bodies are now validated against the very same Zod schemas that generate
 * `contracts/openapi.json`. The point being proven here is that a body the
 * published contract calls invalid is rejected with a 400 *before* the service
 * runs — previously these checks lived in the service and only some of them
 * existed at all.
 *
 * The companion role-isolation behaviour of createProfileHandler is covered in
 * `handler-factories.profile.test.ts` and is deliberately not repeated here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { UpdateManagerProfileBody, z } from '@daltime/contracts';

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class MockCognitoClient {},
}));

import { parseWithContract } from '../../../src/functions/shared/contract-validation.js';
import { ValidationError } from '../../../src/functions/shared/errors.js';
import { createProfileHandler } from '../../../src/functions/shared/handler-factories.js';

// ─── parseWithContract ────────────────────────────────────────────────────────

describe('parseWithContract', () => {
  const schema = z.object({ name: z.string().min(2), age: z.int().nonnegative() });

  it('returns the parsed value when the input satisfies the schema', () => {
    expect(parseWithContract(schema, { name: 'Ada', age: 36 })).toEqual({ name: 'Ada', age: 36 });
  });

  it('throws ValidationError so mapHandlerError renders it as a 400', () => {
    expect(() => parseWithContract(schema, { name: 'A', age: 36 })).toThrow(ValidationError);
  });

  it('names the offending field in the message', () => {
    expect(() => parseWithContract(schema, { name: 'A', age: 36 })).toThrow(/name/);
  });

  it('reports every failing field rather than only the first', () => {
    try {
      parseWithContract(schema, { name: 'A', age: -1 });
      expect.unreachable('expected a ValidationError');
    } catch (err) {
      expect((err as ValidationError).message).toMatch(/name/);
      expect((err as ValidationError).message).toMatch(/age/);
    }
  });
});

// ─── UpdateManagerProfileBody — the contract schema itself ────────────────────

describe('UpdateManagerProfileBody', () => {
  it('accepts a partial update of a single field', () => {
    expect(parseWithContract(UpdateManagerProfileBody, { first_name: 'Morgan' })).toEqual({
      first_name: 'Morgan',
    });
  });

  it('trims surrounding whitespace so the service stores a clean value', () => {
    expect(parseWithContract(UpdateManagerProfileBody, { first_name: '  Morgan  ' })).toEqual({
      first_name: 'Morgan',
    });
  });

  it('rejects an empty object — at least one field must be provided', () => {
    expect(() => parseWithContract(UpdateManagerProfileBody, {})).toThrow(
      /at least one field must be provided/i,
    );
  });

  it('rejects a whitespace-only name, which would otherwise blank the profile', () => {
    expect(() => parseWithContract(UpdateManagerProfileBody, { first_name: '   ' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a non-string field', () => {
    expect(() => parseWithContract(UpdateManagerProfileBody, { first_name: 42 })).toThrow(
      ValidationError,
    );
  });

  it('accepts an empty phone, which clears the field', () => {
    expect(parseWithContract(UpdateManagerProfileBody, { phone: '' })).toEqual({ phone: '' });
  });
});

// ─── createProfileHandler with a contract schema ─────────────────────────────

function buildPutEvent(body: string | undefined): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    rawPath: '/manager/profile',
    headers: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'mgr-sub-1', 'cognito:groups': 'Manager' } } },
      http: { method: 'PUT', path: '/manager/profile' },
    },
    isBase64Encoded: false,
    body: body ?? null,
    pathParameters: {},
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const mockService = { getProfile: vi.fn(), updateProfile: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('createProfileHandler — contract-validated PUT body', () => {
  const handler = createProfileHandler(
    mockService,
    'manager profile handler',
    'Manager',
    UpdateManagerProfileBody,
  );

  it('passes a valid body through to the service', async () => {
    mockService.updateProfile.mockResolvedValue({ first_name: 'Morgan' });

    const result = (await handler(
      buildPutEvent(JSON.stringify({ first_name: 'Morgan' })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(mockService.updateProfile).toHaveBeenCalledWith('mgr-sub-1', { first_name: 'Morgan' });
  });

  it('hands the service the trimmed value, not the raw input', async () => {
    mockService.updateProfile.mockResolvedValue({ first_name: 'Morgan' });

    await handler(buildPutEvent(JSON.stringify({ first_name: '  Morgan  ' })));

    expect(mockService.updateProfile).toHaveBeenCalledWith('mgr-sub-1', { first_name: 'Morgan' });
  });

  it('rejects an empty body object with 400 before reaching the service', async () => {
    const result = (await handler(
      buildPutEvent(JSON.stringify({})),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(mockService.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects a blank first_name with 400 before reaching the service', async () => {
    const result = (await handler(
      buildPutEvent(JSON.stringify({ first_name: '  ' })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(mockService.updateProfile).not.toHaveBeenCalled();
  });

  // Unknown keys are stripped rather than rejected — Zod's default, and what the
  // generated spec advertises (the input schema carries no additionalProperties:
  // false, unlike the response schema). The security-relevant property is not
  // that the request 400s, but that a field the contract does not define can
  // never reach the update expression: `employee_count` is a counter owned by
  // the employees Lambda and must not be settable by the profile route.
  it('strips an unknown field so it cannot reach DynamoDB', async () => {
    mockService.updateProfile.mockResolvedValue({ first_name: 'Morgan' });

    const result = (await handler(
      buildPutEvent(JSON.stringify({ first_name: 'Morgan', employee_count: 9999 })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(mockService.updateProfile).toHaveBeenCalledWith('mgr-sub-1', { first_name: 'Morgan' });
  });

  it('returns the failure reason in the { error } envelope the frontend reads', async () => {
    const result = (await handler(
      buildPutEvent(JSON.stringify({})),
    )) as APIGatewayProxyStructuredResultV2;

    const parsed = JSON.parse(result.body as string) as { error: string };
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });
});
