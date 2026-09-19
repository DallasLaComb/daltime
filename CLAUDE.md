# DalTime — Claude Code Instructions

## Existing documentation

Read these before starting any task — they define the conventions Claude must follow:

- `ai/context/project-context.md` — architecture, environments, roles, project structure
- `ai/prompts/backend.md` — Lambda vertical slice rules, DynamoDB conventions, test requirements
- `ai/prompts/ui.md` — Angular rules, Tailwind-only styling, shared component inventory
- `ai/prompts/git-commit-message.md` — commit message format and pre-commit workflow

---

## Pre-commit / lint-staged rules

**This is the most common source of commit failures — read carefully.**

### Stage everything before checking

lint-staged runs on **staged files only**. After editing files, always `git add` them before running `npx lint-staged`. Edits in the working tree are invisible to the linter until staged.

### Touching a file means fixing all its lint errors

lint-staged lints every staged file in full — not just the changed lines. If you make even a one-line edit to a file that has pre-existing ESLint violations, those violations will block the commit. Fix all errors in every file you touch before asking for a commit message.

### Common violations in this codebase

- `@angular-eslint/template/click-events-have-key-events` — any `(click)` on a non-button element needs a companion `(keydown)` or `(keydown.escape)` on the same element
- `@angular-eslint/template/interactive-supports-focus` — any element with a click handler needs `tabindex="-1"` (or better) so it is keyboard-reachable
- `@angular-eslint/template/label-has-associated-control` — every `<label>` needs a `for` attribute matching an `id` on its input
- `@angular-eslint/no-output-native` — `output()` names must not collide with native DOM events (`confirm`, `cancel`, `click`, `change`, etc.). Suffix with `-ed`: `confirmed`, `cancelled`
- `@typescript-eslint/no-unused-vars` — remove unused imports and helpers immediately

### Workflow

```
# make changes
git add <files>
npx lint-staged      # must pass before committing
# follow @ai/prompts/git-commit-message.md for the commit message
```

---

## Feature completeness requirement

**Every feature must work end-to-end across all environments before it is considered done.**

This means every feature must pass in all four of these contexts:

1. **Locally via `tasks.json`** — run "Start Full Stack (with install)" from `.vscode/tasks.json`. The backend runs via SAM local against the dev DynamoDB table (pointed at `daltime-dev`). A feature is broken locally if CORS errors, 403s, or 404s appear for its routes.
2. **GitHub Actions → dev** — the deploy workflow must succeed and the feature must work end-to-end on `https://dev.daltime.com`.
3. **GitHub Actions → qa** — must pass on the qa environment after promotion.
4. **GitHub Actions → prod** — must pass on the prod environment after promotion.

### What "working locally" requires for every new API route

- The Lambda handler exists under `backend/src/functions/<role>/<feature>/`
- The route and OPTIONS event are registered in `infra/template.yaml` under the correct SAM Function resource
- The SAM template has a matching `LogGroup` resource for the function
- **`backend/env.local.json` has an entry for the new function** with `TABLE_NAME: "daltime-daltime-backend-dev"` and `USER_POOL_ID` if the function uses Cognito — without this SAM local cannot resolve the table name and throws `ResourceNotFoundException`
- The `tasks.json` "Backend: Deploy to Dev" task deploys the updated template so the dev table is in sync

Common local errors and their causes:

- **CORS 403** — route or OPTIONS event missing from `infra/template.yaml`
- **500 ResourceNotFoundException** — function missing from `backend/env.local.json`

---

## Development workflow

**Every feature starts with a blueprint — no implementation before approval.**

Use these saved prompts:

- `@new-lambda` — blueprint then implement a Lambda feature (handler / service / db / model / tests / SAM)
- `@new-component` — blueprint then implement an Angular feature (model / service / component / spec / route)
- `@blueprint-review` — audit an existing implementation against its blueprint

Blueprint location:

- Lambda: `backend/src/functions/<role>/<feature>/0-<feature>.blueprint.md`
- Component: `frontend/src/app/features/<role>/<feature>/0-<feature>.blueprint.md`

---

## Key constraints

- **No raw `<button>` for actions** — always use `<app-button>` from `@common-daltime`
- **No inline styles, no component CSS files** — Tailwind utility classes only
- **No NgModules, no BehaviorSubject** — standalone components and signals everywhere
- **No `any`** — strict TypeScript throughout
- **All imports from shared components use `@common-daltime`** — never relative paths
- **All interactive elements need `data-testid`**
- **Every shared component root element needs `class="dt-debug"`**
- **ESM `.js` extensions** on all backend imports

---

## Agent sub-task close requirement

**Every agent that works a sub-task issue must close that sub-issue when its work is complete.**

This applies to every feature pipeline agent: `angular-frontend-agent`, `backend-lambda-agent`, `dynamodb-data-agent`, `security-agent`, `tester-agent`, `devops-agent`, and `code-reviewer-agent`.

### Required close sequence

After filling in the **Completion Notes** section of your sub-issue, run:

```bash
gh issue close <sub-issue-number> --repo DallasLaComb/daltime
```

Do this as the final step of your work — after staging/committing your changes and after updating the Completion Notes. Do not leave the sub-issue open once your work is complete.

### Why this matters

- Parent stories with all agent sub-tasks closed can be identified and closed by the Product Owner Agent automatically.
- Open sub-issues on a finished story create false signals on the project board — they appear as "Backlog" items that need attention when they don't.
- Later agents read sibling sub-issues to get context; a closed sub-issue with complete Completion Notes is the correct signal that an earlier agent's work is ready to read and build on.

### Rule: do not skip this step

Forgetting to close the sub-issue is treated the same as incomplete work — the story cannot be considered done until every agent sub-issue is closed.
