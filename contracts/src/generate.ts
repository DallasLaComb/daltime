/**
 * Generates `contracts/openapi.json` from the registered Zod schemas.
 *
 * Run via `npm run generate` in `contracts/`. The output is committed so that
 * contract changes show up as reviewable diffs in a PR, and so CI can fail the
 * build when the committed file drifts from the schemas (see `.github/workflows/ci.yml`).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDocument } from 'zod-openapi';

import { getRegisteredPaths, getRegisteredOperationCount } from './registry.js';
// Importing the barrel runs every schema module's `registerOperation` calls.
import './index.js';

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'openapi.json');

const document = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'DalTime API',
    version: '1.0.0',
    description:
      'Generated from the Zod schemas in `contracts/src/schemas`. Do not edit by hand — run ' +
      '`npm run generate` in `contracts/` instead.\n\n' +
      'Beyond the standard OpenAPI fields, every operation carries two vendor extensions:\n' +
      '- `x-implementation-path`: the repo-relative files implementing it.\n' +
      '- `x-dynamodb-access`: the real DynamoDB commands and key conditions it issues, so the ' +
      'full set of access patterns can be read from this file alone.',
  },
  servers: [
    { url: 'http://localhost:47200', description: 'SAM local (see backend/package.json start)' },
    { url: 'https://dev.daltime.com', description: 'dev' },
    { url: 'https://qa.daltime.com', description: 'qa' },
    { url: 'https://daltime.com', description: 'prod' },
  ],
  tags: [
    { name: 'employee', description: 'Routes callable by the Employee role.' },
    { name: 'manager', description: 'Routes callable by the Manager role.' },
    { name: 'org-admin', description: 'Routes callable by the OrgAdmin role.' },
    { name: 'web-admin', description: 'Routes callable by the WebAdmin role.' },
    { name: 'shared', description: 'Routes callable by more than one role.' },
  ],
  components: {
    securitySchemes: {
      cognitoJwt: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Cognito access token. Attached by the frontend auth interceptor and validated by the ' +
          'HttpApi JWT authorizer configured in `infra/template.yaml`.',
      },
    },
  },
  security: [{ cognitoJwt: [] }],
  paths: getRegisteredPaths(),
});

writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const operations = getRegisteredOperationCount();
const schemas = Object.keys(document.components?.schemas ?? {}).length;
console.log(`Wrote ${OUTPUT}`);
console.log(`  ${operations} operation(s), ${schemas} schema component(s)`);
