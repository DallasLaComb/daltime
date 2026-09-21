import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { CreateEmployeeBody, UpdateEmployeeBody } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import {
  ok,
  created,
  noContent,
  badRequest,
  setRequestOrigin,
  parseBody,
} from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import {
  listEmployees,
  createEmployee,
  updateEmployee,
  disableEmployee,
  enableEmployee,
} from './service.js';
import type { OrgAdminEmployeeListResponse, OrgAdminEmployeeResponse } from '@daltime/contracts';
import { withImpersonation } from '../../shared/impersonation.js';
import { withLogging } from '../../shared/with-logging.js';

const cognitoClient = new CognitoIdentityProviderClient({});

// CreateEmployeeBody / UpdateEmployeeBody are the same schemas that generate
// this route's entry in contracts/openapi.json, so the validation here and the
// published contract cannot disagree. They supersede the validateCreateUserBody
// checks the service used to run — a body the spec calls invalid is now
// rejected with a 400 before Cognito or DynamoDB is touched.
async function handlePost(callerSub: string, rawBody: string | undefined) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(CreateEmployeeBody, parsed.data);
  return created<OrgAdminEmployeeResponse>(await createEmployee(callerSub, body, cognitoClient));
}

async function handlePut(
  callerSub: string,
  employeeId: string | undefined,
  rawBody: string | undefined,
) {
  if (!employeeId) return badRequest('employeeId path parameter is required');
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(UpdateEmployeeBody, parsed.data);
  return ok<OrgAdminEmployeeResponse>(await updateEmployee(callerSub, employeeId, body, cognitoClient));
}

const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const employeeId = event.pathParameters?.employeeId;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  const callerSub = getCallerSub(event);

  try {
    if (method === 'GET') return ok<OrgAdminEmployeeListResponse>(await listEmployees(callerSub, cognitoClient));
    if (method === 'POST') return await handlePost(callerSub, event.body);
    if (method === 'PUT') return await handlePut(callerSub, employeeId, event.body);
    if (method === 'DELETE') {
      if (!employeeId) return badRequest('employeeId path parameter is required');
      await disableEmployee(callerSub, employeeId, cognitoClient);
      return noContent();
    }
    if (method === 'PATCH') {
      if (!employeeId) return badRequest('employeeId path parameter is required');
      await enableEmployee(callerSub, employeeId, cognitoClient);
      return noContent();
    }
    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'org-admin employees handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withLogging(withImpersonation(handleRequest), 'org-admin-employees');
