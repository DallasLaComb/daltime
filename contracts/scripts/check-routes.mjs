#!/usr/bin/env node
/**
 * `npm run check:routes` — fail when `infra/template.yaml` and `contracts/openapi.json`
 * disagree about which HTTP routes exist.
 *
 * Routes are declared ONLY in the SAM template, so nothing else stops a route from
 * shipping with no contract entry (invisible to the frontend types and the access-
 * pattern audit) or an operation from being documented for a route that does not
 * exist (a contract that lies). This diffs the two sets in both directions.
 *
 * CORS preflight (`OPTIONS`) events are skipped: `registry.ts` deliberately does not
 * register them.
 *
 * Intentional exceptions live in ALLOWED_UNDOCUMENTED below, each with a reason, so
 * a new gap has to be argued for in review rather than slipping in silently.
 *
 *   node contracts/scripts/check-routes.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Template routes that intentionally have no operation in the contract.
 * Matched exactly against `METHOD /path` as written in the template.
 */
const ALLOWED_UNDOCUMENTED = new Map([
  // Impersonation catch-all: not a call target. The frontend interceptor rewrites role
  // paths into it and route-registry.ts re-dispatches to already-documented role ops,
  // so enumerating it would duplicate every downstream operation. Removed by phase 3 of
  // the impersonation redesign (contracts/checklist.md §11).
  ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(
    (m) => [`${m} /web-admin/impersonate/{userId}/{proxy+}`, 'impersonation proxy (§9, §11)'],
  ),
]);

/** `METHOD /path` for every non-OPTIONS HttpApi event in the SAM template. */
export function templateRoutes(yaml) {
  const routes = [];
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s+Type:\s*HttpApi\s*$/.test(lines[i])) continue;
    let path;
    let method;
    // Path/Method sit within the event's Properties block, a few lines below.
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const p = lines[j].match(/^\s+Path:\s*(\S+)\s*$/);
      const m = lines[j].match(/^\s+Method:\s*(\S+)\s*$/);
      if (p) path = p[1];
      if (m) method = m[1].toUpperCase();
      if (path && method) break;
      if (/^\s+Type:\s/.test(lines[j])) break; // ran into the next event
    }
    if (!path || !method) {
      throw new Error(`Could not read Path/Method for the HttpApi event at template line ${i + 1}`);
    }
    if (method !== 'OPTIONS') routes.push(`${method} ${path}`);
  }
  return routes;
}

/** `METHOD /path` for every operation in the generated OpenAPI document. */
export function contractRoutes(openapi) {
  const routes = [];
  for (const [path, item] of Object.entries(openapi.paths)) {
    for (const method of Object.keys(item)) routes.push(`${method.toUpperCase()} ${path}`);
  }
  return routes;
}

/** Pure diff, exported so it can be unit-tested. */
export function diffRoutes(template, contract, allowed = ALLOWED_UNDOCUMENTED) {
  const t = new Set(template);
  const c = new Set(contract);
  return {
    missingFromContract: [...t].filter((r) => !c.has(r) && !allowed.has(r)).sort(),
    missingFromTemplate: [...c].filter((r) => !t.has(r)).sort(),
    staleAllowances: [...allowed.keys()].filter((r) => !t.has(r) || c.has(r)).sort(),
  };
}

function main() {
  const template = templateRoutes(readFileSync(resolve(repoRoot, 'infra/template.yaml'), 'utf8'));
  const contract = contractRoutes(JSON.parse(readFileSync(resolve(repoRoot, 'contracts/openapi.json'), 'utf8')));
  const { missingFromContract, missingFromTemplate, staleAllowances } = diffRoutes(template, contract);

  const problems = [];
  if (missingFromContract.length) {
    problems.push(
      `Routes in infra/template.yaml with NO contract operation:\n  ${missingFromContract.join('\n  ')}\n` +
        '  → register them under contracts/src/schemas/, or add to ALLOWED_UNDOCUMENTED with a reason.',
    );
  }
  if (missingFromTemplate.length) {
    problems.push(
      `Contract operations with NO route in infra/template.yaml:\n  ${missingFromTemplate.join('\n  ')}\n` +
        '  → add the API Gateway event, or remove the operation.',
    );
  }
  if (staleAllowances.length) {
    problems.push(
      `ALLOWED_UNDOCUMENTED entries that no longer apply:\n  ${staleAllowances.join('\n  ')}\n` +
        '  → delete them so the allowlist stays honest.',
    );
  }

  if (problems.length) {
    console.error(`[check:routes] ✗ template and contract disagree\n\n${problems.join('\n\n')}`);
    process.exit(1);
  }
  console.log(
    `[check:routes] ✓ ${contract.length} contract operations match the template ` +
      `(${ALLOWED_UNDOCUMENTED.size} documented exceptions).`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
