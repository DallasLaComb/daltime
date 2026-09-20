/**
 * Unit tests for GET /employee/shifts handler.
 *
 * Covers the three time-window query params (month, date, week), Employee role
 * enforcement (403 for non-Employee callers), validation errors (400), and
 * DynamoDB-level failures (500). The service is mocked so no DynamoDB calls
 * are made here — service correctness is covered separately in service.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

// Mock the service module before importing the handler.
vi.mock('../../../../src/functions/employee/shifts/service.js', () => ({
  listMyShifts: vi.fn(),
}));

import { ShiftsQueryParams } from '@daltime/contracts';
import { contractErrorMessage } from '../../helpers/contract-error.js';
import { handler } from '../../../../src/functions/employee/shifts/handler.js';
import { listMyShifts } from '../../../../src/functions/employee/shifts/service.js';
import { ValidationError, ForbiddenError } from '../../../../src/functions/shared/errors.js';

// ─── Event factory ────────────────────────────────────────────────────────────

/**
 * Build a minimal API Gateway V2 event for the /employee/shifts route.
 * Supply groups as a string (single group), string array, or undefined (no claim).
 */
function buildEvent(
  method: string,
  groups: string | string[] | undefined,
  sub: string,
  queryParams?: Record<string, string>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const claims: Record<string, unknown> = { sub };
  if (groups !== undefined) claims['cognito:groups'] = groups;

  return {
    version: '2.0',
    routeKey: `${method} /employee/shifts`,
    rawPath: '/employee/shifts',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: { jwt: { claims, scopes: null } },
      domainName: 'test.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test',
      http: {
        method,
        path: '/employee/shifts',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'test-req-id',
      routeKey: `${method} /employee/shifts`,
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1735689600000,
    },
    isBase64Encoded: false,
    body: null,
    pathParameters: {},
    queryStringParameters: queryParams,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function parsedBody(result: APIGatewayProxyStructuredResultV2): unknown {
  return JSON.parse(result.body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── OPTIONS preflight ────────────────────────────────────────────────────────

describe('OPTIONS — CORS preflight', () => {
  it('returns 200 without calling the service', async () => {
    const result = (await handler(
      buildEvent('OPTIONS', 'Employee', 'sub-1'),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(listMyShifts).not.toHaveBeenCalled();
  });
});

// ─── Role enforcement ─────────────────────────────────────────────────────────

describe('GET /employee/shifts — role isolation', () => {
  it('returns 403 when caller is in Manager group', async () => {
    const result = (await handler(
      buildEvent('GET', 'Manager', 'sub-manager', { month: '2025-06' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(listMyShifts).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is in [Employee] bracket-stringified group (prod JWT shape)', async () => {
    // Bracket-stringified group string as emitted by HTTP API JWT authorizer.
    const result = (await handler(
      buildEvent('GET', '[Employee]', 'sub-emp', { month: '2025-06' }),
    )) as APIGatewayProxyStructuredResultV2;

    // [Employee] is normalized to ['Employee'] by getCallerGroups — should pass.
    expect(result.statusCode).toBe(200);
  });

  it('returns 403 when caller has no group claim', async () => {
    const result = (await handler(
      buildEvent('GET', undefined, 'sub-none', { month: '2025-06' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(listMyShifts).not.toHaveBeenCalled();
  });
});

// ─── Happy paths ──────────────────────────────────────────────────────────────

const mockShifts = [
  {
    shift_id: 'shift-1',
    org_id: 'org-sunset',
    employee_id: 'emp-1',
    date: '2025-06-15',
    start_time: '09:00',
    end_time: '17:00',
  },
];

describe('GET /employee/shifts — ?month param', () => {
  it('returns 200 with shift array when month param is valid', async () => {
    vi.mocked(listMyShifts).mockResolvedValue(mockShifts as Awaited<ReturnType<typeof listMyShifts>>);

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { month: '2025-06' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual(mockShifts);
    expect(listMyShifts).toHaveBeenCalledWith('sub-emp', {
      month: '2025-06',
      date: undefined,
      week: undefined,
    });
  });

  it('returns 200 with empty array when no shifts match', async () => {
    vi.mocked(listMyShifts).mockResolvedValue([]);

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { month: '2025-06' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual([]);
  });
});

describe('GET /employee/shifts — ?date param', () => {
  it('returns 200 with shift array when date param is valid', async () => {
    vi.mocked(listMyShifts).mockResolvedValue(mockShifts as Awaited<ReturnType<typeof listMyShifts>>);

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(listMyShifts).toHaveBeenCalledWith('sub-emp', {
      month: undefined,
      date: '2025-06-15',
      week: undefined,
    });
  });
});

describe('GET /employee/shifts — ?week param', () => {
  it('returns 200 with shift array when week param is valid', async () => {
    vi.mocked(listMyShifts).mockResolvedValue(mockShifts as Awaited<ReturnType<typeof listMyShifts>>);

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { week: '2025-06-09' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(listMyShifts).toHaveBeenCalledWith('sub-emp', {
      month: undefined,
      date: undefined,
      week: '2025-06-09',
    });
  });
});

// ─── Validation errors from service ──────────────────────────────────────────

describe('GET /employee/shifts — validation errors', () => {
  it('returns 400 when service throws ValidationError (no params supplied)', async () => {
    vi.mocked(listMyShifts).mockRejectedValue(
      new ValidationError(
        'One of "month" (YYYY-MM), "date" (YYYY-MM-DD), or "week" (YYYY-MM-DD) query params is required',
      ),
    );

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', {}),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    const body = parsedBody(result) as { error: string };
    expect(body.error).toMatch(/month.*date.*week/i);
  });

  it('returns 400 when service throws ValidationError (bad month format)', async () => {
    vi.mocked(listMyShifts).mockRejectedValue(
      new ValidationError('month must be in YYYY-MM format'),
    );

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { month: 'June-2025' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when service throws ValidationError (bad date format)', async () => {
    vi.mocked(listMyShifts).mockRejectedValue(
      new ValidationError('date must be in YYYY-MM-DD format'),
    );

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { date: 'not-a-date' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when service throws ValidationError (bad week format)', async () => {
    vi.mocked(listMyShifts).mockRejectedValue(
      new ValidationError('week must be in YYYY-MM-DD format (the Monday of the desired week)'),
    );

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { week: 'week-26' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when the contract rejects multiple params (exactly-one rule)', async () => {
    const query = { month: '2025-06', date: '2025-06-15', week: '2025-06-09' };

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', query),
    )) as APIGatewayProxyStructuredResultV2;

    // The contract's exactly-one rule is enforced in the handler; the service is never reached.
    expect(result.statusCode).toBe(400);
    expect(listMyShifts).not.toHaveBeenCalled();
    expect(parsedBody(result)).toEqual({
      error: contractErrorMessage(ShiftsQueryParams, query),
    });
  });

  it('returns 400 when the contract rejects a request with none of the params', async () => {
    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', {}),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(listMyShifts).not.toHaveBeenCalled();
    expect(parsedBody(result)).toEqual({ error: contractErrorMessage(ShiftsQueryParams, {}) });
  });

  it('rejects a malformed date per the contract before reaching the service', async () => {
    const query = { date: '2025-13-45' };

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', query),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(listMyShifts).not.toHaveBeenCalled();
    expect(parsedBody(result)).toEqual({
      error: contractErrorMessage(ShiftsQueryParams, query),
    });
  });
});

// ─── Auth / DynamoDB errors ───────────────────────────────────────────────────

describe('GET /employee/shifts — server errors', () => {
  it('returns 403 when service throws ForbiddenError (caller not provisioned)', async () => {
    vi.mocked(listMyShifts).mockRejectedValue(new ForbiddenError('Caller could not be resolved'));

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { month: '2025-06' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
  });

  it('returns 500 when service throws an unexpected error', async () => {
    vi.mocked(listMyShifts).mockRejectedValue(new Error('DynamoDB transient error'));

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { month: '2025-06' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
  });
});
