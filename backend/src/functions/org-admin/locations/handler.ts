import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { CreateOrgAdminLocationBody, UpdateOrgAdminLocationBody } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, created, badRequest, setRequestOrigin, parseBody } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { getLocations, createLocation, updateLocation, removeLocation } from './service.js';

async function handlePost(callerSub: string, rawBody: string | undefined) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(CreateOrgAdminLocationBody, parsed.data);
  return created(await createLocation(callerSub, body));
}

async function handlePut(callerSub: string, locationId: string, rawBody: string | undefined) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(UpdateOrgAdminLocationBody, parsed.data);
  return ok(await updateLocation(callerSub, locationId, body));
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const locationId = event.pathParameters?.['locationId'];

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  const callerSub = getCallerSub(event);

  try {
    if (method === 'GET') return ok(await getLocations(callerSub));
    if (method === 'POST') return await handlePost(callerSub, event.body);
    if (method === 'PUT' && locationId) return await handlePut(callerSub, locationId, event.body);
    if (method === 'DELETE' && locationId) {
      await removeLocation(callerSub, locationId);
      return ok('');
    }
    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'org-admin locations handler');
  }
};
