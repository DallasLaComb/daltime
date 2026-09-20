/**
 * Unit tests for GET /employee/available-shifts handler.
 *
 * Covers Employee role enforcement (403 for non-Employee callers), missing/invalid
 * ?date param (400), happy path (200 with array), empty result (200 []), and
 * unexpected service errors (500). The service is mocked so no DynamoDB calls
 * are made here — service and db correctness is covered in service.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';

// Mock the service module before importing the handler.
vi.mock('../../../../src/functions/employee/available-shifts/service.js', () => ({
  listAvailableShifts: vi.fn(),
}));

import { AvailableShiftsQueryParams } from '@daltime/contracts';
import { contractErrorMessage } from '../../helpers/contract-error.js';
import { handler } from '../../../../src/functions/employee/available-shifts/handler.js';
import { listAvailableShifts } from '../../../../src/functions/employee/available-shifts/service.js';
import { ForbiddenError } from '../../../../src/functions/shared/errors.js';

// ─── Event factory ────────────────────────────────────────────────────────────

/**
 * Build a minimal API Gateway V2 event for GET /employee/available-shifts.
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
    routeKey: `${method} /employee/available-shifts`,
    rawPath: '/employee/available-shifts',
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
        path: '/employee/available-shifts',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'test-req-id',
      routeKey: `${method} /employee/available-shifts`,
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
    expect(listAvailableShifts).not.toHaveBeenCalled();
  });
});

// ─── Role enforcement ─────────────────────────────────────────────────────────

describe('GET /employee/available-shifts — role isolation', () => {
  it('returns 403 when caller is in Manager group', async () => {
    const result = (await handler(
      buildEvent('GET', 'Manager', 'sub-manager', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(listAvailableShifts).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is in WebAdmin group', async () => {
    const result = (await handler(
      buildEvent('GET', 'WebAdmin', 'sub-webadmin', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(listAvailableShifts).not.toHaveBeenCalled();
  });

  it('returns 403 when caller has no group claim', async () => {
    const result = (await handler(
      buildEvent('GET', undefined, 'sub-none', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
    expect(listAvailableShifts).not.toHaveBeenCalled();
  });

  it('returns 200 when caller uses bracket-stringified [Employee] group claim (prod JWT shape)', async () => {
    vi.mocked(listAvailableShifts).mockResolvedValue([]);

    const result = (await handler(
      buildEvent('GET', '[Employee]', 'sub-emp', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    // [Employee] is normalized to ['Employee'] by getCallerGroups — must pass.
    expect(result.statusCode).toBe(200);
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

const mockShifts = [
  {
    shift_id: 'shift-99',
    org_id: 'org-sunset',
    employee_id: 'emp-other',
    date: '2025-06-15',
    start_time: '09:00',
    end_time: '17:00',
    available_for_pickup: true,
  },
];

describe('GET /employee/available-shifts — happy path', () => {
  it('returns 200 with available shift array', async () => {
    vi.mocked(listAvailableShifts).mockResolvedValue(mockShifts as Awaited<ReturnType<typeof listAvailableShifts>>);

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual(mockShifts);
    expect(listAvailableShifts).toHaveBeenCalledWith('sub-emp', '2025-06-15');
  });

  it('returns 200 with empty array when no shifts are available', async () => {
    vi.mocked(listAvailableShifts).mockResolvedValue([]);

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(parsedBody(result)).toEqual([]);
  });
});

// ─── Validation errors ────────────────────────────────────────────────────────

describe('GET /employee/available-shifts — validation errors', () => {
  it.each([
    ['date param is missing', {}],
    ['date format is invalid', { date: '15-06-2025' }],
    ['date is not a real calendar day', { date: '2025-13-45' }],
  ])('returns 400 from the contract when %s, without reaching the service', async (_, query) => {
    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', query),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(listAvailableShifts).not.toHaveBeenCalled();
    expect(parsedBody(result)).toEqual({
      error: contractErrorMessage(AvailableShiftsQueryParams, query),
    });
  });
});

// ─── Auth / DynamoDB errors ───────────────────────────────────────────────────

describe('GET /employee/available-shifts — server errors', () => {
  it('returns 403 when service throws ForbiddenError (caller not provisioned)', async () => {
    vi.mocked(listAvailableShifts).mockRejectedValue(
      new ForbiddenError('Caller could not be resolved'),
    );

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-ghost', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(403);
  });

  it('returns 500 when service throws an unexpected error', async () => {
    vi.mocked(listAvailableShifts).mockRejectedValue(new Error('DynamoDB transient error'));

    const result = (await handler(
      buildEvent('GET', 'Employee', 'sub-emp', { date: '2025-06-15' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(500);
  });
});
