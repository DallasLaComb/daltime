import * as z from 'zod';
import { IsoTimestamp } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';

/**
 * Location record stored in DynamoDB. Replaces
 * `backend/src/functions/shared/models/manager/location.model.ts`.
 *
 *   PK = ORG#<org_id>
 *   SK = LOCATION#<location_id>
 *
 * Listed via the base table (PK = ORG#<org_id>, SK begins_with 'LOCATION#') —
 * no GSI entry, because locations are only ever read within one org.
 */
export const LocationRecord = SingleTableKeys.extend({
  location_id: z.string(),
  org_id: z.string(),
  name: z.string(),
  address: z.string().optional(),
  created_by: z.string().meta({ description: 'user_id of the creator.' }),
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp.optional(),
});

export const LocationApiFields = apiShapeOf(LocationRecord);

/** Which kind of user a location assignment belongs to. */
export const UserLocationType = z
  .enum(['MANAGER', 'EMPLOYEE'])
  .meta({ id: 'UserLocationType', description: 'Kind of user a location is assigned to.' });

/**
 * A user–location assignment record. Replaces
 * `shared/models/org-admin/user-location.model.ts`.
 *
 * One record per assignment:
 *   PK = USER#<user_id>
 *   SK = LOCATION#<location_id>
 *
 * Query all locations for a user:
 *   PK = USER#<user_id> AND begins_with(SK, 'LOCATION#')
 */
export const UserLocationRecord = SingleTableKeys.extend({
  user_id: z.string(),
  user_type: UserLocationType,
  location_id: z.string(),
  location_name: z.string().meta({ description: 'Denormalized for cheap reads.' }),
  org_id: z.string(),
  assigned_by: z.string().meta({ description: 'OrgAdmin user_id who made the assignment.' }),
  assigned_at: IsoTimestamp,
});

export const UserLocationApiFields = apiShapeOf(UserLocationRecord);

export type LocationRecord = z.infer<typeof LocationRecord>;
export type LocationApiFields = z.infer<typeof LocationApiFields>;
export type UserLocationRecord = z.infer<typeof UserLocationRecord>;
export type UserLocationApiFields = z.infer<typeof UserLocationApiFields>;
