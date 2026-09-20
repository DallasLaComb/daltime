import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { CreateManagerBody, UpdateManagerBody } from '@daltime/contracts';
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
  listManagers,
  createManager,
  updateManager,
  disableManager,
  enableManager,
} from './service.js';
import type { OrgAdminManagerListResponse, OrgAdminManagerResponse } from '@daltime/contracts';
import { withImpersonation } from '../../shared/impersonation.js';

const cognitoClient = new CognitoIdentityProviderClient({});

// CreateManagerBody / UpdateManagerBody are the same schemas that generate this
// route's entry in contracts/openapi.json, so the validation here and the
// published contract cannot disagree. They supersede the validateCreateUserBody
// checks the service used to run.
async function handlePost(callerSub: string, rawBody: string | undefined) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(CreateManagerBody, parsed.data);
  return created<OrgAdminManagerResponse>(await createManager(callerSub, body, cognitoClient));
}

async function handlePut(
  callerSub: string,
  managerId: string | undefined,
  rawBody: string | undefined,
) {
  if (!managerId) return badRequest('managerId path parameter is required');
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(UpdateManagerBody, parsed.data);
  return ok<OrgAdminManagerResponse>(await updateManager(callerSub, managerId, body, cognitoClient));
}

const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const managerId = event.pathParameters?.managerId;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  const callerSub = getCallerSub(event);

  try {
    if (method === 'GET') return ok<OrgAdminManagerListResponse>(await listManagers(callerSub, cognitoClient));
    if (method === 'POST') return await handlePost(callerSub, event.body);
    if (method === 'PUT') return await handlePut(callerSub, managerId, event.body);
    if (method === 'DELETE') {
      if (!managerId) return badRequest('managerId path parameter is required');
      await disableManager(callerSub, managerId, cognitoClient);
      return noContent();
    }
    if (method === 'PATCH') {
      if (!managerId) return badRequest('managerId path parameter is required');
      await enableManager(callerSub, managerId, cognitoClient);
      return noContent();
    }
    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'org-admin managers handler');
  }
};

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withImpersonation(handleRequest);
