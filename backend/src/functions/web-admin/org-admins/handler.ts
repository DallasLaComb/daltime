import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { CreateOrgAdminBody } from '@daltime/contracts';
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
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import { listOrgAdmins, createOrgAdmin, disableOrgAdmin, enableOrgAdmin } from './service.js';

const cognitoClient = new CognitoIdentityProviderClient({});

/** Handle POST /organizations/{orgId}/org-admins — create a new OrgAdmin. */
async function handlePost(orgId: string, rawBody: string | undefined, webAdminId: string) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(CreateOrgAdminBody, parsed.data);
  return created(await createOrgAdmin(orgId, body, cognitoClient, webAdminId));
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const orgId = event.pathParameters?.orgId;
  const userId = event.pathParameters?.userId;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  if (!orgId) return badRequest('orgId path parameter is required');

  try {
    // Fail closed: verify the caller is in the WebAdmin Cognito group AND has
    // a provisioned, ACTIVE WebAdmin record in DynamoDB before any query or
    // mutation is allowed. Returns the caller's `web_admin_id` for audit
    // stamping on every mutating operation.
    const caller = await requireWebAdminWithLookup(event);

    if (method === 'GET') return ok(await listOrgAdmins(orgId, cognitoClient));
    if (method === 'POST') return await handlePost(orgId, event.body, caller.web_admin_id);
    if (method === 'DELETE') {
      if (!userId) return badRequest('userId path parameter is required');
      await disableOrgAdmin(orgId, userId, cognitoClient, caller.web_admin_id);
      return noContent();
    }
    if (method === 'PATCH') {
      if (!userId) return badRequest('userId path parameter is required');
      await enableOrgAdmin(orgId, userId, cognitoClient, caller.web_admin_id);
      return noContent();
    }
    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'web-admin org-admins handler');
  }
};
