import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject } from 'zod-openapi';

/**
 * HTTP methods an operation can be registered under.
 *
 * `options` is deliberately absent: every route in `infra/template.yaml` has a
 * companion OPTIONS event for CORS preflight, but those carry no request or
 * response shape and no DynamoDB access. Registering them would add ~30 empty
 * operations and dilute the access-pattern audit this file exists to serve.
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * One real DynamoDB access issued while serving an operation.
 *
 * This is the "actual query" half of the goal: a reader must be able to answer
 * "what queries does this API need to support?" from `openapi.json` alone,
 * without opening the ~20 scattered `db.ts` files.
 */
export interface DynamoAccess {
  /** The DocumentClient command issued, e.g. `Query`, `Get`, `Update`. */
  command: 'Get' | 'Query' | 'Put' | 'Update' | 'Delete' | 'BatchGet' | 'BatchWrite' | 'Transact';
  /** Index used. Omit for the base table. */
  index?: 'GSI1';
  /**
   * Key condition exactly as the request expresses it, with `<placeholders>`
   * for runtime values — e.g. `PK = ORG#<orgId> AND SK = MANAGER#<managerId>`.
   */
  keyCondition: string;
  /** Filter expression, if the request has one. */
  filter?: string;
  /** Why this access exists, when the key condition alone does not make it obvious. */
  note?: string;
}

/** The metadata the goal doc requires on every operation, over and above plain OpenAPI. */
export interface OperationMetadata {
  /**
   * Repo-relative paths of the handler/service/db code implementing this
   * operation, so the contract points straight at the implementation.
   */
  implementation: string[];
  /** Plain-language reason this operation exists and the screen it serves. */
  purpose: string;
  /**
   * Every DynamoDB access this operation performs, in order.
   *
   * Use an empty array only for operations that genuinely touch no table
   * (e.g. health) — `noDynamoAccess` documents that intent explicitly.
   */
  dynamodb: DynamoAccess[];
}

type RegisterInput = Omit<ZodOpenApiOperationObject, 'description'> & OperationMetadata;

const paths: ZodOpenApiPathsObject = {};
const seen = new Set<string>();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[contracts] ${message}`);
}

/**
 * Marker for operations that perform no DynamoDB access at all.
 *
 * Spelled explicitly so "this operation touches no table" is a stated fact in
 * the contract rather than indistinguishable from "nobody filled this in".
 */
export const noDynamoAccess: DynamoAccess[] = [];

/**
 * Register one API operation into the contract.
 *
 * The metadata arguments are required rather than optional on purpose. The goal
 * doc treats file-path / purpose / query as hard requirements, and a requirement
 * like that only survives 20+ slices and many sessions if omitting it fails
 * generation instead of silently producing a thinner spec.
 */
export function registerOperation(
  method: HttpMethod,
  path: string,
  { implementation, purpose, dynamodb, ...operation }: RegisterInput,
): void {
  const key = `${method.toUpperCase()} ${path}`;
  assert(!seen.has(key), `Duplicate operation registered: ${key}`);
  assert(path.startsWith('/'), `Path must start with '/': ${key}`);
  assert(purpose.trim().length > 0, `Operation is missing a purpose: ${key}`);
  assert(implementation.length > 0, `Operation lists no implementation files: ${key}`);
  for (const file of implementation) {
    assert(
      !file.startsWith('/') && !file.startsWith('.'),
      `Implementation paths must be repo-relative (got '${file}') for: ${key}`,
    );
  }

  seen.add(key);
  paths[path] ??= {};
  paths[path][method] = {
    ...operation,
    description: purpose,
    'x-implementation-path': implementation,
    'x-dynamodb-access': dynamodb,
  } as ZodOpenApiOperationObject;
}

/** All operations registered so far. Consumed by `generate.ts`. */
export function getRegisteredPaths(): ZodOpenApiPathsObject {
  return paths;
}

/** Number of registered operations — used by the generator's summary output. */
export function getRegisteredOperationCount(): number {
  return seen.size;
}
