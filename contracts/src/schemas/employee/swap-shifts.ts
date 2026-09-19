import * as z from 'zod';
import { ErrorResponse, errorResponses } from '../common.js';
import { SwapShiftApiFields } from '../../entities/swap-shift.js';
import { registerOperation } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/employee/swap-shifts/handler.ts',
  'backend/src/functions/employee/swap-shifts/service.ts',
  'backend/src/functions/employee/swap-shifts/db.ts',
];

/** Additionally writes a manager notification (best-effort, non-blocking). */
const IMPLEMENTATION_WITH_NOTIFY = [
  ...IMPLEMENTATION,
  'backend/src/functions/shared/notifications/db.ts',
];

/**
 * `409` isn't in the shared `errorResponses` map (only the pilot's 400/403/404/500
 * needed it), but every mutating swap-shifts route can return it — the listing
 * moved out of `open` (already claimed/cancelled) between read and write.
 */
const conflictResponse = {
  description: 'The swap listing is no longer open — already claimed, cancelled, or a duplicate.',
  content: { 'application/json': { schema: ErrorResponse } },
};

/**
 * A single swap listing as returned to the client.
 *
 * Named (rather than inlined per response) because all three swap responses
 * return this exact shape, and the frontend needs one type to hold a listing in
 * a signal — `ApiSchema<'SwapShift'>`.
 */
export const SwapShiftListing = SwapShiftApiFields.meta({
  id: 'SwapShift',
  description: 'A shift swap listing, with the shift’s details denormalized onto it.',
});

/**
 * Path parameter shared by the two `{swapId}` routes.
 *
 * The regex mirrors `service.ts`'s `SWAP_ID_REGEX` exactly — alphanumeric and
 * hyphens, 1–128 characters. A bare `z.string()` here would have understated
 * the route: the service already rejects anything else with a 400, and the
 * character restriction is what keeps a swapId out of a DynamoDB key
 * expression it has no business reaching.
 */
export const SwapShiftPathParams = z.object({
  swapId: z
    .string()
    .trim()
    .regex(
      /^[a-zA-Z0-9-]{1,128}$/,
      'swapId must contain only alphanumeric characters and hyphens (max 128 chars)',
    )
    .meta({ description: 'The swap listing’s swap_id.' }),
});

/**
 * `shift_id` validation mirrors `service.ts`'s `SHIFT_ID_REGEX` exactly:
 * alphanumeric and hyphens only, 1–128 characters. Restricting the character
 * set prevents injection into DynamoDB key expressions.
 */
export const PostSwapShiftBody = z
  .object({
    shift_id: z
      .string()
      .trim()
      .regex(
        /^[a-zA-Z0-9-]{1,128}$/,
        'shift_id must contain only alphanumeric characters and hyphens (max 128 chars)',
      ),
  })
  .meta({
    id: 'PostSwapShiftBody',
    description: 'Body for POST /employee/swap-shifts — the shift being offered for swap.',
  });

/** `GET /employee/swap-shifts` response: open listings from peers, plus the caller’s own history. */
export const SwapShiftsListResponse = z
  .object({
    available: z
      .array(SwapShiftListing)
      .meta({ description: 'Open listings posted by OTHER employees in the org, newest first.' }),
    mine: z
      .array(SwapShiftListing)
      .meta({
        description: 'All listings posted by the caller, any status (open/claimed/cancelled).',
      }),
  })
  .meta({
    id: 'SwapShiftsListResponse',
    description:
      'The two swap-shifts panels: what the caller can take, and what the caller has posted.',
  });

registerOperation('get', '/employee/swap-shifts', {
  operationId: 'listSwapShifts',
  summary: 'List open swap listings from peers and the caller’s own posted listings',
  tags: ['employee'],
  purpose:
    'Backs both panels of the swap-shifts screen (frontend/src/app/features/employee/swap-shifts): ' +
    '"Available to Take" (other employees’ open listings) and "My Posted Shifts" (the caller’s own, any status).',
  implementation: IMPLEMENTATION,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and employee_id; a missing record fails closed with 403.',
    },
    {
      command: 'Query',
      index: 'GSI1',
      keyCondition: 'GSI1PK = ORG_SWAP#<orgId> AND begins_with(GSI1SK, "STATUS#open#")',
      filter: 'posted_by_employee_id <> :callerId',
      note: 'The "available" list. Newest first (ScanIndexForward: false); excludes the caller’s own listings.',
    },
    {
      command: 'Query',
      keyCondition: 'PK = ORG#<orgId> AND begins_with(SK, "SWAP#")',
      filter: 'posted_by_employee_id = :employeeId',
      note: 'The "mine" list — base-table query scoped to the org partition, all statuses.',
    },
  ],
  responses: {
    200: {
      description: 'The caller’s available-to-take and posted swap listings.',
      content: { 'application/json': { schema: SwapShiftsListResponse } },
    },
    403: errorResponses[403],
    500: errorResponses[500],
  },
});

