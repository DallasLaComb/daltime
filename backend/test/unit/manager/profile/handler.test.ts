/**
 * Unit tests for the manager profile handler.
 *
 * These tests exercise the full handler exported from
 * `manager/profile/handler.ts` (which calls createProfileHandler with
 * requiredGroup='Manager') by mocking out the service and Cognito client.
 *
 * The deeper role-isolation correctness is unit-tested exhaustively in
 * `shared/handler-factories.profile.test.ts`. This file focuses on the
 * contract from the manager handler's perspective: correct 200 on the happy
 * path, correct 403 for an Employee caller (the regression case this fix
 * targets — previously a Manager JWT on the employee route got a 404 instead
 * of a 403), and correct 403 for no group claim.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

// Mock the service so no DynamoDB calls are made.
vi.mock('../../../../src/functions/manager/profile/service.js', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

// Mock Cognito client — createProfileHandler instantiates it at module load time.
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class MockCognitoClient {},
}));

import { handler } from '../../../../src/functions/manager/profile/handler.js';
import {
  getProfile,
  updateProfile,
} from '../../../../src/functions/manager/profile/service.js';
import { NotFoundError } from '../../../../src/functions/shared/errors.js';

// ─── Randomized sub pool ──────────────────────────────────────────────────────

const SUB_POOL = [
  'mgr-sub-aaa',
  '00000000-aaaa-bbbb-cccc-000000000002',
  'mgr-sub-with-unicode',
  'mgr-sub-zzz',
];

let subPoolIndex = 0;
function nextSub(): string {
  return SUB_POOL[subPoolIndex++ % SUB_POOL.length];
}

// ─── Event factory ────────────────────────────────────────────────────────────

function buildEvent(
  method: string,
  groups: string | string[] | undefined,
  sub: string,
  body?: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const claims: Record<string, unknown> = { sub };
  if (groups !== undefined) claims['cognito:groups'] = groups;

  return {
    version: '2.0',
    routeKey: `${method} /manager/profile`,
    rawPath: '/manager/profile',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: { claims, scopes: null },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/manager/profile',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'test-req-id',
      routeKey: `${method} /manager/profile`,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: body ?? null,
    pathParameters: {},
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function parsedBody(result: APIGatewayProxyStructuredResultV2): unknown {
  return JSON.parse(result.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  subPoolIndex = 0;
});

// ─── OPTIONS ──────────────────────────────────────────────────────────────────

describe('OPTIONS — CORS preflight', () => {
  it('returns 200 without calling the service', async () => {
    const result = (await handler(
      buildEvent('OPTIONS', 'Manager', nextSub()),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(getProfile).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

// ─── GET /manager/profile — happy path ────────────────────────────────────────

describe('GET /manager/profile — Manager caller', () => {
  const mockProfile = {
    manager_id: 'mgr-sub-aaa',
    first_name: 'Morgan',
    last_name: 'Manager',
    email: 'morgan.manager@sunsetcafe.dev',
    phone: '555-0002',
    org_id: 'org-sunset',
    status: 'CONFIRMED',
  };

  it('returns 200 with the profile when the caller is a Manager', async () => {
    const sub = nextSub();
    vi.mocked(getProfile).mockResolvedValue(mockProfile);

    const result = (await handler(
      buildEvent('GET', 'Manager', sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(200);
    expect(parsedBody(result), `sub=${sub}`).toEqual(mockProfile);
    expect(getProfile).toHaveBeenCalled();
  });

  it('returns 200 with bracket-stringified [Manager] group claim (HTTP API JWT authorizer prod shape)', async () => {
    const sub = nextSub();
    vi.mocked(getProfile).mockResolvedValue(mockProfile);

    const result = (await handler(
      buildEvent('GET', '[Manager]', sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(200);
  });

  it('returns 404 when the service signals the profile does not exist', async () => {
    const sub = nextSub();
    vi.mocked(getProfile).mockRejectedValue(new NotFoundError(`Manager '${sub}' not found`));

    const result = (await handler(
      buildEvent('GET', 'Manager', sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(404);
  });

  it('returns 500 when the service throws an unexpected error', async () => {
    const sub = nextSub();
    vi.mocked(getProfile).mockRejectedValue(new Error('DynamoDB transient error'));

    const result = (await handler(
      buildEvent('GET', 'Manager', sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(500);
  });
});

// ─── GET /manager/profile — role isolation (adversarial) ──────────────────────

describe('GET /manager/profile — role isolation: non-Manager callers must be rejected', () => {
  // This is the primary regression test for the bug fixed in this story.
  // Previously, GET /employee/profile with a Manager JWT returned 404 because
  // there was no group check before the DynamoDB lookup. The fix adds
  // requiredGroup to createProfileHandler. This test mirrors the scenario
  // from the manager handler's side: an Employee must be rejected with 403,
  // not reach DynamoDB at all.
  it('returns 403 when the caller is in the Employee group (regression: must not return 404)', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('GET', 'Employee', sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(403);
    // The service must never be called — the guard short-circuits before DynamoDB.
    expect(getProfile, `sub=${sub}`).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has a bracket-stringified [Employee] group claim', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('GET', '[Employee]', sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(403);
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller is in the WebAdmin group', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('GET', 'WebAdmin', sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(403);
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no group claim (unauthenticated / malformed token)', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('GET', undefined, sub),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(403);
    expect(getProfile).not.toHaveBeenCalled();
  });
});

// ─── PUT /manager/profile — happy path ────────────────────────────────────────

describe('PUT /manager/profile — Manager caller', () => {
  it('returns 200 with the updated profile', async () => {
    const sub = nextSub();
    const updated = { first_name: 'Morgana', last_name: 'Manager' };
    vi.mocked(updateProfile).mockResolvedValue(updated as Awaited<ReturnType<typeof updateProfile>>);

    const result = (await handler(
      buildEvent('PUT', 'Manager', sub, JSON.stringify({ first_name: 'Morgana' })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(200);
    expect(parsedBody(result), `sub=${sub}`).toEqual(updated);
  });

  it('returns 400 when body is absent', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('PUT', 'Manager', sub, undefined),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not valid JSON', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('PUT', 'Manager', sub, '{bad json'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

// ─── PUT /manager/profile — role isolation (adversarial) ──────────────────────

describe('PUT /manager/profile — role isolation: non-Manager callers must be rejected', () => {
  it('returns 403 when the caller is in the Employee group', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('PUT', 'Employee', sub, JSON.stringify({ first_name: 'Hacker' })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(403);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no group claim', async () => {
    const sub = nextSub();

    const result = (await handler(
      buildEvent('PUT', undefined, sub, JSON.stringify({ first_name: 'Hacker' })),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode, `sub=${sub}`).toBe(403);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});
