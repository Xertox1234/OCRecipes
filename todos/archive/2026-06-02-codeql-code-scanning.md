---
title: "Configure CodeQL / GitHub code scanning"
status: done
priority: low
created: 2026-06-02
updated: 2026-06-02
assignee:
labels: [deferred, ci, security]
github_issue:
---

# Configure CodeQL / GitHub code scanning

## Summary

Add a GitHub Actions workflow that runs CodeQL static analysis on the TypeScript codebase. Currently no code-scanning analysis is configured — GitHub returns 404 for code-scanning alerts.

## Background

Identified during a GitHub warnings scan (2026-06-02). No CodeQL or other SAST tool runs in CI. GitHub Advanced Security is available on this repo; enabling it adds automated static-analysis findings to the Security tab and surfaces them in PRs. The codebase has 40+ Express routes and complex auth/IAP flows where a static-analysis pass has high value.

## Acceptance Criteria

- [ ] `.github/workflows/codeql.yml` created and committed
- [ ] CodeQL runs on `push` to `main` and on `pull_request`
- [ ] Language set to `javascript-typescript` (covers both `client/` and `server/`)
- [ ] Workflow passes on first run with no critical findings (or findings are triaged)
- [ ] GitHub Security tab shows active code-scanning analysis

## Implementation Notes

- Use the standard GitHub-provided CodeQL action (`github/codeql-action`).
- Query suite: `security-extended` catches more than the default `security-and-quality`.
- Scope to `src` paths: `client/`, `server/`, `shared/` — exclude `node_modules`, `server_dist/`, `ios/`, `android/`.
- Schedule a weekly cron scan in addition to PR triggers to catch newly-published rules against unchanged code.
- The workflow does NOT need to block merges initially — start in `continue-on-error: true` mode and promote once noise is triaged.
- Reference: `.github/workflows/ci.yml` for existing job structure to follow.

## Dependencies

- None blocking.

## Risks

- Initial scan may surface noisy findings (e.g. `eval`, `innerHTML`) that need triage before enabling as a merge gate.

## Updates

### 2026-06-02

- Initial creation — surfaced by GitHub warnings scan; no code-scanning analysis currently configured.
- **Done (2026-06-02):** added `.github/workflows/codeql.yml` — `javascript-typescript`, `security-extended`, push-to-`main` + `pull_request` + weekly cron (`27 3 * * 1`). Repo confirmed **public** (`gh api /repos/... → "visibility":"public"`), so code scanning uploads to the Security tab without a GHAS toggle.
- **Two implementation refinements vs. the original notes:**
  - Source-scoping (`client`/`server`/`shared`, exclude `node_modules`/`server_dist`/`ios`/`android`) is set in `codeql-action/init`'s **config** (`paths`/`paths-ignore`), not `on.push.paths` — trigger-paths gate when the workflow runs, not what CodeQL analyzes.
  - Deliberately **omitted** `continue-on-error: true`. The "non-blocking initially" requirement is met simply because this check is not one of `main`'s required status checks; `continue-on-error` would additionally mask genuine setup/upload errors as a green check. Promote to a required check once initial findings are triaged.
- AC #5 ("Security tab shows active analysis") completes after the first run on `main` post-merge.
