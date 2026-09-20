import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

vi.mock('../../../../src/functions/manager/employees/service.js', () => ({
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  disableEmployee: vi.fn(),
  enableEmployee: vi.fn(),
  getEmployeeAvailabilityForManager: vi.fn(),
  getEmployeeAvailabilityOverridesForManager: vi.fn(),
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

import { handler } from '../../../../src/functions/manager/employees/handler.js';
import { ValidationError, ConflictError, NotFoundError, ForbiddenError } from '../../../../src/functions/shared/errors.js';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  disableEmployee,
  enableEmployee,
  getEmployeeAvailabilityForManager,
  getEmployeeAvailabilityOverridesForManager,
} from '../../../../src/functions/manager/employees/service.js';

// ─── Factories ────────────────────────────────────────────────────────────────

function buildApiGwEvent(
  overrides: Partial<APIGatewayProxyEventV2WithJWTAuthorizer> & { method?: string } = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const method = overrides.method ?? 'GET';
  const routeKey = overrides.routeKey ?? `${method} /manager/employees`;
  return {
    version: '2.0',
    routeKey,
    rawPath: '/manager/employees',
    rawQueryString: '',
    headers: { authorization: 'Bearer test-token' },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: {
        jwt: { claims: { 'cognito:groups': 'Manager', sub: 'manager-sub-123' }, scopes: null },
      },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/manager/employees',
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
  manager_id: 'manager-sub-123',
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
      buildApiGwEvent({ method: 'OPTIONS', routeKey: 'OPTIONS /manager/employees' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});

// ─── GET /manager/employees ───────────────────────────────────────────────────

describe('GET /manager/employees — list', () => {
  it('returns 200 with array of employees', async () => {
    vi.mocked(listEmployees).mockResolvedValue([mockEmployee]);
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual([mockEmployee]);
  });

  it('returns 403 when caller cannot be resolved', async () => {
    vi.mocked(listEmployees).mockRejectedValue(new ForbiddenError('Caller could not be resolved'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Caller could not be resolved' });
  });

  it('returns 500 when service throws', async () => {
    vi.mocked(listEmployees).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(buildApiGwEvent())) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── POST /manager/employees ──────────────────────────────────────────────────

describe('POST /manager/employees — create', () => {
  const validBody = JSON.stringify({
    email: 'jane@acme.com',
    first_name: 'Jane',
    last_name: 'Smith',
    temp_password: 'Temp@1234',
  });

  it('returns 201 with the created employee', async () => {
    vi.mocked(createEmployee).mockResolvedValue(mockEmployee);
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /manager/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(201);
    expect(body(result)).toEqual(mockEmployee);
  });

  it('returns 400 when body is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /manager/employees' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Request body is required' });
  });

  it('returns 400 when body is invalid JSON', async () => {
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /manager/employees', body: '{bad' }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 when email is missing', async () => {
    vi.mocked(createEmployee).mockRejectedValue(new ValidationError('email is required'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /manager/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'email is required' });
  });

  it('returns 409 when email already exists', async () => {
    vi.mocked(createEmployee).mockRejectedValue(new ConflictError('A user with this email already exists'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /manager/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(409);
    expect(body(result)).toEqual({ error: 'A user with this email already exists' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(createEmployee).mockRejectedValue(new Error('Cognito failure'));
    const result = (await handler(
      buildApiGwEvent({ method: 'POST', routeKey: 'POST /manager/employees', body: validBody }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── PUT /manager/employees/{employeeId} ──────────────────────────────────────

describe('PUT /manager/employees/{employeeId} — update', () => {
  const updateBody = JSON.stringify({ first_name: 'Janet' });

  it('returns 200 with the updated employee', async () => {
    const updated = { ...mockEmployee, first_name: 'Janet' };
    vi.mocked(updateEmployee).mockResolvedValue(updated);
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /manager/employees/{employeeId}',
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
        routeKey: 'PUT /manager/employees/{employeeId}',
        pathParameters: {},
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(400);
    expect(body(result)).toEqual({ error: 'employeeId path parameter is required' });
  });

  it('returns 404 when employee is not found', async () => {
    vi.mocked(updateEmployee).mockRejectedValue(new NotFoundError("Employee 'emp-unknown' not found"));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-unknown' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to different manager', async () => {
    vi.mocked(updateEmployee).mockRejectedValue(new ForbiddenError('Not authorized to manage this employee'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PUT',
        routeKey: 'PUT /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
        body: updateBody,
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized to manage this employee' });
  });
});

// ─── PATCH /manager/employees/{employeeId} ────────────────────────────────────

describe('PATCH /manager/employees/{employeeId} — enable', () => {
  it('returns 204 when employee is enabled', async () => {
    vi.mocked(enableEmployee).mockResolvedValue(undefined);
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(204);
  });

  it('returns 400 when employeeId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/employees/{employeeId}',
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
        routeKey: 'PATCH /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to different manager', async () => {
    vi.mocked(enableEmployee).mockRejectedValue(new ForbiddenError('Not authorized to manage this employee'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'PATCH',
        routeKey: 'PATCH /manager/employees/{employeeId}',
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
        routeKey: 'PATCH /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── DELETE /manager/employees/{employeeId} ───────────────────────────────────

describe('DELETE /manager/employees/{employeeId} — disable', () => {
  it('returns 204 when employee is disabled', async () => {
    vi.mocked(disableEmployee).mockResolvedValue(undefined);
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(204);
  });

  it('returns 400 when employeeId is missing', async () => {
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /manager/employees/{employeeId}',
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
        routeKey: 'DELETE /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to different manager', async () => {
    vi.mocked(disableEmployee).mockRejectedValue(new ForbiddenError('Not authorized to manage this employee'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'DELETE',
        routeKey: 'DELETE /manager/employees/{employeeId}',
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
        routeKey: 'DELETE /manager/employees/{employeeId}',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── OPTIONS /manager/employees/{employeeId}/availability ─────────────────────

describe('OPTIONS /manager/employees/{employeeId}/availability — CORS preflight', () => {
  it('returns 200 with CORS headers', async () => {
    // Confirms the shared OPTIONS branch handles the availability sub-path correctly.
    const result = (await handler(
      buildApiGwEvent({
        method: 'OPTIONS',
        routeKey: 'OPTIONS /manager/employees/{employeeId}/availability',
        rawPath: '/manager/employees/emp-sub-123/availability',
        pathParameters: { employeeId: 'emp-sub-123' },
        headers: { origin: 'https://dev.daltime.com' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
  });
});

// ─── GET /manager/employees/{employeeId}/availability ─────────────────────────

describe('GET /manager/employees/{employeeId}/availability — read employee availability', () => {
  const mockAvailability = {
    employee_id: 'emp-sub-123',
    schedule: { monday: ['09:00', '17:00'] },
    updated_at: '2025-01-01T00:00:00.000Z',
  };

  it('returns 200 with availability payload', async () => {
    // Manager can read the recurring availability for any employee they own.
    vi.mocked(getEmployeeAvailabilityForManager).mockResolvedValue(mockAvailability);
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability',
        rawPath: '/manager/employees/emp-sub-123/availability',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(mockAvailability);
  });

  it('returns 404 when employee is not found', async () => {
    vi.mocked(getEmployeeAvailabilityForManager).mockRejectedValue(
      new NotFoundError("Employee 'emp-unknown' not found"),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability',
        rawPath: '/manager/employees/emp-unknown/availability',
        pathParameters: { employeeId: 'emp-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to a different manager', async () => {
    vi.mocked(getEmployeeAvailabilityForManager).mockRejectedValue(
      new ForbiddenError('Not authorized'),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability',
        rawPath: '/manager/employees/emp-sub-123/availability',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(getEmployeeAvailabilityForManager).mockRejectedValue(new Error('DynamoDB failure'));
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability',
        rawPath: '/manager/employees/emp-sub-123/availability',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});

// ─── GET /manager/employees/{employeeId}/availability/overrides ───────────────

describe('GET /manager/employees/{employeeId}/availability/overrides — read employee overrides', () => {
  const mockOverrides = {
    employee_id: 'emp-sub-123',
    overrides: { '2025-07-04': 'unavailable' },
    updated_at: '2025-01-01T00:00:00.000Z',
  };

  it('returns 200 with overrides payload', async () => {
    // Manager can read date-specific availability overrides for any employee they own.
    vi.mocked(getEmployeeAvailabilityOverridesForManager).mockResolvedValue(mockOverrides);
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability/overrides',
        rawPath: '/manager/employees/emp-sub-123/availability/overrides',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual(mockOverrides);
  });

  it('returns 404 when employee is not found', async () => {
    vi.mocked(getEmployeeAvailabilityOverridesForManager).mockRejectedValue(
      new NotFoundError("Employee 'emp-unknown' not found"),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability/overrides',
        rawPath: '/manager/employees/emp-unknown/availability/overrides',
        pathParameters: { employeeId: 'emp-unknown' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: "Employee 'emp-unknown' not found" });
  });

  it('returns 403 when employee belongs to a different manager', async () => {
    vi.mocked(getEmployeeAvailabilityOverridesForManager).mockRejectedValue(
      new ForbiddenError('Not authorized'),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability/overrides',
        rawPath: '/manager/employees/emp-sub-123/availability/overrides',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(403);
    expect(body(result)).toEqual({ error: 'Not authorized' });
  });

  it('returns 500 when service throws unexpected error', async () => {
    vi.mocked(getEmployeeAvailabilityOverridesForManager).mockRejectedValue(
      new Error('DynamoDB failure'),
    );
    const result = (await handler(
      buildApiGwEvent({
        method: 'GET',
        routeKey: 'GET /manager/employees/{employeeId}/availability/overrides',
        rawPath: '/manager/employees/emp-sub-123/availability/overrides',
        pathParameters: { employeeId: 'emp-sub-123' },
      }),
    )) as APIGatewayProxyStructuredResultV2;
    expect(result.statusCode).toBe(500);
    expect(body(result)).toEqual({ error: 'An unexpected error occurred' });
  });
});