registerOperation('post', '/employee/swap-shifts', {
  operationId: 'postSwapShift',
  summary: 'Post one of the caller’s own published shifts for swap',
  tags: ['employee'],
  purpose:
    'Lets an employee offer a shift they no longer want for a coworker to claim. Notifies the shift’s ' +
    'manager (best-effort) once the listing is created.',
  implementation: IMPLEMENTATION_WITH_NOTIFY,
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id, employee_id, and display name; a missing record fails closed with 403.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Validates the shift exists, belongs to the caller, is published, and is not in the past.',
    },
    {
      command: 'Query',
      index: 'GSI1',
      keyCondition: 'GSI1PK = ORG_SWAP#<orgId> AND begins_with(GSI1SK, "STATUS#open#")',
      filter: 'shift_id = :shiftId AND posted_by_employee_id = :employeeId',
      note: 'Duplicate-post guard — rejects with 409 if the caller already has an open listing for this shift.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = EMPLOYEE#<employeeId>',
      note: 'Reads the caller’s manager_id (not present on the METADATA reverse-lookup) to denormalize onto the listing.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = ORG#<orgId> AND SK = SWAP#<swapId>',
      note: 'Creates the listing with GSI1SK = STATUS#open#<created_at>.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<managerId> AND SK = NOTIFICATION#<created_at>#<rawId>',
      note: 'Best-effort manager notification; a write failure here does not fail the request.',
    },
  ],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: PostSwapShiftBody } },
  },
  responses: {
    201: {
      description: 'The created swap listing.',
      content: { 'application/json': { schema: SwapShiftListing } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    409: conflictResponse,
    500: errorResponses[500],
  },
});

registerOperation('post', '/employee/swap-shifts/{swapId}/claim', {
  operationId: 'claimSwapShift',
  summary: 'Claim an open swap listing',
  tags: ['employee'],
  purpose:
    'Transfers an open listing’s shift to the claiming employee. Notifies the shift’s manager (best-effort) ' +
    'once the transfer succeeds.',
  implementation: IMPLEMENTATION_WITH_NOTIFY,
  requestParams: { path: SwapShiftPathParams },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id, employee_id, and display name; a missing record fails closed with 403.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SWAP#<swapId>',
      note:
        'Org-scoped, so a cross-org swapId returns null (404, not 403) — avoids leaking listing existence ' +
        'across orgs. Also rejects self-claim and non-open status.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = SWAP#<swapId>',
      filter: 'ConditionExpression: #status = :open',
      note:
        'Marks the listing claimed and flips GSI1SK to STATUS#claimed#<created_at>. The condition makes the ' +
        'claim atomic: a losing concurrent claimer gets ConditionalCheckFailedException, mapped to 409.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = SHIFT#<shiftId>',
      note: 'Transfers the shift’s employee_id/employee_name to the claimer. Run in parallel with the SWAP# update.',
    },
    {
      command: 'Put',
      keyCondition: 'PK = USER#<managerId> AND SK = NOTIFICATION#<created_at>#<rawId>',
      note: 'Best-effort manager notification; a write failure here does not fail the request.',
    },
  ],
  responses: {
    200: {
      description: 'The claimed swap listing.',
      content: { 'application/json': { schema: SwapShiftListing } },
    },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    409: conflictResponse,
    500: errorResponses[500],
  },
});

registerOperation('delete', '/employee/swap-shifts/{swapId}', {
  operationId: 'cancelSwapShift',
  summary: 'Cancel (unpost) a swap listing the caller posted',
  tags: ['employee'],
  purpose:
    'Lets the poster take a listing back off the board. The record is never deleted — its status moves ' +
    'to cancelled so history is preserved and it drops out of the "available" GSI query.',
  implementation: IMPLEMENTATION,
  requestParams: { path: SwapShiftPathParams },
  dynamodb: [
    {
      command: 'Get',
      keyCondition: 'PK = USER#<callerSub> AND SK = METADATA',
      note: 'Resolves the caller’s org_id and employee_id; a missing record fails closed with 403.',
    },
    {
      command: 'Get',
      keyCondition: 'PK = ORG#<orgId> AND SK = SWAP#<swapId>',
      note: 'Validates the listing exists, the caller is the original poster, and it is still open.',
    },
    {
      command: 'Update',
      keyCondition: 'PK = ORG#<orgId> AND SK = SWAP#<swapId>',
      note: 'Sets status = cancelled and flips GSI1SK to STATUS#cancelled#<created_at>.',
    },
  ],
  responses: {
    204: { description: 'The listing was cancelled.' },
    400: errorResponses[400],
    403: errorResponses[403],
    404: errorResponses[404],
    409: conflictResponse,
    500: errorResponses[500],
  },
});

export type PostSwapShiftBody = z.infer<typeof PostSwapShiftBody>;
export type SwapShiftListing = z.infer<typeof SwapShiftListing>;
export type SwapShiftPathParams = z.infer<typeof SwapShiftPathParams>;
export type SwapShiftsListResponse = z.infer<typeof SwapShiftsListResponse>;
