import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { badRequest, conflict, notFound, forbidden, internalError } from './response.js';
import { logger, serializeError } from './logger.js';

export class ValidationError extends Error {}
export class ConflictError extends Error {}
export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}

export function mapHandlerError(err: unknown, context: string): APIGatewayProxyResultV2 {
  if (err instanceof ValidationError) {
    logger.warn(`${context}: validation error`, { error_name: err.name, error_message: err.message });
    return badRequest(err.message);
  }
  if (err instanceof ConflictError) {
    logger.warn(`${context}: conflict`, { error_name: err.name, error_message: err.message });
    return conflict(err.message);
  }
  if (err instanceof NotFoundError) {
    logger.warn(`${context}: not found`, { error_name: err.name, error_message: err.message });
    return notFound(err.message);
  }
  if (err instanceof ForbiddenError) {
    logger.warn(`${context}: forbidden`, { error_name: err.name, error_message: err.message });
    return forbidden(err.message);
  }
  logger.error(`Unhandled error in ${context}`, { error: serializeError(err) });
  return internalError('An unexpected error occurred');
}
