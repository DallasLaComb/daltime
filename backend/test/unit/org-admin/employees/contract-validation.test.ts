/**
 * Contract-backed request validation for the org-admin employees slice.
 *
 * These cover the seam the OpenAPI migration introduced: POST and PUT bodies
 * are validated against the very same Zod schemas that generate
 * `contracts/openapi.json`, in the handler, before the service (and therefore
 * before Cognito or DynamoDB) runs. Previously `validateCreateUserBody` ran
 * inside the service and PUT had no schema at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { CreateEmployeeBody, UpdateEmployeeBody } from '@daltime/contracts';

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
}));

import { parseWithContract } from '../../../../src/functions/shared/contract-validation.js';
import { ValidationError } from '../../../../src/functions/shared/errors.js';
import { handler } from '../../../../src/functions/org-admin/employees/handler.js';
import {
  createEmployee,
  updateEmployee,
} from '../../../../src/functions/org-admin/employees/service.js';

// ─── CreateEmployeeBody ───────────────────────────────────────────────────────

describe('CreateEmployeeBody', () => {
  const valid = {
    email: 'jane@acme.com',
    first_name: 'Jane',
    last_name: 'Smith',
    temp_password: 'Temp@1234',
  };

  it('accepts a body carrying only the required fields', () => {
    expect(parseWithContract(CreateEmployeeBody, valid)).toEqual(valid);
  });

  it('trims names so the stored record matches what the service would have trimmed', () => {
    const parsed = parseWithContract(CreateEmployeeBody, {
      ...valid,
      first_name: '  Jane  ',
      last_name: '  Smith  ',
    });
    expect(parsed.first_name).toBe('Jane');
    expect(parsed.last_name).toBe('Smith');
  });

  // Regression: the email is trimmed *before* the format check, matching the
  // validateCreateUserBody rule this replaced (EMAIL_REGEX.test(email.trim())).
  // Validating first would newly reject an address the API accepts today.
  it('accepts a whitespace-padded email and trims it', () => {
    expect(parseWithContract(CreateEmployeeBody, { ...valid, email: '  jane@acme.com  ' })).toEqual(
      valid,
    );
  });

  it('rejects a malformed email', () => {
    expect(() => parseWithContract(CreateEmployeeBody, { ...valid, email: 'not-an-email' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a missing email', () => {
    expect(() => parseWithContract(CreateEmployeeBody, { ...valid, email: undefined })).toThrow(
      /email/,
    );
  });

  it('rejects a blank first_name', () => {
    expect(() => parseWithContract(CreateEmployeeBody, { ...valid, first_name: '   ' })).toThrow(
      ValidationError,
    );
  });

  // min(1) alone accepts a whitespace-only string, which the old
  // `!body.temp_password?.trim()` check rejected.
  it('rejects a whitespace-only temp_password', () => {
    expect(() =>
      parseWithContract(CreateEmployeeBody, { ...valid, temp_password: '    ' }),
    ).toThrow(ValidationError);
  });

  it('never trims temp_password, which reaches Cognito verbatim', () => {
    const parsed = parseWithContract(CreateEmployeeBody, { ...valid, temp_password: ' Temp@1 ' });
    expect(parsed.temp_password).toBe(' Temp@1 ');
  });

  it('accepts optional phone and manager_id', () => {
    const parsed = parseWithContract(CreateEmployeeBody, {
      ...valid,
      phone: ' 555-1234 ',
      manager_id: ' mgr-1 ',
    });
    expect(parsed.phone).toBe('555-1234');
    expect(parsed.manager_id).toBe('mgr-1');
  });

  it('strips an unknown field so it cannot reach DynamoDB', () => {
    expect(parseWithContract(CreateEmployeeBody, { ...valid, org_id: 'someone-elses-org' })).toEqual(
      valid,
    );
  });
});

// ─── UpdateEmployeeBody ───────────────────────────────────────────────────────

describe('UpdateEmployeeBody', () => {
  it('accepts a partial update of a single field', () => {
    expect(parseWithContract(UpdateEmployeeBody, { first_name: 'Janet' })).toEqual({
      first_name: 'Janet',
    });
  });

  it('rejects an empty object — at least one field must be provided', () => {
    expect(() => parseWithContract(UpdateEmployeeBody, {})).toThrow(
      /at least one field must be provided/i,
    );
  });

  it('rejects a whitespace-only first_name, which would otherwise blank the record', () => {
    expect(() => parseWithContract(UpdateEmployeeBody, { first_name: '   ' })).toThrow(
      ValidationError,
    );
  });

  // The edit modal emits '' when the manager select is cleared, and the service
  // stores that to unassign the employee. A min(1) here would make un-assigning
  // a manager impossible.
  it('accepts an empty manager_id, which clears the manager assignment', () => {
    expect(parseWithContract(UpdateEmployeeBody, { manager_id: '' })).toEqual({ manager_id: '' });
  });

  it('accepts an empty phone, which clears the field', () => {
    expect(parseWithContract(UpdateEmployeeBody, { phone: '' })).toEqual({ phone: '' });
  });
});

// ─── Handler wiring ───────────────────────────────────────────────────────────

function buildEvent(
  method: string,
  body?: string,
  pathParameters: Record<string, string> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    rawPath: '/org-admin/employees',
    headers: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'orgadmin-sub-1', 'cognito:groups': 'OrgAdmin' } } },
      http: { method, path: '/org-admin/employees' },
    },
    isBase64Encoded: false,
    body: body ?? null,
    pathParameters,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

beforeEach(() => vi.clearAllMocks());

describe('org-admin employees handler — contract-validated bodies', () => {
  it('rejects a POST with a malformed email before the service runs', async () => {
    const result = (await handler(
      buildEvent(
        'POST',
        JSON.stringify({
          email: 'nope',
          first_name: 'Jane',
          last_name: 'Smith',
          temp_password: 'Temp@1234',
        }),
      ),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(createEmployee).not.toHaveBeenCalled();
  });

  it('hands the service the trimmed body on a valid POST', async () => {
    vi.mocked(createEmployee).mockResolvedValue({ employee_id: 'emp-1' });

    const result = (await handler(
      buildEvent(
        'POST',
        JSON.stringify({
          email: '  jane@acme.com ',
          first_name: ' Jane ',
          last_name: ' Smith ',
          temp_password: 'Temp@1234',
        }),
      ),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(201);
    expect(createEmployee).toHaveBeenCalledWith(
      'orgadmin-sub-1',
      {
        email: 'jane@acme.com',
        first_name: 'Jane',
        last_name: 'Smith',
        temp_password: 'Temp@1234',
      },
      expect.anything(),
    );
  });

  it('rejects an empty PUT body with 400 before the service runs', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({}), { employeeId: 'emp-1' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(updateEmployee).not.toHaveBeenCalled();
  });

  it('lets a PUT clearing the manager assignment through', async () => {
    vi.mocked(updateEmployee).mockResolvedValue({ employee_id: 'emp-1', manager_id: '' });

    const result = (await handler(
      buildEvent('PUT', JSON.stringify({ manager_id: '' }), { employeeId: 'emp-1' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(200);
    expect(updateEmployee).toHaveBeenCalledWith(
      'orgadmin-sub-1',
      'emp-1',
      { manager_id: '' },
      expect.anything(),
    );
  });

  it('strips an unknown PUT field so it cannot reach the update expression', async () => {
    vi.mocked(updateEmployee).mockResolvedValue({ employee_id: 'emp-1' });

    await handler(
      buildEvent('PUT', JSON.stringify({ first_name: 'Janet', org_id: 'other-org' }), {
        employeeId: 'emp-1',
      }),
    );

    expect(updateEmployee).toHaveBeenCalledWith(
      'orgadmin-sub-1',
      'emp-1',
      { first_name: 'Janet' },
      expect.anything(),
    );
  });
});
