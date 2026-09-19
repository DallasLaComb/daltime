# Bruno — DalTime API Collection

This folder contains the [Bruno](https://www.usebruno.com/) API collection for the DalTime backend.

Bruno is a git-friendly API client (a Postman alternative) that stores requests as plain-text `.bru` files. Keeping the collection in-repo means API requests live in version control next to the code they exercise, and every agent/developer can run the same requests without importing exported JSON.

## Opening the collection

You can use Bruno either through the desktop app or directly inside VS Code via the official extension.

### VS Code (recommended for this repo)

1. Install the **Bruno** extension from the VS Code Marketplace:
   - Open the Extensions panel (`Cmd+Shift+X`), search for **Bruno**, and install the one published by `usebruno`; **or**
   - Run from the terminal:
     ```bash
     code --install-extension usebruno.bruno
     ```
2. Open the repo in VS Code — the extension automatically detects any folder containing a `bruno.json` file as a collection.
3. Open the **Bruno** sidebar (icon in the Activity Bar) to browse requests, or use the command palette (`Cmd+Shift+P`) → **Bruno: Open Collection** and select this `bruno/` folder if it isn't picked up automatically.
4. Pick an environment from the environment dropdown at the top of the Bruno panel (see [Environments](#environments)).

> Run requests against the local stack by starting it first: use the `.vscode/tasks.json` **"Start Full Stack (with install)"** task, then fire requests with the `local` environment selected.

### Desktop app

Alternatively, install the Bruno desktop app from [usebruno.com](https://www.usebruno.com/), then choose **Collection → Open** and point it at this repo's `bruno/` folder. Since the collection is plain text in git, both options share the exact same files — no import/export step.

## Structure

- Each subfolder maps to a backend feature, mirroring `backend/src/functions/<role>/<feature>/`
- `.bru` files are individual requests (method, URL, headers, body)
- `environments/` holds per-environment variable sets (base URLs, tokens)

## Environments

Switch environments from the Bruno environment dropdown (desktop app or VS Code extension):

| Environment | Base URL | How it runs |
| ----------- | -------- | ----------- |
| `local`     | `http://localhost:3000` | SAM local — start via the `.vscode/tasks.json` "Start Full Stack (with install)" task |
| `dev`       | `https://dev.daltime.com` | Deployed by GitHub Actions |
| `qa`        | `https://qa.daltime.com` | Deployed by GitHub Actions (confirm URL in `ai/context/project-context.md`) |
| `prod`      | `https://prod.daltime.com` | Deployed by GitHub Actions (confirm URL in `ai/context/project-context.md`) |

Local runs hit the dev DynamoDB table (`daltime-daltime-backend-dev`) via `backend/env.local.json`.

## Auth

Routes protected by Cognito require a bearer token:

```
Authorization: Bearer {{accessToken}}
```

Store `accessToken` in the environment you're using. **Never commit real tokens** — put secrets in a Bruno *secrets* environment (gitignored), not in tracked `.bru` env files.

## Conventions

- Every API route registered in `infra/template.yaml` should have a matching request here — when a blueprint adds a new Lambda route, add the corresponding `.bru` request in the same PR (including the OPTIONS preflight check for CORS verification).
- Request names should match the route's feature name (e.g., `create-schedule.bru` for the create-schedule handler).
- Keep bodies in sync with the request models in `backend/src/models/`.