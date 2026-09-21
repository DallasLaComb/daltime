# DalTime

**Free shift scheduling for nonprofit teams.**

---

## The Problem

Organizations like the YMCA rely heavily on part-time staff. Scheduling dozens of employees across multiple shifts, locations, and availability constraints is a logistical nightmare. Commercial scheduling software costs $3-10+ per user per month — unaffordable for nonprofits operating on tight budgets.

## The Solution

DalTime is a free, open-source shift scheduling web app designed specifically for community organizations. Built on serverless AWS infrastructure, hosting costs are minimal — even with hundreds of users.

### Key Features

- **Multi-organization support** — One platform serves multiple YMCA branches or similar organizations
- **Hierarchical user management** — Org admins → Managers → Employees
- **Manager-driven onboarding** — Employees join via invitation, no self-registration chaos
- **Mobile-friendly** — Staff can check schedules from any device
- **Serverless architecture** — Scales automatically, minimal hosting costs

## Architecture

![DalTime Architecture](docs/architecture/diagram/DalTime%20Architecture.drawio.png)

## Tech Stack

| Layer          | Technology                    |
| -------------- | ----------------------------- |
| Frontend       | Angular 21                    |
| Backend        | AWS SAM + Lambda (Node.js 24) |
| Database       | DynamoDB                      |
| Authentication | AWS Cognito                   |
| Infrastructure | AWS SAM/CloudFormation        |

## User Roles

### Web-Admin

Platform-level administrators who manage all organizations within DalTime. They have access to a full organization list and can click into any organization to view and manage it with the same capabilities as an Org-Admin.

### Org-Admin

Organization administrators (e.g., a YMCA branch director) who manage their own organization. They create manager accounts and generate invite codes for managers to join the application. Org-Admins have full control over all managers within their organization and can click into any manager to view and manage things with the same capabilities as that Manager.

### Manager

Managers create invite codes for employees to join and oversee all employees under them. Key responsibilities include:

- Defining shifts that need to be filled
- Setting scheduling constraints (e.g., max 8 hours/day, 40 hours/week per employee)
- Clicking **"Create Schedule"** to auto-generate a schedule based on employee availability and shift requirements
- Reviewing and approving the generated schedule before publishing it to employees

### Employee

Employees interact with the system to:

- Submit their availability
- View their published schedule
- Post their shifts as available for others to pick up
- Pick up open shifts from other employees

## Getting Started

### Prerequisites

You need four things before doing anything else: **Node.js 24+**, **Docker**, **AWS CLI v2**, and **AWS SAM CLI**. Pick your OS below.

<details open>
<summary><strong>macOS</strong></summary>

