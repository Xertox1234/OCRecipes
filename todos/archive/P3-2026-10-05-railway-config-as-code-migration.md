---
title: "Migrate railway.json to Railway Infrastructure as Code before 2026-12-01"
status: done
priority: low
created: 2026-10-05
updated: 2026-10-09
assignee:
labels: [deferred, infra]
github_issue:
---

# Migrate railway.json to Railway Infrastructure as Code before 2026-12-01

## Summary

`railway up` (2026-10-05) warned that Config as Code (`railway.json` / `railway.toml`) is deprecated in favour of Infrastructure as Code (`.railway/railway.ts`). Railway says existing files keep working until **2026-12-01**.

## Background

This was seen while deploying from the CLI. That deploy was needed because GitHub-triggered builds were failing with `failed to fetch snapshot` on every Railway builder. The warning does not block anything yet. After 2026-12-01, the deploy settings in `railway.json` may stop being applied.

## Acceptance Criteria

- [x] `railway.json` settings are moved to `.railway/railway.ts`, using `railway config migrate` or by hand.
- [ ] One production deploy succeeds with the new config, and its build and start settings match the old ones.
- [x] `railway.json` is removed once nothing reads it.

## Implementation Notes

- Read the current `railway.json` (371 bytes, repo root) before migrating.
- Docs: https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code
- Deploy changes are outward-facing. The owner triggers or approves the deploy.

## Updates

### 2026-10-09: draft and runbook (agent); owner steps remain

- `.railway/railway.ts` is a named partial (`OCRecipes`) that mirrors `railway.json` key for key. It also declares the live source, the custom domain, the `us-west2` placement, and all 24 variable names as `preserve()`. Postgres is deliberately left out.
  - The draft typechecks against `railway@3.13.1`; a deliberately invalid copy fails as a control.
  - Evaluated locally, it produces the same `multiRegionConfig`, custom domain and source that Railway reports.
- `railway` is now a devDependency, so `railway config plan` can resolve `railway/iac`.
- `.railway/**` is in the eslint ignores. tsc skips dot-folders, so type-aware lint would otherwise fail on the file.
- `railway.json` is **kept** on purpose. The dashboard has no start or build command, and `package.json` has no `start` or `build` script. Deleting `railway.json` before the apply would make the next auto-deploy fail.
- Baseline before the migration: deployment `623cbebd` (SUCCESS, commit `54d704f3`, us-west2).

**Owner:** follow steps 1–4 of `.railway/README.md`:

1. `npm install`
2. `migrate --apply --force`, then diff the result
3. `plan`, which must read "0 to destroy"
4. `apply`

**Agent, afterwards:**

- Confirm the live settings with read-only calls.
- Open the PR that deletes `railway.json` and updates the comment at `server/index.ts:287`.
- Check that deploy, tick the remaining criteria, and archive this todo.

### 2026-10-09: applied (agent, owner-authorized) and railway.json removed

- **Skipped:** `railway config migrate --apply --force`. Its dry run named the service `todo-pick` (after the worktree folder), which would have created a second, empty service. It also dropped the restart policy. The hand-written file was applied instead.
- **Plan before apply:** 0 to add, 2 to change, 0 to destroy. Only `service.OCRecipes` was touched, and the six `railway.json` settings each went from `null` to their value.
- **`railway config apply --yes`** ran without `--confirm-destructive`.
- **Live config afterwards** (`get-service-config`): `buildCommand`, `startCommand`, `healthcheckPath`, `healthcheckTimeout` 30 and `restartPolicyMaxRetries` 5 are set. Source, domain, placement and all 24 variables are unchanged.
- **`restartPolicyType` was dropped from `railway.ts`.** `ON_FAILURE` is Railway's default ("The default is On Failure with a maximum of 10 restarts", per the docs), and Railway stores it as null, so declaring it planned as drift on every run.
- **Re-plan** reports "already up to date" (exit 0), both with and without `railway.json` in the tree.
- **Criterion 2** ("one production deploy succeeds with the new config") is checked by the deploy this PR's merge triggers. It is the first deploy with no `railway.json`.
