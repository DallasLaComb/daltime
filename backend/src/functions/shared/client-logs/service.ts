import type { ClientLogBatch } from '@daltime/contracts';
import { logger } from '../logger.js';

export function processClientLogs(
  batch: ClientLogBatch,
  callerSub: string,
  callerRole: string,
): void {
  const { context, entries } = batch;

  for (const entry of entries) {
    const message = entry.message ?? `client:${entry.type}`;

    const fields: Record<string, unknown> = {
      source: 'client',
      event_type: entry.type,
      caller_sub: callerSub,
      caller_role: callerRole,
      client_session_id: context.client_session_id,
      platform: context.platform,
      device_type: context.device_type,
      os: context.os,
      browser: context.browser,
      client_ts: entry.ts,
      seq: entry.seq,
    };

    if (entry.route !== undefined) fields['route'] = entry.route;
    if (entry.viewport !== undefined) fields['viewport'] = entry.viewport;
    if (entry.breakpoint !== undefined) fields['breakpoint'] = entry.breakpoint;
    if (entry.orientation !== undefined) fields['orientation'] = entry.orientation;
    if (entry.stack !== undefined) fields['stack'] = entry.stack;
    if (entry.http !== undefined) fields['http'] = entry.http;
    if (entry.target !== undefined) fields['target'] = entry.target;
    if (entry.tag !== undefined) fields['tag'] = entry.tag;
    if (entry.x !== undefined) fields['x'] = entry.x;
    if (entry.y !== undefined) fields['y'] = entry.y;
    if (entry.breadcrumbs !== undefined) fields['breadcrumbs'] = entry.breadcrumbs;
    if (entry.session !== undefined) fields['session'] = entry.session;
    if (context.is_native !== undefined) fields['is_native'] = context.is_native;
    if (context.app_version !== undefined) fields['app_version'] = context.app_version;

    logger[entry.level](message, fields);
  }
}
