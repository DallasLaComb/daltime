import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ForbiddenError } from '../../../../src/functions/shared/errors.js';

// Mock the service module before importing the handler
vi.mock('../../../../src/functions/web-admin/organizations/service.js', () => ({
  listOrganizations: vi.fn(),
  getOrganization: vi.fn(),
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  deleteOrganization: vi.fn(),
}));

// Mock requireWebAdminWithLookup so handler tests don't need a live DynamoDB.
// Default resolves to an ACTIVE WebAdmin caller; individual tests override as needed.
vi.mock('../../../../src/functions/shared/auth.js', () => ({
  requireWebAdminWithLookup: vi.fn(),
  setRequestOrigin: vi.fn(),
}));

import { CreateOrganizationBody } from '@daltime/contracts';
import { contractErrorMessage } from '../../helpers/contract-error.js';
import { handler } from '../../../../src/functions/web-admin/organizations/handler.js';
import {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from '../../../../src/functions/web-admin/organizations/service.js';
import { requireWebAdminWithLookup } from '../../../../src/functions/shared/auth.js';

// ─── Factories ────────────────────────────────────────────────────────────────

const mockCaller = {
  sub: 'web-admin-sub',
  web_admin_id: 'WADMIN#uuid-1',
  email: 'admin@example.com',
  status: 'ACTIVE' as const,
};

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & {
    method?: string;
    routeKey?: string;
  } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  return {
    version: '2.0',
    routeKey: overrides.routeKey ?? `${method} /organizations`,
    rawPath: '/organizations',
    rawQueryString: '',
    headers: { authorization: 'Bearer test-token' },
    requestContext: {
      accountId: '123456789',
      apiId: 'test-api',
      authorizer: {
        jwt: {
          claims: { 'cognito:groups': 'WebAdmin', sub: 'web-admin-sub' },
          scopes: null,
        },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/organizations',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'test',
      },
      requestId: 'test-request-id',
      routeKey: overrides.routeKey ?? `${method} /organizations`,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: null,
    pathParameters: undefined,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const mockOrg = {
  org_id: 'org-123',
  name: 'Acme Corp',
  address: '123 Main St',
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  org_admin_count: 0,
};

function body(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body as string);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller is an active WebAdmin.
  vi.mocked(requireWebAdminWithLookup).mockResolvedValue(mockCaller);
});

// ─── Authorization: data-driven WebAdmin gate ─────────────────────────────────

describe('Authorization — data-driven WebAdmin gate', () => {
  it('(a) returns 403 when the caller is not in the WebAdmin group', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin role required'));
    const result = (await handler(buildApiGwEvent({ method: 'GET' }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(listOrganizations).not.toHaveBeenCalled();
  });

  it('(b) returns 403 when the caller is in the group but has no DynamoDB record', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin record not found'));
    const result = (await handler(buildApiGwEvent({ method: 'GET' }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'WebAdmin record not found' });
    expect(listOrganizations).not.toHaveBeenCalled();
  });

  it('(c) returns 403 when the caller has a DynamoDB record but is DISABLED', async () => {
    vi.mocked(requireWebAdminWithLookup).mockRejectedValue(new ForbiddenError('WebAdmin account is disabled'));
    const result = (await handler(buildApiGwEvent({ method: 'GET' }))) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'WebAdmin account is disabled' });
    expect(listOrganizations).not.toHaveBeenCalled();
  });
});

// ─── OPTIONS ─────────────────────────────────────────────────────────────────

describe('OPTIONS /organizations — CORS preflight', () => {
  it('returns 200 with empty body', async () => {
    const event = buildApiGwEvent({ method: 'OPTIONS', routeKey: 'OPTIONS /organizations' });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    // OPTIONS short-circuits before the auth guard, so no DynamoDB call.
    expect(requireWebAdminWithLookup).not.toHaveBeenCalled();
  });
});

// ─── GET /organizations — list ────────────────────────────────────────────────

describe('GET /organizations — list', () => {
  it('returns 200 with array of organizations', async () => {
    vi.mocked(listOrganizations).mockResolvedValue([mockOrg]);
    const event = buildApiGwEvent({ method: 'GET', routeKey: 'GET /organizations' });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([mockOrg]);
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(listOrganizations).mockRejectedValue(new Error('DynamoDB unavailable'));
    const event = buildApiGwEvent({ method: 'GET', routeKey: 'GET /organizations' });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── POST /organizations — create ─────────────────────────────────────────────

describe('POST /organizations — create', () => {
  it('returns 201 with created organization, passing webAdminId to service', async () => {
    vi.mocked(createOrganization).mockResolvedValue(mockOrg);
    const event = buildApiGwEvent({
      method: 'POST',
      routeKey: 'POST /organizations',
      body: JSON.stringify({ name: 'Acme Corp', address: '123 Main St' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    expect(body(result)).toEqual(mockOrg);
    // Verify web_admin_id is threaded through to the service call.
    expect(createOrganization).toHaveBeenCalledWith(
      { name: 'Acme Corp', address: '123 Main St' },
      'WADMIN#uuid-1',
    );
  });

  it('returns 400 when body is missing', async () => {
    const event = buildApiGwEvent({ method: 'POST', routeKey: 'POST /organizations' });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const event = buildApiGwEvent({
      method: 'POST',
      routeKey: 'POST /organizations',
      body: '{not-valid-json',
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when the contract rejects a missing name', async () => {
    const event = buildApiGwEvent({
      method: 'POST',
      routeKey: 'POST /organizations',
      body: JSON.stringify({ address: '123 Main St' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(createOrganization).not.toHaveBeenCalled();
    expect(body(result)).toEqual({
      error: contractErrorMessage(CreateOrganizationBody, { address: '123 Main St' }),
    });
  });

  it('returns 400 when the contract rejects a missing address', async () => {
    const event = buildApiGwEvent({
      method: 'POST',
      routeKey: 'POST /organizations',
      body: JSON.stringify({ name: 'Acme Corp' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(createOrganization).not.toHaveBeenCalled();
    expect(body(result)).toEqual({
      error: contractErrorMessage(CreateOrganizationBody, { name: 'Acme Corp' }),
    });
  });

  it('returns 500 when service throws an unexpected error', async () => {
    vi.mocked(createOrganization).mockRejectedValue(new Error('DynamoDB unavailable'));
    const event = buildApiGwEvent({
      method: 'POST',
      routeKey: 'POST /organizations',
      body: JSON.stringify({ name: 'Acme Corp', address: '123 Main St' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── GET /organizations/{orgId} — get by ID ───────────────────────────────────

describe('GET /organizations/{orgId} — get by ID', () => {
  it('returns 200 with the organization', async () => {
    vi.mocked(getOrganization).mockResolvedValue(mockOrg);
    const event = buildApiGwEvent({
      method: 'GET',
      routeKey: 'GET /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(mockOrg);
  });

  it('returns 404 when organization does not exist', async () => {
    vi.mocked(getOrganization).mockResolvedValue(null);
    const event = buildApiGwEvent({
      method: 'GET',
      routeKey: 'GET /organizations/{orgId}',
      pathParameters: { orgId: 'unknown-id' },
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Organization 'unknown-id' not found" });
  });

  it('routes to list when orgId path param is missing', async () => {
    vi.mocked(listOrganizations).mockResolvedValue([]);
    const event = buildApiGwEvent({
      method: 'GET',
      routeKey: 'GET /organizations/{orgId}',
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([]);
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(getOrganization).mockRejectedValue(new Error('DynamoDB unavailable'));
    const event = buildApiGwEvent({
      method: 'GET',
      routeKey: 'GET /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── PUT /organizations/{orgId} — update ──────────────────────────────────────

describe('PUT /organizations/{orgId} — update', () => {
  it('returns 200 with updated organization, passing webAdminId to service', async () => {
    const updated = { ...mockOrg, name: 'Updated Name' };
    vi.mocked(updateOrganization).mockResolvedValue(updated);
    const event = buildApiGwEvent({
      method: 'PUT',
      routeKey: 'PUT /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(updated);
    expect(updateOrganization).toHaveBeenCalledWith(
      'org-123',
      { name: 'Updated Name' },
      'WADMIN#uuid-1',
    );
  });

  it('returns 404 when organization does not exist', async () => {
    vi.mocked(updateOrganization).mockResolvedValue(null);
    const event = buildApiGwEvent({
      method: 'PUT',
      routeKey: 'PUT /organizations/{orgId}',
      pathParameters: { orgId: 'unknown-id' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Organization 'unknown-id' not found" });
  });

  it('returns 400 when body is missing', async () => {
    const event = buildApiGwEvent({
      method: 'PUT',
      routeKey: 'PUT /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const event = buildApiGwEvent({
      method: 'PUT',
      routeKey: 'PUT /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
      body: '{bad-json',
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when orgId path param is missing', async () => {
    const event = buildApiGwEvent({
      method: 'PUT',
      routeKey: 'PUT /organizations/{orgId}',
      body: JSON.stringify({ name: 'Updated' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result).error).toContain('Unhandled route');
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(updateOrganization).mockRejectedValue(new Error('DynamoDB unavailable'));
    const event = buildApiGwEvent({
      method: 'PUT',
      routeKey: 'PUT /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── Adversarial: spoofed modified_by_web_admin_id in request body ───────────
//
// The server must always stamp modified_by_web_admin_id from the resolved
// caller identity — never from a value supplied by the client in the body.

describe('POST /organizations — spoofed modified_by_web_admin_id in body', () => {
  it('ignores a client-supplied modified_by_web_admin_id and stamps from the resolved caller instead', async () => {
    vi.mocked(createOrganization).mockResolvedValue(mockOrg);
    const event = buildApiGwEvent({
      method: 'POST',
      routeKey: 'POST /organizations',
      // Client attempts to spoof the audit field with a different web-admin ID.
      body: JSON.stringify({
        name: 'Acme Corp',
        address: '123 Main St',
        modified_by_web_admin_id: 'WADMIN#spoofed-attacker-id',
      }),
    });
    await handler(event);
    // The service must have been called with the *resolved* caller web_admin_id,
    // not the attacker-supplied one. The body is passed as-is to the service, but
    // the service's webAdminId parameter is sourced from the auth layer.
    expect(createOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme Corp' }),
      'WADMIN#uuid-1', // the resolved caller's web_admin_id from requireWebAdminWithLookup
    );
    // The second argument must NOT equal the spoofed value.
    const calledWith = vi.mocked(createOrganization).mock.calls[0];
    expect(calledWith[1]).not.toBe('WADMIN#spoofed-attacker-id');
  });
});

describe('PUT /organizations/{orgId} — spoofed modified_by_web_admin_id in body', () => {
  it('ignores a client-supplied modified_by_web_admin_id and stamps from the resolved caller', async () => {
    vi.mocked(updateOrganization).mockResolvedValue(mockOrg);
    const event = buildApiGwEvent({
      method: 'PUT',
      routeKey: 'PUT /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
      body: JSON.stringify({
        name: 'Updated Name',
        modified_by_web_admin_id: 'WADMIN#spoofed-attacker-id',
      }),
    });
    await handler(event);
    expect(updateOrganization).toHaveBeenCalledWith(
      'org-123',
      expect.objectContaining({ name: 'Updated Name' }),
      'WADMIN#uuid-1',
    );
    const calledWith = vi.mocked(updateOrganization).mock.calls[0];
    expect(calledWith[2]).not.toBe('WADMIN#spoofed-attacker-id');
  });
});

// ─── DELETE /organizations/{orgId} — delete ───────────────────────────────────

describe('DELETE /organizations/{orgId} — delete', () => {
  it('returns 204 when organization is deleted, passing webAdminId to service', async () => {
    vi.mocked(deleteOrganization).mockResolvedValue(true);
    const event = buildApiGwEvent({
      method: 'DELETE',
      routeKey: 'DELETE /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(204);
    expect(deleteOrganization).toHaveBeenCalledWith('org-123', 'WADMIN#uuid-1');
  });

  it('returns 404 when organization does not exist', async () => {
    vi.mocked(deleteOrganization).mockResolvedValue(false);
    const event = buildApiGwEvent({
      method: 'DELETE',
      routeKey: 'DELETE /organizations/{orgId}',
      pathParameters: { orgId: 'unknown-id' },
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Organization 'unknown-id' not found" });
  });

  it('returns 400 when orgId path param is missing', async () => {
    const event = buildApiGwEvent({
      method: 'DELETE',
      routeKey: 'DELETE /organizations/{orgId}',
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result).error).toContain('Unhandled route');
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(deleteOrganization).mockRejectedValue(new Error('DynamoDB unavailable'));
    const event = buildApiGwEvent({
      method: 'DELETE',
      routeKey: 'DELETE /organizations/{orgId}',
      pathParameters: { orgId: 'org-123' },
    });
    const result = (await handler(event)) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});
