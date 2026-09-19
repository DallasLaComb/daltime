import * as z from 'zod';
import { IsoTimestamp, UserStatus } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';

/**
 * Organization record stored in DynamoDB. Replaces
 * `backend/src/functions/shared/models/web-admin/organization.model.ts`.
 *
 *   PK     = ORG#<org_id>
 *   SK     = METADATA
 *   GSI1PK = ORG
 *   GSI1SK = <created_at>
 *
 * GSI1 exists so web-admin can list every organization without a Scan.
 */
export const OrganizationRecord = SingleTableKeys.extend({
  org_id: z.string(),
  name: z.string(),
  address: z.string(),
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
  org_admin_count: z
    .int()
    .nonnegative()
    .meta({ description: 'Atomic counter maintained by the org-admins Lambda.' }),
});

export const OrganizationApiFields = apiShapeOf(OrganizationRecord);

/**
 * OrgAdmin user record. Replaces
 * `shared/models/web-admin/org-admin-user.model.ts`.
 *
 * Primary (scoped to org — supports listing by org):
 *   PK     = ORG#<org_id>
 *   SK     = USER#<user_id>
 *   GSI1PK = ORG_ADMIN
 *   GSI1SK = <created_at>
 *
 * Reverse-lookup (supports GET/DELETE by userId alone):
 *   PK     = USER#<user_id>
 *   SK     = METADATA
 */
export const OrgAdminUserRecord = SingleTableKeys.extend({
  user_id: z.string().meta({ description: 'Cognito sub.' }),
  email: z.email(),
  name: z.string(),
  org_id: z.string(),
  status: UserStatus,
  created_at: IsoTimestamp,
});

export const OrgAdminUserApiFields = apiShapeOf(OrgAdminUserRecord);

export type OrganizationRecord = z.infer<typeof OrganizationRecord>;
export type OrganizationApiFields = z.infer<typeof OrganizationApiFields>;
export type OrgAdminUserRecord = z.infer<typeof OrgAdminUserRecord>;
export type OrgAdminUserApiFields = z.infer<typeof OrgAdminUserApiFields>;
