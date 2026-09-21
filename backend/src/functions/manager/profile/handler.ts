import { UpdateManagerProfileBody, type ManagerProfileResponse } from '@daltime/contracts';
import { createProfileHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';
import { withImpersonation } from '../../shared/impersonation.js';
import { withLogging } from '../../shared/with-logging.js';

// Pass 'Manager' so the factory rejects non-Manager callers with 403 before
// any DynamoDB lookup — prevents an Employee JWT from reaching a 404 code path.
//
// UpdateManagerProfileBody is the same schema that generates this route's entry
// in contracts/openapi.json, so the request validation here and the published
// contract cannot disagree.
const handleRequest = createProfileHandler<ManagerProfileResponse>(
  service,
  'manager profile handler',
  'Manager',
  UpdateManagerProfileBody,
);

/** A WebAdmin may call this route as another user via `X-Impersonate-User` (read-only). */
export const handler = withLogging(withImpersonation(handleRequest), 'manager-profile');
