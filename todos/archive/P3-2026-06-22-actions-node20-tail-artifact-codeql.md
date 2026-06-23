---
title: "Clear the Node 20 deprecation tail: upload-artifact + codeql-action"
status: done
priority: low
created: 2026-06-22
updated: 2026-06-22
assignee:
labels: [deferred, ci]
github_issue:
---

# Clear the Node 20 deprecation tail (upload-artifact + codeql-action)

## Summary

PR #424 bumped `actions/checkout` and `actions/setup-node` to `@v5` (Node 24),
clearing the annotation that named those two. But other CI actions still target
the Node 20 runtime and will emit their **own** Node 20 deprecation annotations.
Bump them to their Node-24 majors so the deprecation is fully cleared before
GitHub drops the Node 20 runtime.

## Background

Surfaced as the `DEFERRED_WARNINGS` from the `P3-2026-06-21-actions-node20-deprecation`
executor (now archived) and re-confirmed live on 2026-06-22. That todo was scoped
specifically to checkout/setup-node; these are the remaining Node-20-era actions
it intentionally left out of scope. Forward-looking deprecation, not a current
failure — the actions still run (forced onto Node 24).

The remaining references (exact locations):

- `actions/upload-artifact@v4` — `.github/workflows/e2e-smoke.yml:110`,
  `.github/workflows/mutation.yml:29`, `.github/workflows/mutation-goal-safety.yml:66`
- `github/codeql-action/init@v3` — `.github/workflows/codeql.yml:50`
- `github/codeql-action/analyze@v3` — `.github/workflows/codeql.yml:70`

## Acceptance Criteria

- [ ] `actions/upload-artifact@v4` → the current Node-24 major across all 3 workflows
- [ ] `github/codeql-action/*@v3` → the current Node-24 major in `codeql.yml`
      (bump `init` and `analyze` together — they must match)
- [ ] No Node-20 deprecation annotation remains on any CI job
- [ ] All existing CI checks still pass after the bump (the CodeQL job in
      particular — it must still upload results / produce the security tab)

## Implementation Notes

- **Verify the target major actually ships a Node-24 runtime before pinning** —
  same discipline as #424: read the action's `action.yml` `runs.using` on the tag
  you pin (the releases-page summary is unreliable). Don't bump blindly to a major
  that changed inputs/behavior.
- **`upload-artifact` has a real breaking-change history.** v4 was a major rewrite
  (per-artifact immutability, no re-upload to the same name within a run). Re-read
  the target major's release notes for any further input/behavior changes before
  bumping — these three uses upload e2e/mutation reports, so confirm the artifact
  still lands.
- **`codeql-action` majors move on their own cadence** — confirm which major is the
  current Node-24 one and that it's compatible with the repo's CodeQL config; bump
  `init` and `analyze` to the **same** major.
- This is dependabot-eligible too; confirm `.github/dependabot.yml` covers
  `github-actions` so it doesn't re-open the same PR (see memory
  `project_dependabot_ci_security_posture`).
- Files in scope: `.github/workflows/e2e-smoke.yml`, `.github/workflows/mutation.yml`,
  `.github/workflows/mutation-goal-safety.yml`, `.github/workflows/codeql.yml`.

## Dependencies

- None. Independent of #424 (already merged).

## Risks

- Low. A major bump can carry behavior changes (upload-artifact especially); read
  the release notes and let the PR's own CI run be the regression net — workflow
  changes only execute on a PR/merge, so the PR's CI is the real verification.

## Updates

### 2026-06-22

- Filed from the #424 (`actions-node20-deprecation`) follow-up — the
  checkout/setup-node bump cleared the triggering annotation but left this
  upload-artifact + codeql-action tail on Node 20.
