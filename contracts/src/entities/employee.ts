import * as z from 'zod';
import { IsoTimestamp, UserStatus } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';

/**
 * Employee record stored in DynamoDB. Replaces
 * `backend/src/functions/shared/models/org-admin/employee.model.ts`.
 *
 * Primary (scoped to org — supports listing by org):
 *   PK     = ORG#<org_id>
 *   SK     = EMPLOYEE#<employee_id>
 *   GSI1PK = EMPLOYEE
 *   GSI1SK = <created_at>
 *
 * Reverse-lookup (resolves org_id from a Cognito sub alone):
 *   PK     = USER#<employee_id>
 *   SK     = METADATA
 */
export const EmployeeRecord = SingleTableKeys.extend({
  employee_id: z.string().meta({ description: 'Cognito sub.' }),
  first_name: z.string(),
  last_name: z.string(),
  email: z.email(),
  phone: z.string().meta({ description: 'Empty string if not provided.' }),
  org_id: z.string(),
  manager_id: z.string().meta({ description: 'Manager this employee reports to.' }),
  employee_number: z.string().max(50).optional().meta({ description: 'Optional human-assigned employee number.' }),
  status: UserStatus,
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp,
});

/** Employee fields visible over the wire — the stored record minus its key attributes. */
export const EmployeeApiFields = apiShapeOf(EmployeeRecord);

/**
 * Employee as web-admin sees them: cross-org, so the owning organization's name
 * is joined in. Replaces `shared/models/web-admin/employee.model.ts`.
 *
 * `manager_id` is absent because the web-admin listing does not surface
 * reporting lines — it is an org-level inventory view.
 */
export const WebAdminEmployeeApiFields = EmployeeApiFields.omit({ manager_id: true }).extend({
  org_name: z.string().meta({ description: 'Joined from the ORG#<org_id> METADATA record.' }),
});

export type EmployeeRecord = z.infer<typeof EmployeeRecord>;
export type EmployeeApiFields = z.infer<typeof EmployeeApiFields>;
export type WebAdminEmployeeApiFields = z.infer<typeof WebAdminEmployeeApiFields>;
