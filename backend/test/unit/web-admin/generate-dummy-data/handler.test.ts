/**
 * Unit tests for handler.ts — POST /web-admin/generate-dummy-data
 *
 * Covers:
 *   - OPTIONS CORS preflight
 *   - Non-POST method → 405 Method Not Allowed
 *   - WebAdmin auth gate: missing/wrong role → 403
 *   - Body validation errors → 400
 *   - Happy path → 200 with message
 *   - Unexpected service errors → 500
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ForbiddenError } from '../../../../src/functions/shared/errors.js';

// ─── Mocks (must be declared before dynamic imports) ─────────────────────────

vi.mock('../../../../src/functions/web-admin/generate-dummy-data/service.js', () => ({
  generateDummyData: vi.fn(),
}));

vi.mock('../../../../src/functions/shared/auth.js', () => ({
  requireWebAdminWithLookup: vi.fn(),
  setRequestOrigin: vi.fn(),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────────

import { handler } from '../../../../src/functions/web-admin/generate-dummy-data/handler.js';
import { generateDummyData } from '../../../../src/functions/web-admin/generate-dummy-data/service.js';
import { requireWebAdminWithLookup } from '../../../../src/functions/shared/auth.js';

// ─── Factories ────────────────────────────────────────────────────────────────

const mockCaller = {
  sub: 'web-admin-sub-uuid',
  web_admin_id: 'WADMIN#uuid-1',
  email: 'webadmin@example.com',
  status: 'ACTIVE' as const,
};

function buildEvent(
  method: string,
  body: string | null = null,
  extraHeaders: Record<string, string> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: `${method} /web-admin/generate-dummy-data`,
    rawPath: '/web-admin/generate-dummy-data',
    rawQueryString: '',
    headers: {
      authorization: 'Bearer test-jwt-token',
      'content-type': 'application/json',
      ...extraHeaders,
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: {
          claims: { 'cognito:groups': 'WebAdmin', sub: 'web-admin-sub-uuid' },
          scopes: null,
        },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/web-admin/generate-dummy-data',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test-agent',
      },
      requestId: 'test-request-id',
      routeKey: `${method} /web-admin/generate-dummy-data`,
      stage: '$default',
      time: '01/Jan/2026:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    body,
    isBase64Encoded: false,
    pathParameters: undefined,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function parseBody(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body as string);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireWebAdminWithLookup).mockResolvedValue(mockCaller);
});

// ─── OPTIONS — CORS preflight ─────────────────────────────────────────────────

describe('OPTIONS /web-admin/generate-dummy-data — CORS preflight', () => {
  it('returns 200 with CORS headers before auth check', async () => {
    const event = buildEvent('OPTIONS');
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    // OPTIONS must short-circuit before auth — requireWebAdminWithLookup must NOT be called
    expect(requireWebAdminWithLookup).not.toHaveBeenCalled();
    expect(generateDummyData).not.toHaveBeenCalled();
    // CORS headers present
    expect(result.headers?.['Access-Control-Allow-Origin']).toBeDefined();
    expect(result.headers?.['Access-Control-Allow-Methods']).toBeDefined();
  });
});

// ─── Non-POST methods ─────────────────────────────────────────────────────────

describe('Non-POST methods', () => {
  it.each(['GET', 'PUT', 'DELETE', 'PATCH'] as const)(
    '%s returns 405 Method Not Allowed',
    async (method) => {
      const event = buildEvent(method);
      const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

      expect(result.statusCode).toBe(405);
      expect(parseBody(result)).toEqual({ error: `Method Not Allowed: ${method}` });
      // Auth still runs (non-OPTIONS methods go through auth)
      expect(requireWebAdminWithLookup).toHaveBeenCalledOnce();
    },
  );
});

// ─── Authorization gate ───────────────────────────────────────────────────────

describe('Authorization — WebAdmin gate', () => {
  it('returns 403 when caller is not in the WebAdmin Cognito group', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin role required'),
    );

    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(parseBody(result)).toEqual({ error: 'WebAdmin role required' });
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is in group but has no DynamoDB WebAdmin record', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin record not found'),
    );

    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(parseBody(result)).toEqual({ error: 'WebAdmin record not found' });
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 403 when caller DynamoDB record exists but is DISABLED', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin account is disabled'),
    );

    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(parseBody(result)).toEqual({ error: 'WebAdmin account is disabled' });
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('does not call generateDummyData before the auth check resolves', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(
      new ForbiddenError('WebAdmin role required'),
    );

    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 6 }));
    await handler(event);

    expect(generateDummyData).not.toHaveBeenCalled();
  });
});

// ─── Input validation — 400 errors ───────────────────────────────────────────

describe('POST — input validation (400)', () => {
  it('returns 400 when body is missing entirely', async () => {
    const event = buildEvent('POST', null);
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = buildEvent('POST', '{not-valid-json}');
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when body is missing year', async () => {
    const event = buildEvent('POST', JSON.stringify({ month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/year/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 when body is missing month', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: 2026 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/month/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 for month: 0 (below 1)', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 0 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/month/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 for month: 13 (above 12)', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 13 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/month/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 for month as a string "january"', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 'january' }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/month/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 for year below 2020', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: 2019, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/year/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 for year above 2030', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: 2031, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/year/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 for year as a string', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: '2026', month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/year/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });

  it('returns 400 for float year (non-integer)', async () => {
    const event = buildEvent('POST', JSON.stringify({ year: 2026.5, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toMatch(/year/i);
    expect(generateDummyData).not.toHaveBeenCalled();
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('POST — happy path (200)', () => {
  it('returns 200 with message from service on valid input', async () => {
    const expectedMessage =
      'Generated dummy data for 6/2026: 5 availability records and 8 open shifts across 1 org(s)';
    vi.mocked(generateDummyData).mockResolvedValue(expectedMessage);

    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parseBody(result)).toEqual({ message: expectedMessage });
    expect(generateDummyData).toHaveBeenCalledOnce();
    expect(generateDummyData).toHaveBeenCalledWith({ year: 2026, month: 6 });
  });

  it('strips extra unknown fields before calling generateDummyData', async () => {
    vi.mocked(generateDummyData).mockResolvedValue('Generated dummy data for 1/2025: 0 records');

    const body = { year: 2025, month: 1, unknownField: 'should be ignored' };
    const event = buildEvent('POST', JSON.stringify(body));
    await handler(event);

    // The contract schema strips unknown keys, so the service only ever sees the declared fields.
    expect(generateDummyData).toHaveBeenCalledWith({ year: 2025, month: 1 });
  });

  it('returns 200 with CORS headers on success', async () => {
    vi.mocked(generateDummyData).mockResolvedValue('Generated dummy data for 12/2020: 0 records');

    const event = buildEvent('POST', JSON.stringify({ year: 2020, month: 12 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBeDefined();
  });
});

// ─── Service errors → 500 ─────────────────────────────────────────────────────

describe('POST — unexpected service errors (500)', () => {
  it('returns 500 when generateDummyData throws an unexpected error', async () => {
    vi.mocked(generateDummyData).mockRejectedValue(new Error('DynamoDB unavailable'));

    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
    expect(parseBody(result)).toEqual({ error: 'An unexpected error occurred' });
  });

  it('returns 500 when BatchWriteItem fails after retries', async () => {
    vi.mocked(generateDummyData).mockRejectedValue(
      new Error('BatchWriteItem: 3 items remain unprocessed after 5 retries'),
    );

    const event = buildEvent('POST', JSON.stringify({ year: 2026, month: 6 }));
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
    expect(parseBody(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});
