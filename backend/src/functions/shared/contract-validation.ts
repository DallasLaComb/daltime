import { ZodError, type z } from '@daltime/contracts';
import { ValidationError } from './errors.js';

/**
 * Turn a ZodError into the single-line message shape the API already returns.
 *
 * `response.ts` serialises errors as `{ error: string }`, and the frontend reads
 * `err.error.error` (see `core/utils/profile-base.ts`). Flattening to one string
 * keeps that contract intact rather than introducing a second error shape.
 */
function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/**
 * Validate a parsed request body against its contract schema.
 *
 * Throws `ValidationError`, which `mapHandlerError` already maps to a 400 — so
 * contract validation failures are indistinguishable from the hand-written
 * checks they replace, and no handler needs new error-handling code.
 */
export function parseWithContract<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(formatIssues(result.error));
  return result.data;
}