Install [Homebrew](https://brew.sh) first if you don't have it:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

The installer prints an "Next steps" block with a `brew shellenv` line — run it (or open a new terminal) so `brew` is on your `PATH`. Then:

```bash
brew install node@24 awscli aws-sam-cli
brew install --cask docker   # Docker Desktop — launch it once from Applications after install
```

Verify:

```bash
node -v && aws --version && sam --version && docker --version
```

</details>

<details>
<summary><strong>Linux</strong></summary>

```bash
# Node.js 24+ (via nvm — works the same as on macOS)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 24

# AWS CLI v2 (use awscli-exe-linux-aarch64.zip on arm64 machines)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# AWS SAM CLI (pipx keeps it isolated from system Python)
python3 -m pip install --user pipx && python3 -m pipx ensurepath
pipx install aws-sam-cli

# Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out/in after this so `docker` works without sudo
```

Verify:

```bash
node -v && aws --version && sam --version && docker --version
```

</details>

<details>
<summary><strong>Windows</strong></summary>

Native Windows works for the CLIs, but the VS Code tasks in `.vscode/tasks.json` are macOS/Linux shell scripts (Windows task support is on the roadmap). Until then, easiest path is **WSL2**, then follow the Linux steps above inside it:

```powershell
wsl --install
```

Reboot, set up your Ubuntu user, then reopen VS Code with the [WSL extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl) and use the Linux instructions.

If you'd rather stay native (CLIs only, running the "Manual setup" commands below yourself instead of the VS Code tasks):

```powershell
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Amazon.AWSCLI
winget install -e --id Amazon.SAM-CLI
winget install -e --id Docker.DockerDesktop
```

Either way, install Docker Desktop and, if using WSL2, enable WSL2 integration for your distro under Docker Desktop → Settings → Resources → WSL Integration.

</details>

### One-time account setup

1. **Configure AWS SSO.** Ask an admin for the SSO start URL and the `daltime-dev` / `daltime-qa` / `daltime-prod` account IDs, then run:

   ```bash
   aws configure sso-session
   # Session name: daltime
   # SSO start URL: <provided by admin>
   # SSO region: us-east-1
   ```

   Repeat `aws configure sso` (or add profiles manually to `~/.aws/config`) for each of the three profiles — `daltime-dev`, `daltime-qa`, `daltime-prod` — attached to the `daltime` SSO session. Verify with:

   ```bash
   aws sso login --sso-session daltime
   aws sts get-caller-identity --profile daltime-dev
   ```

   See [`docs/aws-login.md`](docs/aws-login.md) for the daily login command once this is set up.

2. **Create `backend/env.local.json`.** This file is gitignored (it's per-developer) and tells SAM local which DynamoDB table and Cognito pool each Lambda should use:

   ```bash
   cp backend/env.local.json.example backend/env.local.json
   ```

   Fill in every `<your-dev-user-pool-id>` placeholder with the dev Cognito User Pool ID (`us-east-1_kzQ806uSv`). `TABLE_NAME` is already correct for every function.

### Local Development

> **Note:** Full local dev runs the backend as real Lambdas in Docker via `sam local start-api`, reading/writing the actual `daltime-dev` DynamoDB table over your AWS SSO session — there is no local database to seed separately. The frontend dev server talks to that local API on `http://localhost:3000`.

**VS Code users (Mac):** Run `Tasks: Run Task` → `Start Full Stack (with install)` to install dependencies and launch both the backend (SAM local) and frontend dev servers. Use `Backend: Deploy to Dev` to push Lambda/infra changes to the shared dev stack. Windows support coming soon.

**Manual setup:**

```bash
# Install dependencies
cd backend && npm install
cd ../frontend && npm install

# Log in (needed before backend can reach DynamoDB/Cognito)
aws sso login --sso-session daltime

# Start backend (SAM local API on :3000, backed by the real dev DynamoDB table)
cd backend && npm start

# In a second terminal, start frontend (points at localhost:3000)
cd frontend && npm start

# Deploy backend changes to the shared dev stack
cd backend && sam build --parameter-overrides LambdaArchitecture=arm64 --template-file ../infra/template.yaml
sam deploy --template-file .aws-sam/build/template.yaml --stack-name daltime-backend-dev --s3-bucket daltime-sam-artifacts --capabilities CAPABILITY_IAM --no-confirm-changeset --no-fail-on-empty-changeset --region us-east-1 --profile daltime-dev --parameter-overrides 'AllowedOrigins=http://localhost:4200,https://dev.daltime.com,https://localhost' CognitoUserPoolId=us-east-1_kzQ806uSv CognitoClientId=1nl13tbaqb47s8f0tfc07lc24m
```

## Testing

For our testing approach and guidelines, see [Testing Philosophy](docs/testing-philosophy.md).

| Type            | Framework       | Location                               |
| --------------- | --------------- | -------------------------------------- |
| Unit (Backend)  | Vitest          | `backend/test/unit/`                   |
| Unit (Frontend) | Vitest          | Co-located with each component/service |
| Integration     | Vitest          | `backend/test/integration/`            |
| E2E             | Robot Framework | `robot/`                               |

## Code Quality & Security Checks

Every push and PR runs through several automated checks. Some run locally before you even commit; others only run in CI.

### Runs locally (via git pre-commit hook)

The root `npm install` sets up a `husky` pre-commit hook (`.husky/pre-commit`) that runs `lint-staged` on every commit — **you don't need to do anything extra**, it's wired up automatically as long as you've run `npm install` at the repo root once:

```bash
npm install   # repo root — only needs to happen once per clone
```

On each commit, it lints and auto-fixes staged files:

- **ESLint** — `frontend/src/**/*.{ts,html}` and `backend/src/**/*.ts`
- **Prettier** — all staged `.json`/`.yaml`/`.yml`/`.md` files
- **secretlint** — every staged file, scanned for accidentally-committed secrets/keys

If a commit fails here, fix the reported issue and re-stage — see [`CLAUDE.md`](CLAUDE.md) for the most common ESLint violations in this codebase.

### Runs in CI only

| Check                    | Tool                                                       | Trigger                                                | Notes                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit/integration tests   | Vitest                                                     | Every push to `dev`/`main`                             | `ci.yml`                                                                                                                                                         |
| `npm audit`              | npm                                                        | Every push                                             | Backend blocks on high severity; frontend is `continue-on-error` pending an Angular 22 upgrade                                                                   |
| SAST                     | [CodeQL](https://codeql.github.com/)                       | Every push to `dev`/`main`                             | GitHub-native, results in the repo's Security tab — no local setup possible or needed                                                                            |
| Template lint            | [cfn-lint](https://github.com/aws-cloudformation/cfn-lint) | Every push                                             | Lints `infra/template.yaml` and `infra/foundation.yaml`                                                                                                          |
| IaC security scan        | [Checkov](https://www.checkov.io/)                         | Every push                                             | Soft-fail (report-only) against `infra/`                                                                                                                         |
| Dependency/SAST/IaC scan | [Snyk](https://snyk.io/)                                   | PRs to `dev`/`qa`/`main`, push to `main`, weekly sweep | Report-only for now (`\|\| true`) per the rollout plan in `docs/snyk-implementation-plan.md`; needs `SNYK_TOKEN`/`SNYK_ORG_ID` configured as GitHub secrets/vars |
| Code quality dashboard   | [SonarCloud](https://sonarcloud.io/)                       | Push to `main` only                                    | Free-tier limitation — analyzes only the main branch, not every commit; needs `SONAR_TOKEN`                                                                      |

**Snyk and SonarCloud are intentionally CI-only** — both require an authenticated account tied to this project's org (`SNYK_ORG_ID` / `sonar.organization=dallaslacomb` in `sonar-project.properties`), so there's no meaningful "run it locally" story for a fresh clone. If you want to run Snyk scans locally against your own account before pushing:

```bash
brew install snyk-cli   # or: npm install -g snyk
snyk auth               # opens browser to log in — no token to paste anywhere
snyk test                                                    # dependency scan
snyk code test                                                # SAST
snyk iac test infra/template.yaml infra/foundation.yaml       # IaC scan
```

To run the infra checks locally before pushing:

```bash
brew install cfn-lint checkov
cfn-lint infra/template.yaml infra/foundation.yaml
checkov -d infra/ --framework cloudformation
```

## Contributing

This project is built to help nonprofits. Contributions welcome!

## License

MIT

---

_Built with ❤️ for community organizations by [Dallas LaComb](https://github.com/dallaslacomb)._
Schedule your part-time employees easier with DalTime.
test-secretlint-scan
