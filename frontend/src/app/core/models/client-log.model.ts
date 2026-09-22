import type { paths } from '../generated/api';

type ClientLogsRequestBody = paths['/shared/client-logs']['post']['requestBody']['content']['application/json'];

export type ClientLogContext = ClientLogsRequestBody['context'];
export type ClientLogEntry = ClientLogsRequestBody['entries'][number];
export type ClientLogBatch = ClientLogsRequestBody;
export type ClientLogLevel = ClientLogEntry['level'];
