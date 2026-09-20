import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

vi.mock('../../../../src/functions/org-admin/employees/service.js', () => ({
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  disableEmployee: vi.fn(),
  enableEmployee: vi.fn(),
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

import { handler } from '../../../../src/functions/org-admin/employees/handler.js';
import { ValidationError, ConflictError, NotFoundError, ForbiddenError } from '../../../../src/functions/shared/errors.js';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  disableEmployee,
  enableEmployee,
} from '../../../../src/functions/org-admin/employees/service.js';

// ─── Factories ────────────────────────────────────────────────────────────────

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & { method?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  const routeKey = overrides.routeKey ?? `${method} /org-admin/employees`;
  return {
    version: '2.0',
    routeKey,
    rawPath: '/org-admin/employees',
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
        path: '/org-admin/employees',
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

const mockEmployee = {
  employee_id: 'emp-sub-123',
  first_name: 'Jane',
  last_name: 'Smith',
  email: 'jane@acme.com',
  phone: '555-5678',
  org_id: 'org-123',
  manager_id: 'mgr-sub-123',
  status: 'CONFIRMED' as const,
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
      buildApiGwEvent({ method: 'OPTIONS', routeKey: 'OPTIONS /org-admin/employees' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});

// ─── GET /org-admin/employees ─────────────────────────────────────────────────

describe('GET /org-admin/employees — list', () => {
  it('returns 200 with array of employees', async () => {
    vi.mocked(listEmployees).mockResolvedValue([mockEmployee]);
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([mockEmployee]);
  });

  it('returns 403 when caller org cannot be resolved', async () => {
    vi.mocked(listEmployees).mockRejectedValue(new ForbiddenError('Caller organization could not be resolved'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller organization could not be resolved' });
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(listEmployees).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── POST /org-admin/employees ────────────────────────────────────────────────

describe('POST /org-admin/employees — create', () => {
  const validBody = JSON.stringify({
    email: 'jane@acme.com',
    first_name: 'Jane',
    last_name: 'Smith',
    temp_password: 'Temp@1234',
  });

  it('returns 201 with the created employee', async () => {
    vi.mocked(createEmployee).mockResolvedValue(mockEmployee);
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    expect(body(result)).toEqual(mockEmployee);
  });

  it('returns 400 when body is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/employees' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/employees', body: '{bad' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when email is missing', async () => {
    vi.mocked(createEmployee).mockRejectedValue(new ValidationError('email is required'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'email is required' });
  });

  it('returns 409 when email already exists', async () => {
    vi.mocked(createEmployee).mockRejectedValue(new ConflictError('A user with this email already exists'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(409);
    expect(body(result)).toEqual({ error: 'A user with this email already exists' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(createEmployee).mockRejectedValue(new Error('Cognito failure'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /org-admin/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── PUT /org-admin/employees/{employeeId} ────────────────────────────────────

describe('PUT /org-admin/employees/{employeeId} — update', () => {
  const updateBody = JSON.stringify({ first_name: 'Janet' });

  it('returns 200 with the updated employee', async () => {
    const updated = { ...mockEmployee, first_name: 'Janet' };
    vi.mocked(updateEmployee).mockResolvedValue(updated);
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(updated);
  });

  it('returns 400 when employeeId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/employees/{employeeId}',
        pathParameters: {},
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'employeeId path parameter is required' });
  });

  it('returns 400 when body is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 404 when employee is not found', async () => {
    vi.mocked(updateEmployee).mockRejectedValue(new NotFoundError("Employee 'emp-unknown' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-unknown' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to different org', async () => {
    vi.mocked(updateEmployee).mockRejectedValue(new ForbiddenError('Not authorized to manage this employee'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized to manage this employee' });
  });
});

// ─── PATCH /org-admin/employees/{employeeId} ─────────────────────────────────

describe('PATCH /org-admin/employees/{employeeId} — enable', () => {
  it('returns 204 when employee is enabled', async () => {
    vi.mocked(enableEmployee).mockResolvedValue(undefined);
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(204);
  });

  it('returns 400 when employeeId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/employees/{employeeId}',
        pathParameters: {},
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'employeeId path parameter is required' });
  });

  it('returns 404 when employee is not found', async () => {
    vi.mocked(enableEmployee).mockRejectedValue(new NotFoundError("Employee 'emp-unknown' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to different org', async () => {
    vi.mocked(enableEmployee).mockRejectedValue(new ForbiddenError('Not authorized to manage this employee'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized to manage this employee' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(enableEmployee).mockRejectedValue(new Error('Cognito failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── DELETE /org-admin/employees/{employeeId} ─────────────────────────────────

describe('DELETE /org-admin/employees/{employeeId} — disable', () => {
  it('returns 204 when employee is disabled', async () => {
    vi.mocked(disableEmployee).mockResolvedValue(undefined);
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(204);
  });

  it('returns 400 when employeeId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/employees/{employeeId}',
        pathParameters: {},
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'employeeId path parameter is required' });
  });

  it('returns 404 when employee is not found', async () => {
    vi.mocked(disableEmployee).mockRejectedValue(new NotFoundError("Employee 'emp-unknown' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to different org', async () => {
    vi.mocked(disableEmployee).mockRejectedValue(new ForbiddenError('Not authorized to manage this employee'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized to manage this employee' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(disableEmployee).mockRejectedValue(new Error('Cognito failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /org-admin/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});
