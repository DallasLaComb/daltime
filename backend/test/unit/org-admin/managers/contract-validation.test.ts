/**
 * Contract-backed request validation for the org-admin managers slice.
 *
 * POST and PUT bodies are validated in the handler against the same Zod schemas
 * that generate `contracts/openapi.json`, so a body the published contract
 * calls invalid is rejected with a 400 before Cognito or DynamoDB is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda';
import { CreateManagerBody, UpdateManagerBody } from '@daltime/contracts';

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
}));

import { parseWithContract } from '../../../../src/functions/shared/contract-validation.js';
import { ValidationError } from '../../../../src/functions/shared/errors.js';
import { handler } from '../../../../src/functions/org-admin/managers/handler.js';
import {
  createManager,
  updateManager,
} from '../../../../src/functions/org-admin/managers/service.js';

// ─── CreateManagerBody ────────────────────────────────────────────────────────

describe('CreateManagerBody', () => {
  const valid = {
    email: 'john@acme.com',
    first_name: 'John',
    last_name: 'Doe',
    temp_password: 'Temp@1234',
  };

  it('accepts a body carrying only the required fields', () => {
    expect(parseWithContract(CreateManagerBody, valid)).toEqual(valid);
  });

  // Regression: trim happens before the email format check, matching the
  // validateCreateUserBody rule this replaced.
  it('accepts a whitespace-padded email and trims it', () => {
    expect(parseWithContract(CreateManagerBody, { ...valid, email: ' john@acme.com ' })).toEqual(
      valid,
    );
  });

  it('rejects a malformed email', () => {
    expect(() => parseWithContract(CreateManagerBody, { ...valid, email: 'nope' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a blank last_name', () => {
    expect(() => parseWithContract(CreateManagerBody, { ...valid, last_name: '  ' })).toThrow(
      ValidationError,
    );
  });

  it('rejects a whitespace-only temp_password', () => {
    expect(() => parseWithContract(CreateManagerBody, { ...valid, temp_password: '   ' })).toThrow(
      ValidationError,
    );
  });

  it('never trims temp_password, which reaches Cognito verbatim', () => {
    expect(
      parseWithContract(CreateManagerBody, { ...valid, temp_password: ' Temp@1 ' }).temp_password,
    ).toBe(' Temp@1 ');
  });

  // employee_count and org_admin_id are owned by the backend; a caller must not
  // be able to seed them at creation time.
  it('strips unknown fields so they cannot reach DynamoDB', () => {
    expect(
      parseWithContract(CreateManagerBody, { ...valid, employee_count: 9999, org_id: 'other' }),
    ).toEqual(valid);
  });
});

// ─── UpdateManagerBody ────────────────────────────────────────────────────────

describe('UpdateManagerBody', () => {
  it('accepts a partial update of a single field', () => {
    expect(parseWithContract(UpdateManagerBody, { first_name: 'Johnny' })).toEqual({
      first_name: 'Johnny',
    });
  });

  it('rejects an empty object — at least one field must be provided', () => {
    expect(() => parseWithContract(UpdateManagerBody, {})).toThrow(
      /at least one field must be provided/i,
    );
  });

  it('rejects a whitespace-only first_name', () => {
    expect(() => parseWithContract(UpdateManagerBody, { first_name: ' ' })).toThrow(
      ValidationError,
    );
  });

  it('accepts an empty phone, which clears the field', () => {
    expect(parseWithContract(UpdateManagerBody, { phone: '' })).toEqual({ phone: '' });
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
    rawPath: '/org-admin/managers',
    headers: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'orgadmin-sub-1', 'cognito:groups': 'OrgAdmin' } } },
      http: { method, path: '/org-admin/managers' },
    },
    isBase64Encoded: false,
    body: body ?? null,
    pathParameters,
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

beforeEach(() => vi.clearAllMocks());

describe('org-admin managers handler — contract-validated bodies', () => {
  it('rejects a POST missing temp_password before the service runs', async () => {
    const result = (await handler(
      buildEvent(
        'POST',
        JSON.stringify({ email: 'john@acme.com', first_name: 'John', last_name: 'Doe' }),
      ),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(createManager).not.toHaveBeenCalled();
  });

  it('hands the service the trimmed body on a valid POST', async () => {
    vi.mocked(createManager).mockResolvedValue({ manager_id: 'mgr-1' });

    const result = (await handler(
      buildEvent(
        'POST',
        JSON.stringify({
          email: ' john@acme.com ',
          first_name: ' John ',
          last_name: ' Doe ',
          temp_password: 'Temp@1234',
        }),
      ),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(201);
    expect(createManager).toHaveBeenCalledWith(
      'orgadmin-sub-1',
      {
        email: 'john@acme.com',
        first_name: 'John',
        last_name: 'Doe',
        temp_password: 'Temp@1234',
      },
      expect.anything(),
    );
  });

  it('rejects an empty PUT body with 400 before the service runs', async () => {
    const result = (await handler(
      buildEvent('PUT', JSON.stringify({}), { managerId: 'mgr-1' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(result.statusCode).toBe(400);
    expect(updateManager).not.toHaveBeenCalled();
  });

  it('strips employee_count from a PUT so the counter cannot be forged', async () => {
    vi.mocked(updateManager).mockResolvedValue({ manager_id: 'mgr-1' });

    await handler(
      buildEvent('PUT', JSON.stringify({ first_name: 'Johnny', employee_count: 9999 }), {
        managerId: 'mgr-1',
      }),
    );

    expect(updateManager).toHaveBeenCalledWith(
      'orgadmin-sub-1',
      'mgr-1',
      { first_name: 'Johnny' },
      expect.anything(),
    );
  });
});
