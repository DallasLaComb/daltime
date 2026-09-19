import * as z from 'zod';
import { registerOperation, noDynamoAccess } from '../../registry.js';

const IMPLEMENTATION = ['backend/src/functions/shared/health/handler.ts'];

/**
 * Heartbeat payload. No entity backs this — `/health` touches no table at all,
 * so there is nothing in `entities/` to derive this from.
 */
export const HealthResponse = z
  .object({
    status: z.literal('ok'),
  })
  .meta({
    id: 'HealthResponse',
    description: 'Confirms the API Gateway route and Lambda runtime are reachable.',
  });

registerOperation('get', '/health', {
  operationId: 'getHealth',
  summary: 'Public heartbeat check',
  tags: ['shared'],
  purpose:
    'Public smoke-test target with no auth requirement, hit by CI/CD post-deploy checks ' +
    '(frontend/src/environments + deploy workflows) to confirm the HttpApi route and Lambda ' +
    'runtime are alive after a deployment. The handler wraps its body in a try/catch that always ' +
    'returns a shaped 200, even on an internal error, so the heartbeat itself never reports a ' +
    'false negative.',
  implementation: IMPLEMENTATION,
  dynamodb: noDynamoAccess,
  responses: {
    200: {
      description: 'Runtime is alive.',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

export type HealthResponse = z.infer<typeof HealthResponse>;
