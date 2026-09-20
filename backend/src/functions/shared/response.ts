import type { APIGatewayProxyResultV2 } from 'aws-lambda';

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] || 'http://localhost:4200')
  .split(',')
  .map((o) => o.trim());

let requestOrigin: string = ALLOWED_ORIGINS[0];

export function setRequestOrigin(origin?: string): void {
  requestOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': requestOrigin,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Impersonate-User',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

export function ok(data: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(data) };
}

export function created(data: unknown): APIGatewayProxyResultV2 {
  return { statusCode: 201, headers: corsHeaders(), body: JSON.stringify(data) };
}

export function noContent(): APIGatewayProxyResultV2 {
  return { statusCode: 204, headers: corsHeaders(), body: '' };
}

export function badRequest(message = 'Bad request'): APIGatewayProxyResultV2 {
  return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

export function conflict(message = 'Conflict'): APIGatewayProxyResultV2 {
  return { statusCode: 409, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

export function forbidden(message = 'Forbidden'): APIGatewayProxyResultV2 {
  return { statusCode: 403, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

export function notFound(message = 'Not found'): APIGatewayProxyResultV2 {
  return { statusCode: 404, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

export function methodNotAllowed(method: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 405,
    headers: corsHeaders(),
    body: JSON.stringify({ error: `Method Not Allowed: ${method}` }),
  };
}

export function internalError(message = 'Internal server error'): APIGatewayProxyResultV2 {
  return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

type ParseBodyResult<T> = { ok: true; data: T } | { ok: false; response: APIGatewayProxyResultV2 };

export function parseBody<T>(rawBody: string | undefined): ParseBodyResult<T> {
  if (!rawBody) return { ok: false, response: badRequest('Request body is required') };
  try {
    return { ok: true, data: JSON.parse(rawBody) as T };
  } catch {
    return { ok: false, response: badRequest('Invalid JSON body') };
  }
}
