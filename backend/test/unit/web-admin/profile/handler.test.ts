/**
 * Unit tests for GET /web-admin/profile and PUT /web-admin/profile.
 *
 * Auth is tested through `requireWebAdminWithLookup` — the mock lets us simulate
 * all three rejection modes (not in group, no DynamoDB record, DISABLED record)
 * without a live Cognito or DynamoDB connection.
 *
 * Service functions are mocked at the module boundary so the handler's routing,
 * body parsing, and error-mapping logic can be tested in isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { UpdateWebAdminProfileBody } from '@daltime/contracts';
import { ForbiddenError } from '../../../../src/functions/shared/errors.js';
import { contractErrorMessage } from '../../helpers/contract-error.js';

// Mock CognitoIdentityProviderClient — handler instantiates it at module load time.
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class MockCognitoClient {},
}));

// Mock the service layer so tests never touch DynamoDB or Cognito AdminGetUser.
vi.mock('../../../../src/functions/web-admin/profile/service.js', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
}));

// Mock requireWebAdminWithLookup — default resolves to an ACTIVE WebAdmin caller.
vi.mock('../../../../src/functions/shared/auth.js', () => ({
  requireWebAdminWithLookup: vi.fn(),
}));

import { handler } from '../../../../src/functions/web-admin/profile/handler.js';
import { getProfile, updateProfile } from '../../../../src/functions/web-admin/profile/service.js';
import { requireWebAdminWithLookup } from '../../../../src/functions/shared/auth.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockCaller = {
  sub: 'web-admin-sub-abc123',
  web_admin_id: 'WADMIN#uuid-fixture',
  email: 'wadmin@example.com',
  status: 'ACTIVE' as const,
};

const mockProfile = {
  web_admin_id: 'WADMIN#uuid-fixture',
  sub: 'web-admin-sub-abc123',
  email: 'wadmin@example.com',
  first_name: 'Alice',
  last_name: 'Smith',
  entity_type: 'WEB_ADMIN' as const,
  status: 'CONFIRMED',
  created_at: '2025-01-01T00:00:00.000Z',
};

// ─── Event factory ────────────────────────────────────────────────────────────

function buildEvent(
  method: string,
  body?: string,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: `${method} /web-admin/profile`,
    rawPath: '/web-admin/profile',
    rawQueryString: '',
    headers: {
      authorization: 'Bearer test-token',
      origin: 'http://localhost:4200',
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: {
          claims: { sub: 'web-admin-sub-abc123', 'cognito:groups': 'WebAdmin' },
          scopes: null,
        },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/web-admin/profile',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-request-id',
      routeKey: `${method} /web-admin/profile`,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: body ?? null,
    pathParameters: undefined,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

/** Parse the response body from the handler result. */
function body(result: APIGatewayProxyStructuredResultV2): unknown {
  return JSON.parse(result.body as string);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: auth guard passes and returns an ACTIVE WebAdmin caller.
  vi.mocked(requireWebAdminWithLookup).mockResolvedValue(mockCaller);
});

// ─── Authorization — three rejection modes ────────────────────────────────────

describe('Authorization — WebAdmin gate (requireWebAdminWithLookup)', () => {
  it('(a) returns 403 when caller is not in the WebAdmin Cognito group', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin role required'),
    );
    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'WebAdmin role required' });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('(b) returns 403 when caller is in the group but has no DynamoDB record', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin record not found'),
    );
    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'WebAdmin record not found' });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('(c) returns 403 when caller has a DynamoDB record but is DISABLED', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin account is disabled'),
    );
    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'WebAdmin account is disabled' });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('(d) PUT also returns 403 when auth guard rejects', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin role required'),
    );
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ first_name: 'Alice' })),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

// ─── OPTIONS preflight ────────────────────────────────────────────────────────

describe('OPTIONS /web-admin/profile — CORS preflight', () => {
  it('returns 200 without calling the auth guard or service', async () => {
    const result = (await handler(buildEvent('OPTIONS'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    // OPTIONS must short-circuit before auth so preflight requests are never
    // blocked by the WebAdmin gate.
    expect(requireWebAdminWithLookup).not.toHaveBeenCalled();
    expect(getProfile).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

// ─── GET /web-admin/profile ───────────────────────────────────────────────────

describe('GET /web-admin/profile — success', () => {
  it('returns 200 with the caller profile', async () => {
    vi.mocked(getProfile).mockResolvedValue(mockProfile);
    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(mockProfile);
    // Verify the caller's sub is threaded through to the service, not a
    // client-supplied value — this is the key isolation guarantee.
    expect(getProfile).toHaveBeenCalledWith(mockCaller.sub, expect.anything());
  });

  it('returns 500 when service.getProfile throws an unexpected error', async () => {
    vi.mocked(getProfile).mockRejectedValue(new Error('DynamoDB transient failure'));
    const result = (await handler(buildEvent('GET'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── PUT /web-admin/profile — success cases ───────────────────────────────────

describe('PUT /web-admin/profile — success', () => {
  it('returns 200 with updated profile when both fields are provided', async () => {
    const updated = { ...mockProfile, first_name: 'Bob', last_name: 'Jones' };
    vi.mocked(updateProfile).mockResolvedValue(updated);
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ first_name: 'Bob', last_name: 'Jones' })),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(updated);
    expect(updateProfile).toHaveBeenCalledWith(mockCaller.sub, {
      first_name: 'Bob',
      last_name: 'Jones',
    });
  });

  it('returns 200 when only first_name is provided', async () => {
    const updated = { ...mockProfile, first_name: 'Bob' };
    vi.mocked(updateProfile).mockResolvedValue(updated);
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ first_name: 'Bob' })),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith(mockCaller.sub, { first_name: 'Bob' });
  });

  it('returns 200 when only last_name is provided', async () => {
    const updated = { ...mockProfile, last_name: 'Jones' };
    vi.mocked(updateProfile).mockResolvedValue(updated);
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ last_name: 'Jones' })),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith(mockCaller.sub, { last_name: 'Jones' });
  });
});

// ─── PUT /web-admin/profile — validation failures ────────────────────────────

describe('PUT /web-admin/profile — validation', () => {
  it('returns 400 when body is missing entirely', async () => {
    const result = (await handler(buildEvent('PUT'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    // Service must never be called — body parse failure is caught before
    // the service layer is invoked.
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = (await handler(
      buildEvent('PUT', '{bad json'),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('returns 400 when the contract rejects an empty body (no fields provided)', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({})),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(body(result)).toEqual({
      error: contractErrorMessage(UpdateWebAdminProfileBody, {}),
    });
  });

  it('returns 400 when the contract rejects an empty first_name string', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ first_name: '   ' })),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(body(result)).toEqual({
      error: contractErrorMessage(UpdateWebAdminProfileBody, { first_name: '   ' }),
    });
  });

  it('returns 400 when the contract rejects an empty last_name string', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ last_name: '' })),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(updateProfile).not.toHaveBeenCalled();
    expect(body(result)).toEqual({
      error: contractErrorMessage(UpdateWebAdminProfileBody, { last_name: '' }),
    });
  });
});

// ─── Unhandled method ─────────────────────────────────────────────────────────

describe('Unhandled methods', () => {
  it('returns 400 for PATCH (not a supported method)', async () => {
    const result = (await handler(buildEvent('PATCH'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for DELETE (not a supported method)', async () => {
    const result = (await handler(buildEvent('DELETE'))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
  });
});
