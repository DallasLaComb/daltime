import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { UpdateOrgAdminProfileBody } from '@daltime/contracts';
import { getCallerSub } from '../../shared/auth.js';
import { ok, badRequest, setRequestOrigin, parseBody } from '../../shared/response.js';
import { mapHandlerError } from '../../shared/errors.js';
import { parseWithContract } from '../../shared/contract-validation.js';
import { getProfile, updateProfile } from './service.js';
import type { OrgAdminProfileResponse } from '@daltime/contracts';

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  const callerSub = getCallerSub(event);

  try {
    if (method === 'GET') {
      return ok<OrgAdminProfileResponse>(await getProfile(callerSub, cognitoClient));
    }

    if (method === 'PUT') {
      const parsed = parseBody<Record<string, unknown>>(event.body);
      if (!parsed.ok) return parsed.response;
      const body = parseWithContract(UpdateOrgAdminProfileBody, parsed.data);
      return ok<OrgAdminProfileResponse>(await updateProfile(callerSub, body, cognitoClient));
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'org-admin profile handler');
  }
};
