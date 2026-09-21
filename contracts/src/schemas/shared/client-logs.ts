import * as z from 'zod';
import { registerOperation, noDynamoAccess } from '../../registry.js';

const IMPLEMENTATION = [
  'backend/src/functions/shared/client-logs/handler.ts',
  'backend/src/functions/shared/client-logs/service.ts',
];

const EntryType = z.enum([
  'log',
  'error',
  'click',
  'navigation',
  'rage_click',
  'session_start',
  'viewport_change',
]);

const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);

const Breakpoint = z.enum(['base', 'sm', 'md', 'lg', 'xl', '2xl']);

const Orientation = z.enum(['portrait', 'landscape']);

const Viewport = z.object({
  w: z.number().int().min(0).max(9999),
  h: z.number().int().min(0).max(9999),
});

const Breadcrumb = z.object({
  type: z.enum(['click', 'navigation']),
  target: z.string().max(100).optional(),
  ts: z.string().max(30).optional(),
});

const SessionInfo = z.object({
  user_agent: z.string().max(200),
  screen: Viewport,
  dpr: z.number().min(0).max(10),
  touch: z.boolean(),
  lang: z.string().max(20).optional(),
  tz: z.string().max(50).optional(),
});

const HttpInfo = z.object({
  method: z.string().max(10),
  path: z.string().max(200),
  status: z.number().int().min(100).max(599),
});

export const ClientLogEntry = z.object({
  type: EntryType,
  level: LogLevel,
  ts: z.string().max(30),
  seq: z.number().int().min(0),
  route: z.string().max(200).optional(),
  viewport: Viewport.optional(),
  breakpoint: Breakpoint.optional(),
  orientation: Orientation.optional(),
  message: z.string().max(500).optional(),
  stack: z.string().max(2000).optional(),
  http: HttpInfo.optional(),
  target: z.string().max(100).optional(),
  tag: z.string().max(50).optional(),
  x: z.number().min(-9999).max(9999).optional(),
  y: z.number().min(-9999).max(9999).optional(),
  breadcrumbs: z.array(Breadcrumb).max(20).optional(),
  session: SessionInfo.optional(),
});

const ClientContext = z.object({
  client_session_id: z.string().max(64),
  platform: z.enum(['web', 'ios', 'android']),
  device_type: z.enum(['mobile', 'tablet', 'desktop']),
  os: z.enum(['ios', 'android', 'windows', 'macos', 'linux', 'other']),
  browser: z.string().max(30),
  is_native: z.boolean().optional(),
  app_version: z.string().max(20).optional(),
  authenticated: z.boolean().optional(),
  role: z.string().max(20).optional(),
  org_id: z.string().max(64).optional(),
  impersonating: z.boolean().optional(),
});

export const ClientLogBatch = z.object({
  context: ClientContext,
  entries: z.array(ClientLogEntry).min(1).max(25),
});

registerOperation('post', '/shared/client-logs', {
  operationId: 'postClientLogs',
  summary: 'Batch-ingest client log entries',
  tags: ['shared'],
  purpose:
    'Authenticated endpoint for the Angular/Capacitor frontend to batch-ship client-side log entries ' +
    'into CloudWatch via the same Powertools logger used by the backend. The server stamps caller_sub ' +
    'and caller_role from the verified JWT; client-supplied identity fields are stored as untrusted ' +
    'context only. Returns 204 on success.',
  implementation: IMPLEMENTATION,
  dynamodb: noDynamoAccess,
  requestBody: {
    required: true,
    content: { 'application/json': { schema: ClientLogBatch } },
  },
  responses: {
    204: { description: 'Log entries accepted and ingested.' },
    400: { description: 'Validation failed.' },
  },
});

export type ClientLogEntry = z.infer<typeof ClientLogEntry>;
export type ClientLogBatch = z.infer<typeof ClientLogBatch>;
