import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { CreateOrganizationBody, UpdateOrganizationBody } from '@daltime/contracts';
import {
  ok,
  created,
  noContent,
  badRequest,
  notFound,
  setRequestOrigin,
  parseBody,
} from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  deleteOrganization,
} from './service.js';

/** Handle POST /organizations — create a new organization. */
async function handlePost(rawBody: string | undefined, webAdminId: string) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(CreateOrganizationBody, parsed.data);
  return created(await createOrganization(body, webAdminId));
}

/** Handle PUT /organizations/{orgId} — update an existing organization. */
async function handlePut(orgId: string, rawBody: string | undefined, webAdminId: string) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(UpdateOrganizationBody, parsed.data);
  const org = await updateOrganization(orgId, body, webAdminId);
  return org ? ok(org) : notFound(`Organization '${orgId}' not found`);
}

/** Handle collection-level routes (no orgId in path). */
async function handleCollectionRoute(
  method: string,
  rawBody: string | undefined,
  rawPath: string,
  webAdminId: string,
) {
  if (method === 'GET') return ok(await listOrganizations());
  if (method === 'POST') return await handlePost(rawBody, webAdminId);
  return badRequest(`Unhandled route: ${method} ${rawPath}`);
}

/** Handle resource-level routes (orgId present in path). */
async function handleResourceRoute(
  method: string,
  orgId: string,
  rawBody: string | undefined,
  rawPath: string,
  webAdminId: string,
) {
  if (method === 'GET') {
    const org = await getOrganization(orgId);
    return org ? ok(org) : notFound(`Organization '${orgId}' not found`);
  }
  if (method === 'PUT') return await handlePut(orgId, rawBody, webAdminId);
  if (method === 'DELETE') {
    const deleted = await deleteOrganization(orgId, webAdminId);
    return deleted ? noContent() : notFound(`Organization '${orgId}' not found`);
  }
  return badRequest(`Unhandled route: ${method} ${rawPath}`);
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const orgId = event.pathParameters?.orgId;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    // Fail closed: verify the caller is in the WebAdmin Cognito group AND has
    // a provisioned, ACTIVE WebAdmin record in DynamoDB before any query or
    // mutation is allowed. Returns the caller's `web_admin_id` for audit
    // stamping on every mutating operation.
    const caller = await requireWebAdminWithLookup(event);

    if (!orgId)
      return await handleCollectionRoute(method, event.body, event.rawPath, caller.web_admin_id);
    return await handleResourceRoute(method, orgId, event.body, event.rawPath, caller.web_admin_id);
  } catch (err) {
    return mapHandlerError(err, 'web-admin organizations handler');
  }
};
