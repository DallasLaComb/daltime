/**
 * The route-drift checker (`contracts/scripts/check-routes.mjs`) is what stops
 * `infra/template.yaml` and `contracts/openapi.json` disagreeing about which routes
 * exist. A checker that silently passes is worse than none, so pin its parsing and
 * every failure mode it exists to catch.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — plain .mjs script with no type declarations
import { templateRoutes, contractRoutes, diffRoutes } from '../../../../contracts/scripts/check-routes.mjs';

const repoRoot = resolve(__dirname, '../../../..');

const YAML = `
Resources:
  Fn:
    Events:
      GetThing:
        Type: HttpApi
        Properties:
          Path: /manager/thing
          Method: GET
          ApiId: !Ref Api
      OptionsThing:
        Type: HttpApi
        Properties:
          Path: /manager/thing
          Method: OPTIONS
          ApiId: !Ref Api
          Auth:
            Authorizer: NONE
      PutThing:
        Type: HttpApi
        Properties:
          Path: /manager/thing/{id}
          Method: put
          ApiId: !Ref Api
`;

describe('templateRoutes', () => {
  it('reads Path/Method, uppercases the method and skips OPTIONS preflight', () => {
    expect(templateRoutes(YAML)).toEqual(['GET /manager/thing', 'PUT /manager/thing/{id}']);
  });

  it('throws rather than silently skipping an event it cannot read', () => {
    const broken = 'Events:\n  X:\n    Type: HttpApi\n    Properties:\n      ApiId: !Ref Api\n';
    expect(() => templateRoutes(broken)).toThrow(/Could not read Path\/Method/);
  });

  it('reads every HttpApi event in the real template', () => {
    const yaml = readFileSync(resolve(repoRoot, 'infra/template.yaml'), 'utf8');
    const events = (yaml.match(/^\s+Type:\s*HttpApi\s*$/gm) ?? []).length;
    const preflight = (yaml.match(/^\s+Method:\s*OPTIONS\s*$/gm) ?? []).length;
    expect(templateRoutes(yaml)).toHaveLength(events - preflight);
  });
});

describe('contractRoutes', () => {
  it('flattens paths × methods into METHOD /path', () => {
    const doc = { paths: { '/a': { get: {}, put: {} }, '/b/{id}': { delete: {} } } };
    expect(contractRoutes(doc)).toEqual(['GET /a', 'PUT /a', 'DELETE /b/{id}']);
  });
});

describe('diffRoutes', () => {
  const allowed = new Map([['GET /proxy/{p+}', 'why']]);

  it('is clean when both sides agree (allowed template-only routes excepted)', () => {
    const d = diffRoutes(['GET /a', 'GET /proxy/{p+}'], ['GET /a'], allowed);
    expect(d).toEqual({ missingFromContract: [], missingFromTemplate: [], staleAllowances: [] });
  });

  it('flags a template route that has no contract operation', () => {
    expect(diffRoutes(['GET /a', 'POST /new'], ['GET /a'], allowed).missingFromContract).toEqual([
      'POST /new',
    ]);
  });

  it('flags a contract operation with no template route', () => {
    expect(diffRoutes(['GET /a'], ['GET /a', 'DELETE /ghost'], allowed).missingFromTemplate).toEqual([
      'DELETE /ghost',
    ]);
  });

  it('flags an allowance that is no longer needed', () => {
    const d = diffRoutes(['GET /a', 'GET /proxy/{p+}'], ['GET /a', 'GET /proxy/{p+}'], allowed);
    expect(d.staleAllowances).toEqual(['GET /proxy/{p+}']);
  });
});

describe('the real template and contract', () => {
  it('have no drift', () => {
    const yaml = readFileSync(resolve(repoRoot, 'infra/template.yaml'), 'utf8');
    const openapi = JSON.parse(readFileSync(resolve(repoRoot, 'contracts/openapi.json'), 'utf8'));
    const d = diffRoutes(templateRoutes(yaml), contractRoutes(openapi));
    expect(d).toEqual({ missingFromContract: [], missingFromTemplate: [], staleAllowances: [] });
  });
});
