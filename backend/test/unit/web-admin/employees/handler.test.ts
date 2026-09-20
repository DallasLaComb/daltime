import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { ForbiddenError } from '../../../../src/functions/shared/errors.js';

vi.mock('../../../../src/functions/web-admin/employees/service.js', () => ({
  listEmployees: vi.fn(),
}));

// Mock requireWebAdminWithLookup so handler tests don't need a live DynamoDB.
// Default resolves to an ACTIVE WebAdmin caller; individual tests override as needed.
vi.mock('../../../../src/functions/shared/auth.js', () => ({
  requireWebAdminWithLookup: vi.fn(),
  setRequestOrigin: vi.fn(),
}));

import { handler } from '../../../../src/functions/web-admin/employees/handler.js';
import { listEmployees } from '../../../../src/functions/web-admin/employees/service.js';
import { requireWebAdminWithLookup } from '../../../../src/functions/shared/auth.js';

// ─── Factories ────────────────────────────────────────────────────────────────

const mockCaller = {
  sub: 'web-admin-sub',
  web_admin_id: 'WADMIN#uuid-1',
  email: 'admin@example.com',
  status: 'ACTIVE' as const,
};

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & { method?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  const routeKey = overrides.routeKey ?? `${method} /web-admin/employees`;
  return {
    version: '2.0',
    routeKey,
    rawPath: '/web-admin/employees',
    rawQueryString: '',
    headers: { authorization: 'Bearer test-token' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: { claims: { 'cognito:groups': 'WebAdmin', sub: 'web-admin-sub' }, scopes: null },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/web-admin/employees',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-id',
      routeKey,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: null,
    pathParameters: {},
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const sampleEmployee = {
  employee_id: 'emp-1',
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '+1-555-0000',
  org_id: 'org-1',
  org_name: 'Acme Corp',
  status: 'CONFIRMED' as const,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('web-admin/employees handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: caller is an active WebAdmin.
    vi.mocked(requireWebAdminWithLookup).mockResolvedValue(mockCaller);
  });

  // ── OPTIONS ──────────────────────────────────────────────────────────────

  describe('OPTIONS /web-admin/employees', () => {
    it('returns 200 for preflight and skips auth guard', async () => {
      const res = await handler(buildApiGwEvent({ method: 'OPTIONS' }));
      expect(res.statusCode).toBe(200);
      // OPTIONS short-circuits before requireWebAdminWithLookup.
      expect(requireWebAdminWithLookup).not.toHaveBeenCalled();
    });
  });

  // ── GET /web-admin/employees ──────────────────────────────────────────────

  describe('GET /web-admin/employees', () => {
    it('returns 200 with employee list on success', async () => {
      vi.mocked(listEmployees).mockResolvedValue([sampleEmployee]);

      const res = await handler(buildApiGwEvent({ method: 'GET' }));

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual([sampleEmployee]);
      expect(listEmployees).toHaveBeenCalledOnce();
    });

    it('returns 200 with empty array when no employees exist', async () => {
      vi.mocked(listEmployees).mockResolvedValue([]);

      const res = await handler(buildApiGwEvent({ method: 'GET' }));

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual([]);
    });

    it('returns 500 when listEmployees throws', async () => {
      vi.mocked(listEmployees).mockRejectedValue(new Error('DynamoDB failure'));

      const res = await handler(buildApiGwEvent({ method: 'GET' }));

      expect(res.statusCode).toBe(500);
    });
  });

  // ── Authorization: data-driven WebAdmin gate ──────────────────────────────

  describe('authorization', () => {
    it('(a) returns 403 when the caller is not in the WebAdmin group', async () => {
      vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin role required'));
      const res = await handler(buildApiGwEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(403);
      expect(listEmployees).not.toHaveBeenCalled();
    });

    it('(b) returns 403 when the caller is in the group but has no DynamoDB record', async () => {
      vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin record not found'));
      const res = await handler(buildApiGwEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'WebAdmin record not found' });
      expect(listEmployees).not.toHaveBeenCalled();
    });

    it('(c) returns 403 when the caller has a DynamoDB record but is DISABLED', async () => {
      vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin account is disabled'));
      const res = await handler(buildApiGwEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body as string)).toEqual({ error: 'WebAdmin account is disabled' });
      expect(listEmployees).not.toHaveBeenCalled();
    });

    it('(d) happy path — proceeds to business logic when ACTIVE record found', async () => {
      vi.mocked(listEmployees).mockResolvedValue([sampleEmployee]);
      const res = await handler(buildApiGwEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(200);
      expect(listEmployees).toHaveBeenCalledOnce();
    });

    it('returns 403 when the caller has no group claim at all', async () => {
      vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin role required'));
      const res = await handler(buildApiGwEvent({ method: 'GET' }));
      expect(res.statusCode).toBe(403);
    });
  });
});
