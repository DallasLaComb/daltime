import type { z } from '@daltime/contracts';
import { parseWithContract } from '../../../src/functions/shared/contract-validation.js';
import { ValidationError } from '../../../src/functions/shared/errors.js';

/**
 * The exact 400 message a handler returns when `input` violates `schema`.
 *
 * Handlers validate through `parseWithContract`, so the message is derived from
 * the contract schema itself. Handler tests use this instead of hard-coding Zod
 * wording: changing a schema's rules or messages updates the expectation
 * automatically, and if `input` turns out to be VALID under the contract the
 * helper throws so the test fails loudly rather than asserting on nothing.
 */
export function contractErrorMessage(schema: z.ZodType, input: unknown): string {
  try {
    parseWithContract(schema, input);
  } catch (error) {
    if (error instanceof ValidationError) return error.message;
    throw error;
  }
  throw new Error('contractErrorMessage: input is valid under the contract schema');
}
