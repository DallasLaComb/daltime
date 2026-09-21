/**
 * Handler for POST /web-admin/generate-dummy-data.
 *
 * Generates dummy availability records and open shifts for a requested month
 * across all organizations in the system. Intended for dev/test data seeding.
 *
 * // TODO: wire to EventBridge scheduled rule on 1st of month for automated
 * // monthly data generation in dev/qa environments. For now this is a manual
 * // Web-Admin trigger only.
 *
 * Authorization: Web-Admin role required. The API Gateway JWT authorizer
 * validates the token signature; this handler additionally checks the
 * Cognito group membership so non-WebAdmin callers cannot reach the logic.
 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { GenerateDummyDataBody } from '@daltime/contracts';
import { ok, methodNotAllowed, setRequestOrigin, parseBody } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { requireWebAdminWithLookup } from '../../shared/auth.js';
import { generateDummyData } from './service.js';
import type { GenerateDummyDataResponse } from '@daltime/contracts';
import { withLogging } from '../../shared/with-logging.js';

/**
 * Handle POST /web-admin/generate-dummy-data.
 * Validates the body, enforces WebAdmin auth, and delegates to the service.
 */
async function handlePost(rawBody: string | undefined): Promise<ReturnType<typeof ok>> {
  const parsed = parseBody<Record<string, unknown>>(rawBody);
  if (!parsed.ok) return parsed.response;
  const body = parseWithContract(GenerateDummyDataBody, parsed.data);
  const message = await generateDummyData(body);
  return ok<GenerateDummyDataResponse>({ message });
}

/**
 * Lambda entrypoint for POST /web-admin/generate-dummy-data.
 *
 * Guards: OPTIONS short-circuit for CORS preflight, then WebAdmin role check
 * via requireWebAdminWithLookup (Cognito group + DynamoDB ACTIVE status) before
 * any routing or business logic runs.
 */
const handleRequest = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  try {
    // Fail closed: verify the caller is in the WebAdmin Cognito group AND has
    // an ACTIVE provisioned WebAdmin record in DynamoDB before any logic runs.
    // This prevents authenticated-but-not-web-admin callers from triggering
    // data generation, since the JWT authorizer only checks token validity, not
    // group membership.
    await requireWebAdminWithLookup(event);

    if (method === 'POST') {
      return await handlePost(event.body);
    }

    return methodNotAllowed(method);
  } catch (err) {
    return mapHandlerError(err, 'web-admin generate-dummy-data handler');
  }
};

export const handler = withLogging(handleRequest, 'web-admin-generate-dummy-data');
