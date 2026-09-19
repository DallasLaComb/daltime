import { UpdateEmployeeProfileBody } from '@daltime/contracts';
import { createProfileHandler } from '../../shared/handler-factories.js';
import * as service from './service.js';

// Pass 'Employee' so the factory rejects non-Employee callers with 403 before
// any DynamoDB lookup — prevents a Manager JWT from reaching a 404 code path.
//
// UpdateEmployeeProfileBody is the same schema that generates this route's entry
// in contracts/openapi.json, so the request validation here and the published
// contract cannot disagree.
export const handler = createProfileHandler(
  service,
  'employee profile handler',
  'Employee',
  UpdateEmployeeProfileBody,
);
