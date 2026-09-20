import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

vi.mock('../../../../src/functions/org-admin/managers/service.js', () => ({
  listManagers: vi.fn(),
  createManager: vi.fn(),
  updateManager: vi.fn(),
  disableManager: vi.fn(),
  enableManager: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class MockCognitoClient {
    send = vi.fn();
  },
  AdminCreateUserCommand: vi.fn(),
  AdminAddUserToGroupCommand: vi.fn(),
  AdminDisableUserCommand: vi.fn(),
  AdminEnableUserCommand: vi.fn(),
  AdminGetUserCommand: vi.fn(),
  UsernameExistsException: class UsernameExistsException extends Error {},
  InvalidPasswordException: class InvalidPasswordException extends Error {},
}));

import { handler } from '../../../../src/functions/org-admin/managers/handler.js';
import { ValidationError, ConflictError, NotFoundError, ForbiddenError } from '../../../../src/functions/shared/errors.js';
import {
  listManagers,
  createManager,
  updateManager,
  disableManager,
  enableManager,
} from '../../../../src/functions/org-admin/managers/service.js';

// ─── Factories ────────────────────────────────────────────────────────────────

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & { method?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  const routeKey = overrides.routeKey ?? `${method} /org-admin/managers`;
  return {
    version: '2.0',
    routeKey,
    rawPath: '/org-admin/managers',
    rawQueryString: '',
    headers: { authorization: 'Bearer test-token' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: { claims: { 'cognito:groups': 'OrgAdmin', sub: 'orgadmin-sub-123' }, scopes: null },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/org-admin/managers',
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

const mockManager = {
  manager_id: 'mgr-sub-123',
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@acme.com',
  phone: '555-1234',
  org_id: 'org-123',
  org_admin_id: 'orgadmin-sub-123',
  status: 'FORCE_CHANGE_PASSWORD' as const,
  employee_count: 0,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
};

function body(result: APIGatewayProxyStructuredResultV2) {
  return JSON.parse(result.body as string);
}

beforeEach(() => vi.clearAllMocks());

// ─── OPTIONS ─────────────────────────────────────────────────────────────────

describe('OPTIONS — CORS preflight', () => {
  it('returns 200', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'OPTIONS', routeKey: 'OPTIONS /org-admin/managers' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});

// ─── GET /org-admin/managers ─────────────────────────────────────────────────

describe('GET /org-admin/managers — list', () => {
  it('returns 200 with array of managers', async () => {
    vi.mocked(listManagers).mockResolvedValue([mockManager]);
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([mockManager]);
  });

  it('returns 403 when caller org cannot be resolved', async () => {
    vi.mocked(listManagers).mockRejectedValue(new ForbiddenError('Caller organization could not be resolved'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller organization could not be resolved' });
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(listManagers).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── POST /org-admin/managers ────────────────────────────────────────────────

describe('POST /org-admin/managers — create', () => {
  const validBody = JSON.stringify({
    email: 'john@acme.com',
    first_name: 'John',
    last_name: 'Doe',
    temp_password: 'Temp@1234',
  });

  it('returns 201 with the created manager', async () => {
    vi.mocked(createManager).mockResolvedValue(mockManager);
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    expect(body(result)).toEqual(mockManager);
  });

  it('returns 400 when body is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: '{bad' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when email is missing', async () => {
    vi.mocked(createManager).mockRejectedValue(new ValidationError('email is required'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'email is required' });
  });

  it('returns 400 when email format is invalid', async () => {
    vi.mocked(createManager).mockRejectedValue(new ValidationError('email must be a valid email address'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'email must be a valid email address' });
  });

  it('returns 400 when first_name is missing', async () => {
    vi.mocked(createManager).mockRejectedValue(new ValidationError('first_name is required'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'first_name is required' });
  });

  it('returns 400 when last_name is missing', async () => {
    vi.mocked(createManager).mockRejectedValue(new ValidationError('last_name is required'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'last_name is required' });
  });

  it('returns 400 when temp_password is missing', async () => {
    vi.mocked(createManager).mockRejectedValue(new ValidationError('temp_password is required'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'temp_password is required' });
  });

  it('returns 409 when email already exists', async () => {
    vi.mocked(createManager).mockRejectedValue(new ConflictError('A user with this email already exists'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(409);
    expect(body(result)).toEqual({ error: 'A user with this email already exists' });
  });

  it('returns 400 when password fails Cognito policy', async () => {
    vi.mocked(createManager).mockRejectedValue(new ValidationError('Password does not meet requirements'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Password does not meet requirements' });
  });

  it('returns 403 when caller org cannot be resolved', async () => {
    vi.mocked(createManager).mockRejectedValue(new ForbiddenError('Caller organization could not be resolved'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller organization could not be resolved' });
  });

  it('returns 500 when Cognito throws unexpected error', async () => {
    vi.mocked(createManager).mockRejectedValue(new Error('Cognito failure'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/managers', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── PUT /org-admin/managers/{managerId} ─────────────────────────────────────

describe('PUT /org-admin/managers/{managerId} — update', () => {
  const updateBody = JSON.stringify({ first_name: 'Jane' });

  it('returns 200 with the updated manager', async () => {
    const updated = { ...mockManager, first_name: 'Jane' };
    vi.mocked(updateManager).mockResolvedValue(updated);
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(updated);
  });

  it('returns 400 when managerId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/managers/{managerId}',
        pathParameters: {},
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'managerId path parameter is required' });
  });

  it('returns 400 when body is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is empty object', async () => {
    vi.mocked(updateManager).mockRejectedValue(new ValidationError('At least one field must be provided'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
        body: '{}',
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'At least one field must be provided' });
  });

  it('returns 404 when manager is not found', async () => {
    vi.mocked(updateManager).mockRejectedValue(new NotFoundError("Manager 'mgr-unknown' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-unknown' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Manager 'mgr-unknown' not found" });
  });

  it('returns 403 when manager belongs to different org', async () => {
    vi.mocked(updateManager).mockRejectedValue(new ForbiddenError('Not authorized to manage this manager'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized to manage this manager' });
  });
});

// ─── PATCH /org-admin/managers/{managerId} ───────────────────────────────────

describe('PATCH /org-admin/managers/{managerId} — enable', () => {
  it('returns 204 when manager is enabled', async () => {
    vi.mocked(enableManager).mockResolvedValue(undefined);
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(204);
  });

  it('returns 400 when managerId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/managers/{managerId}',
        pathParameters: {},
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'managerId path parameter is required' });
  });

  it('returns 404 when manager is not found', async () => {
    vi.mocked(enableManager).mockRejectedValue(new NotFoundError("Manager 'mgr-unknown' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Manager 'mgr-unknown' not found" });
  });

  it('returns 403 when manager belongs to different org', async () => {
    vi.mocked(enableManager).mockRejectedValue(new ForbiddenError('Not authorized to manage this manager'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized to manage this manager' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(enableManager).mockRejectedValue(new Error('Cognito failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── DELETE /org-admin/managers/{managerId} ──────────────────────────────────

describe('DELETE /org-admin/managers/{managerId} — disable', () => {
  it('returns 204 when manager is disabled', async () => {
    vi.mocked(disableManager).mockResolvedValue(undefined);
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(204);
  });

  it('returns 400 when managerId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/managers/{managerId}',
        pathParameters: {},
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'managerId path parameter is required' });
  });

  it('returns 404 when manager is not found', async () => {
    vi.mocked(disableManager).mockRejectedValue(new NotFoundError("Manager 'mgr-unknown' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Manager 'mgr-unknown' not found" });
  });

  it('returns 403 when manager belongs to different org', async () => {
    vi.mocked(disableManager).mockRejectedValue(new ForbiddenError('Not authorized to manage this manager'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized to manage this manager' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(disableManager).mockRejectedValue(new Error('Cognito failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/managers/{managerId}',
        pathParameters: { managerId: 'mgr-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});
