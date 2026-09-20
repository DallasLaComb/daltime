import * as z from 'zod';
import { IsoTimestamp, UserStatus } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';

/**
 * Manager record as stored in DynamoDB. Replaces
 * `backend/src/functions/shared/models/org-admin/manager.model.ts`.
 *
 * Two records are written per manager:
 *
 * Primary (scoped to org — supports listing by org):
 *   PK     = ORG#<org_id>
 *   SK     = MANAGER#<manager_id>
 *   GSI1PK = MANAGER
 *   GSI1SK = <created_at>
 *
 * Reverse-lookup (supports GET/PUT/DELETE by managerId alone):
 *   PK     = USER#<manager_id>
 *   SK     = METADATA
 *   org_id = <org_id>
 */
export const ManagerRecord = SingleTableKeys.extend({
  manager_id: z.string().meta({ description: 'Cognito sub.' }),
  first_name: z.string(),
  last_name: z.string(),
  email: z.email(),
  phone: z.string().meta({ description: 'Empty string if not provided.' }),
  org_id: z.string(),
  org_admin_id: z.string().meta({ description: 'OrgAdmin who created this manager.' }),
  status: UserStatus,
  employee_count: z
    .int()
    .nonnegative()
    .meta({ description: 'Atomic counter, managed by the employees Lambda.' }),
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
});

/** The manager fields visible over the wire — the stored record minus its key attributes. */
export const ManagerApiFields = apiShapeOf(ManagerRecord);

export type ManagerRecord = z.infer<typeof ManagerRecord>;
export type ManagerApiFields = z.infer<typeof ManagerApiFields>;


