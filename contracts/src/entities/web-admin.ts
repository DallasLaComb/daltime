import * as z from 'zod';
import { IsoTimestamp } from '../schemas/common.js';
import { SingleTableKeys, apiShapeOf } from './keys.js';

/**
 * WebAdmin account state.
 *
 * Deliberately NOT `UserStatus`: a WebAdmin's stored status is an
 * application-level flag, not the Cognito account status the other roles carry.
 * `web-admin/profile` enriches this with the live Cognito status on read, which
 * is why its response type widens the field.
 */
export const WebAdminStatus = z
  .enum(['ACTIVE', 'DISABLED'])
  .meta({ id: 'WebAdminStatus', description: 'Stored WebAdmin account state.' });

/**
 * WebAdmin reverse-lookup record. Replaces
 * `backend/src/functions/shared/models/web-admin/web-admin.model.ts`.
 *
 *   PK = USER#<sub>
 *   SK = METADATA
 *
 * There is no org-scoped primary record and no GSI entry: WebAdmins are
 * cross-org and identified solely by Cognito sub, and no "list all WebAdmins"
 * access pattern exists in the application — that enumeration belongs at the
 * AWS/IAM layer for human operators.
 *
 * The record serves two purposes:
 *   1. Fail-closed gate — a missing record rejects the request with 403.
 *   2. Audit stamping — `web_admin_id` is written as `modified_by_web_admin_id`
 *      on every item a mutating web-admin service touches.
 */
export const WebAdminRecord = SingleTableKeys.extend({
  web_admin_id: z.string().meta({ description: 'WADMIN#<uuid> — stable audit identifier.' }),
  sub: z.string().meta({ description: 'Cognito sub; mirrors the PK suffix.' }),
  email: z.email(),
  first_name: z.string(),
  last_name: z.string(),
  entity_type: z.literal('WEB_ADMIN'),
  status: WebAdminStatus,
  created_at: IsoTimestamp,
  updated_at: IsoTimestamp.optional().meta({
    description: 'Absent on records created before updated_at was tracked.',
  }),
});

export const WebAdminApiFields = apiShapeOf(WebAdminRecord);

/**
 * The minimal caller shape auth and service layers pass around.
 *
 * `status` is included so `requireWebAdminWithLookup` can reject a DISABLED
 * caller with a 403 without re-fetching the full record.
 */
export const WebAdminCaller = WebAdminRecord.pick({
  sub: true,
  web_admin_id: true,
  email: true,
  status: true,
}).meta({ id: 'WebAdminCaller' });

export type WebAdminStatus = z.infer<typeof WebAdminStatus>;
export type WebAdminRecord = z.infer<typeof WebAdminRecord>;
export type WebAdminApiFields = z.infer<typeof WebAdminApiFields>;
export type WebAdminCaller = z.infer<typeof WebAdminCaller>;
