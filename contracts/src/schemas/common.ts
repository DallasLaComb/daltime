import * as z from 'zod';

/**
 * Cognito user status, as surfaced on API responses.
 *
 * The backend entity models type this as a bare `string`; the frontend models
 * already narrowed it to these three values. The narrower type is kept here
 * because it is the one the UI actually branches on (see `core/utils/user-status.ts`).
 */
export const UserStatus = z
  .enum(['FORCE_CHANGE_PASSWORD', 'CONFIRMED', 'DISABLED'])
  .meta({ id: 'UserStatus', description: 'Cognito account status for a user.' });

/** ISO 8601 timestamp string, as stored in DynamoDB. */
export const IsoTimestamp = z.iso.datetime().meta({
  description: 'ISO 8601 timestamp.',
  example: '2026-02-23T18:04:11.000Z',
});

/**
 * The error body every handler returns on a non-2xx response.
 *
 * Shape comes from `backend/src/functions/shared/response.ts`, where each error
 * helper serialises `{ error: message }`.
 */
export const ErrorResponse = z
  .object({
    error: z.string().meta({ description: 'Human-readable failure reason.' }),
  })
  .meta({ id: 'ErrorResponse', description: 'Standard error envelope.' });

/** Response entries reused across operations, so error shapes stay identical everywhere. */
export const errorResponses = {
  400: {
    description: 'Request was malformed or failed validation.',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  403: {
    description: "Caller lacks the required role, or their organization could not be resolved.",
    content: { 'application/json': { schema: ErrorResponse } },
  },
  404: {
    description: 'The requested record does not exist.',
    content: { 'application/json': { schema: ErrorResponse } },
  },
  500: {
    description: 'Unexpected server error.',
    content: { 'application/json': { schema: ErrorResponse } },
  },
} as const;

export type ErrorResponse = z.infer<typeof ErrorResponse>;
export type UserStatus = z.infer<typeof UserStatus>;
