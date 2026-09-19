# IAM Setup for GitHub Actions OIDC

GitHub Actions authenticates with AWS using OpenID Connect (OIDC) — no static access keys are stored in GitHub.

## Per-Account Setup

Each AWS account (dev, qa, main) needs its own OIDC provider and IAM role. Repeat these steps in each account.

### 1. Create the OIDC Identity Provider

1. Go to **IAM > Identity providers > Add provider**
2. Select **OpenID Connect**
3. Provider URL: `https://token.actions.githubusercontent.com`
4. Audience: `sts.amazonaws.com`
5. Click **Get thumbprint**, then **Add provider**

This only needs to be done once per AWS account.

### 2. Create the IAM Role

1. Go to **IAM > Roles > Create role**
2. Trusted entity type: **Web identity**
3. Identity provider: select the OIDC provider from step 1
4. Audience: `sts.amazonaws.com`
5. Attach the inline policy from `github-actions-policy.json` (see `github-actions-policy.blueprint.json` for a ready-made example)
6. Name the role: `github-actions-daltime-dev`, `github-actions-daltime-qa`, or `github-actions-daltime-main`

### 3. Scope the Trust Policy

> **The `sub` claim uses immutable IDs, not names.** GitHub issues this repo's OIDC
> tokens as `repo:DallasLaComb@88401844/daltime@1360788820:environment:<env>` — the
> owner ID and repo ID, not `DallasLaComb/daltime`. A name-based `sub` will fail with
> `Not authorized to perform sts:AssumeRoleWithWebIdentity`. Confirm the current value
> with `gh api repos/DallasLaComb/daltime/actions/oidc/customization/sub`. The upside:
> these IDs survive a repo rename, and they cannot be claimed by someone re-registering
> the old name.

Use `trust-policy.json` as the trust relationship, substituting values for the target environment (see `trust-policy.blueprint.json` for a ready-made example):

```bash
sed -e 's/{{ACCOUNT_ID}}/123456789012/g' \
    -e 's/{{ENVIRONMENT}}/dev/g' \
    trust-policy.json
```

| Placeholder       | Example                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{ACCOUNT_ID}}`  | The 12-digit ID of the target AWS account — get it with `aws sts get-caller-identity --profile daltime-<env> --query Account --output text` |
| `{{ENVIRONMENT}}` | `dev`, `qa`, or `main`                                                                                                                      |

### 4. Configure the GitHub Environment

In the GitHub repo: **Settings > Environments** > create an environment matching the branch name (`dev`, `qa`, `main`).

Add the following variables and secrets:

| Name                         | Type     | Description                                     |
| ---------------------------- | -------- | ----------------------------------------------- |
| `AWS_ROLE_ARN`               | Secret   | ARN of the IAM role created above               |
| `AWS_REGION`                 | Variable | AWS region (e.g., `us-east-1`)                  |
| `SAM_STACK_NAME`             | Variable | CloudFormation stack name (e.g., `daltime-dev`) |
| `SAM_S3_BUCKET`              | Variable | S3 bucket for SAM deployment artifacts          |
| `ALLOWED_ORIGIN`             | Variable | Frontend CloudFront URL for CORS                |
| `S3_BUCKET_NAME`             | Variable | S3 bucket hosting the frontend                  |
| `CLOUDFRONT_DISTRIBUTION_ID` | Variable | CloudFront distribution ID                      |

Cognito values (`userPoolId`, `clientId`) are read directly from `frontend/src/environments/environment.<branch>.ts` during deploy — no GitHub variables needed.

## Inline Policy

The file `github-actions-policy.json` contains the scoped IAM policy attached to each role. Substitute `{{ACCOUNT_ID}}` with the target AWS account ID before applying:

```bash
sed 's/{{ACCOUNT_ID}}/123456789012/g' github-actions-policy.json
```

This policy follows least-privilege principles — all resources are scoped to `daltime-*` naming patterns. If a deploy fails with an access denied error, check which API call failed and add only that action.
