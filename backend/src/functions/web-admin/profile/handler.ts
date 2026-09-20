/**
 * Lambda handler for GET /web-admin/profile and PUT /web-admin/profile.
 *
 * Auth: `requireWebAdminWithLookup` enforces both Cognito group membership
 * (WebAdmin) and an ACTIVE DynamoDB record before any business logic runs.
 * Any other role — or a WebAdmin whose DynamoDB record is DISABLED — receives
 * a 403 before reaching the service layer.
 *
 * The handler is intentionally thin: route switching and OPTIONS handling live
 * here; all validation and DynamoDB logic live in service.ts and db.ts so they
 * can be unit-tested without mocking the Lambda event shape.
 */

import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { UpdateWebAdminProfileBody } from '@daltime/contracts';
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin, parseBody } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { getProfile, updateProfile } from './service.js';
import type { UpdateProfileRequest } from './model.js';

/** Shared Cognito client — initialised once per Lambda cold start. */
const cognitoClient = new CognitoIdentityProviderClient({});

/**
 * Handle PUT /web-admin/profile: parse the request body and delegate to the
 * service layer. Returns the full updated profile on success.
 */
async function handlePut(rawBody: string | undefined, sub: string) {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(UpdateWebAdminProfileBody, parsed.data);
  return ok(await updateProfile(sub, body));
}

/**
 * Main Lambda entrypoint — routes GET and PUT to service functions after
 * verifying the caller is an ACTIVE WebAdmin.
 */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;

  // OPTIONS short-circuit: return CORS headers without auth so browsers can
  // send preflight requests for this route.
  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    // Fail closed: verify Cognito group + DynamoDB record before any read/write.
    // `requireWebAdminWithLookup` throws ForbiddenError (→ 403) if the caller is
    // not an ACTIVE, provisioned WebAdmin.
    const caller = await requireWebAdminWithLookup(event);

    if (method === 'GET') {
      return ok(await getProfile(caller.sub, cognitoClient));
    }

    if (method === 'PUT') {
      return await handlePut(event.body, caller.sub);
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'web-admin profile handler');
  }
};
