/**
 * Query-string validation goes through the contract, not the services.
 *
 * `contracts/openapi.json` declares a `month` (YYYY-MM) query on these list /
 * schedule operations. Each handler must reject a malformed value with a 400
 * built from that very schema BEFORE the service is called — previously every
 * service re-implemented the regex by hand. These tests pin that wiring for the
 * handlers that have no dedicated handler test file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import {
  ManagerShiftsQuery,
  ManagerShiftNeededQuery,
  OrgAdminShiftsQuery,
  ScheduleMonthQuery,
} from '@daltime/contracts';

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class MockCognitoClient {},
}));
vi.mock('../../../src/functions/manager/shifts/service.js', () => ({ listShifts: vi.fn() }));
vi.mock('../../../src/functions/manager/shifts-needed/service.js', () => ({
  listShifts: vi.fn(),
}));
vi.mock('../../../src/functions/org-admin/shifts/service.js', () => ({ listShifts: vi.fn() }));
vi.mock('../../../src/functions/manager/schedule/service.js', () => ({
  generateDraftSchedule: vi.fn(),
  publishSchedule: vi.fn(),
  getDraftSummary: vi.fn(),
  getScheduleMetaForCaller: vi.fn(),
}));

import { handler as managerShifts } from '../../../src/functions/manager/shifts/handler.js';
import { handler as managerShiftsNeeded } from '../../../src/functions/manager/shifts-needed/handler.js';
import { handler as orgAdminShifts } from '../../../src/functions/org-admin/shifts/handler.js';
import { handler as managerSchedule } from '../../../src/functions/manager/schedule/handler.js';
import * as managerShiftsService from '../../../src/functions/manager/shifts/service.js';
import * as managerShiftsNeededService from '../../../src/functions/manager/shifts-needed/service.js';
import * as orgAdminShiftsService from '../../../src/functions/org-admin/shifts/service.js';
import * as scheduleService from '../../../src/functions/manager/schedule/service.js';
import { contractErrorMessage } from '../helpers/contract-error.js';

function buildEvent(
  method: string,
  path: string,
  query: Record<string, string>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'sub-1' }, scopes: null } },
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'vitest' },
    },
    isBase64Encoded: false,
    pathParameters: {},
    queryStringParameters: query,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const BAD = { month: '2025-6' };

beforeEach(() => vi.clearAllMocks());

describe.each([
  {
    name: 'GET /manager/shifts',
    run: () => managerShifts(buildEvent('GET', '/manager/shifts', BAD)),
    schema: ManagerShiftsQuery,
    service: () => managerShiftsService.listShifts,
  },
  {
    name: 'GET /manager/shifts-needed',
    run: () => managerShiftsNeeded(buildEvent('GET', '/manager/shifts-needed', BAD)),
    schema: ManagerShiftNeededQuery,
    service: () => managerShiftsNeededService.listShifts,
  },
  {
    name: 'GET /org-admin/shifts',
    run: () => orgAdminShifts(buildEvent('GET', '/org-admin/shifts', BAD)),
    schema: OrgAdminShiftsQuery,
    service: () => orgAdminShiftsService.listShifts,
  },
  {
    name: 'GET /manager/schedule/meta',
    run: () => managerSchedule(buildEvent('GET', '/manager/schedule/meta', BAD)),
    schema: ScheduleMonthQuery,
    service: () => scheduleService.getScheduleMetaForCaller,
  },
  {
    name: 'POST /manager/schedule/generate',
    run: () => managerSchedule(buildEvent('POST', '/manager/schedule/generate', BAD)),
    schema: ScheduleMonthQuery,
    service: () => scheduleService.generateDraftSchedule,
  },
])('$name — month query', ({ run, schema, service }) => {
  it('returns the contract’s 400 for a malformed month without calling the service', async () => {
    const result = (await run()) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(service()).not.toHaveBeenCalled();
    expect(JSON.parse(result.body as string)).toEqual({
      error: contractErrorMessage(schema, BAD),
    });
  });
});
