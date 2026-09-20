# Contracts — DalTime API Specifications

Machine-readable API contracts for the DalTime backend. This folder is the **single source of truth** for the HTTP interface between the Angular frontend and the Lambda backend: routes, request bodies, response shapes, and error formats live here as version-controlled OpenAPI documents.

## Why this exists

- **Shared interface** — backend handlers, frontend services, and tests all reference the same spec instead of relying on tribal knowledge.
- **Reviewable changes** — route and schema changes show up as diffs in PRs, so breaking changes are caught in review, not at runtime.
- **Automated validation** — CI can lint the spec and run contract tests against SAM local before deploys.
- **Agent-friendly** — plain YAML that pipeline agents can read before implementing a feature.

## What goes here

- `openapi.yaml` — the OpenAPI 3.x spec covering every route registered in `infra/template.yaml`
- `schemas/` — (optional, if split out) reusable request/response component schemas mirroring `backend/src/models/`

## Relationship to the rest of the repo

| Artifact | Role |
| -------- | ---- |
| `infra/template.yaml` | Registers routes + OPTIONS events in SAM — the *deployed* truth |
| `contracts/` | Declares the contract for those routes — the *agreed* interface |
| `backend/src/functions/<role>/<feature>/` | Implements the contract |
| `backend/src/models/` | TypeScript models that must stay in sync with contract schemas |
| `bruno/` | Manually runnable requests for exercising the contract by hand |

## Conventions

- Every route registered in `infra/template.yaml` must have a matching path entry here — a blueprint that adds a Lambda route updates the contract in the same PR.
- Request/response schemas mirror the types in `backend/src/models/` — no loose or `any`-shaped schemas.
- Cognito-protected routes declare a `bearerAuth` security scheme (`Authorization: Bearer {{accessToken}}`).
- The spec lists `local`, `dev`, `qa`, and `prod` as servers so the same document works across environments (base URLs match the `bruno/` environment table).

## Status

🚧 This folder is being established as part of the OpenAPI contract work — the initial spec is in progress. Until CI validation is wired up, changes to `openapi.yaml` are reviewed manually alongside the blueprint that introduced them.