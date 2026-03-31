# tba-damiros/cicd-workflows

Centralised CI/CD pipeline for tba-damiros dApps.

Update the pipeline once here → every dApp repo that "calls" this workflow can inherit the change automatically (depending on whether the dApp pins to a tag/SHA or tracks `main`).

---

## What this repo is

This repository hosts a shared CI/CD pipeline for tba-damiros dApps, including:

- **Reusable GitHub workflows** (the main pipeline entrypoints dApps call)
- **Custom actions** (sovereignty check, IPFS pinning)
- **Shared check documentation / standards**
- **Shared repo configuration** (line endings, gitleaks config, etc.)

---

## How it works (high level)

Each dApp repo contains a small caller workflow (usually `.github/workflows/ci.yml`) that **calls** this repo's reusable workflow (`.github/workflows/reusable-frontend-deploy.yml`).

```text
push to dApp/main
        │
        ▼
  [dApp repo ci.yml]  ──calls──▶  [this repo: reusable-frontend-deploy.yml]
                                          │
                                  ┌───────┴────────┐
                                  │ security-checks │  ← lockfile, secrets, audit,
                                  └───────┬────────┘    ESLint, TS, sovereignty
                                          │
                                  ┌───────┴────────┐
                                  │     build       │  ← pnpm build + hash
                                  └───────┬────────┘
                                          │
                                  ┌───────┴────────┐
                                  │     deploy      │  ← pin to IPFS via Pinata
                                  └────────────────┘
```

---

## Repo structure

```text
cicd-workflows/
├── .github/
│   ├── workflows/
│   │   └── reusable-frontend-deploy.yml
│   └── CODEOWNERS
├── actions/
│   ├── pin-to-pinata/
│   │   ├── action.yml
│   │   └── pin-to-pinata.mjs
│   └── sovereignty-check/
│       ├── action.yml
│       └── sovereignty-check.mjs
├── checks/
│   └── docs/
│       └── caller-template.yml
├── repo/
│   └── .gitattributes
├── .gitleaks.toml
├── .gitignore
├── .nvmrc
├── LICENSE
└── README.md
```

---

## Adding a new dApp — step by step

Follow these steps in order. Steps 1–3 are the most commonly missed.

### Step 1 — Copy the Gitleaks config

The pipeline runs Gitleaks and expects a config file at `.pipeline/.gitleaks.toml` inside the dApp repo. Without this file the Gitleaks step will fail.

In the dApp repo, create the directory and copy the config:

```bash
mkdir -p .pipeline
cp <path-to-this-repo>/.gitleaks.toml .pipeline/.gitleaks.toml
git add .pipeline/.gitleaks.toml
git commit -m "chore: add gitleaks config for pipeline"
```

Or copy the contents of [`.gitleaks.toml`](.gitleaks.toml) from this repo into `.pipeline/.gitleaks.toml` in the dApp repo.

### Step 2 — Set up required secrets

In the dApp repo go to **Settings → Secrets and variables → Actions** and add:

| Secret | Required | Description |
|--------|----------|-------------|
| `PINATA_JWT` | **Yes** | JWT from [app.pinata.cloud](https://app.pinata.cloud) — used to pin the build to IPFS |
| `GITLEAKS_LICENSE` | **Yes** | License key from [gitleaks.io](https://gitleaks.io) — required by the Gitleaks action |
| `VITE_WALLETCONNECT_PROJECT_ID` | If used | WalletConnect project ID injected at build time |

### Step 3 — Create the caller workflow

Create `.github/workflows/ci.yml` in the dApp repo:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  pipeline:
    uses: tba-damiros/cicd-workflows/.github/workflows/reusable-frontend-deploy.yml@main
    with:
      pin-name-prefix: your-dapp-name    # ← display name for the Pinata pin
      node-version: '20'
      pnpm-version: '10'                 # ← must match engines.pnpm in package.json
    secrets: inherit
```

> See [`checks/docs/caller-template.yml`](checks/docs/caller-template.yml) for a copy-paste template.

### Step 4 — Verify the first run

After pushing, check the Actions tab in the dApp repo. The job summary for a successful deploy will include the IPFS CID and gateway links.

---

## Workflow inputs

| Input | Default | Description |
|-------|---------|-------------|
| `pin-name-prefix` | _(repo name)_ | Prefix for the Pinata pin name. Defaults to the GitHub repository name if not set. |
| `node-version` | `20` | Node.js version |
| `pnpm-version` | `10` | Must match `engines.pnpm` in the dApp's `package.json` |

---

## Checks run by the pipeline

| # | Check | Blocks on failure? |
|---|-------|--------------------|
| 1 | Lockfile integrity (`pnpm-lock.yaml` in sync) | Yes |
| 2 | Secret scanning (Gitleaks) | Yes |
| 3 | Dependency audit (`pnpm audit --audit-level=critical`) | Yes (critical CVEs only) |
| 4 | ESLint security check (`pnpm run lint`) | Yes |
| 5 | TypeScript type check (`tsc --noEmit`) | Yes |
| 6 | Sovereignty check (CSP, RPC allowlist, WalletConnect) | No (logs only — under review) |
| 7 | Threat model staleness | No (warning only) |

---

## Sovereignty check: current behavior

The sovereignty check is currently set to `continue-on-error: true` — it will not block the pipeline, but failures are visible in the logs. This is intentional while the check logic is being reviewed and refined.

To add an approved RPC provider, edit `APPROVED_RPC_HOSTS` in [`actions/sovereignty-check/sovereignty-check.mjs`](actions/sovereignty-check/sovereignty-check.mjs).

---

## Version pinning (recommended)

Using `@main` means every run picks up the newest pipeline. Pin to a tag or SHA for reproducible, controlled upgrades:

```yaml
# Tag (preferred)
uses: tba-damiros/cicd-workflows/.github/workflows/reusable-frontend-deploy.yml@v1.2.0

# Commit SHA
uses: tba-damiros/cicd-workflows/.github/workflows/reusable-frontend-deploy.yml@247630f91e421d1f2255361daa1ce261da3e0d4a
```

If a dApp tracks `@main`, it picks up pipeline changes on its next run. If pinned to a tag/SHA, it only gets changes when the ref is bumped in the caller workflow.

---

## Gitleaks version control (planned)

We plan to pin Gitleaks and other security tool versions in the workflow to reduce supply-chain risk and avoid unexpected behavior changes from upstream updates.

---

## Ownership / reviews

This repo includes `.github/CODEOWNERS` requiring maintainer review for all changes. CODEOWNERS enforcement requires branch protection to be configured on `main` (require pull requests, require approvals, require CODEOWNERS review).
