import { Logger } from '@aws-lambda-powertools/logger';

export const logger = new Logger({
  serviceName: 'daltime-backend',
  logLevel: (process.env['POWERTOOLS_LOG_LEVEL'] ?? process.env['AWS_LAMBDA_LOG_LEVEL'] ?? 'INFO') as
    | 'DEBUG'
    | 'INFO'
    | 'WARN'
    | 'ERROR',
  persistentKeys: {
    env: process.env['ENVIRONMENT'] ?? 'local',
  },
});

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { error: String(err) };
}
