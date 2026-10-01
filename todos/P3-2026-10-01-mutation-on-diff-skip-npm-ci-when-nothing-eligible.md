---
title: "Mutation-on-diff: skip npm ci when no changed module is eligible"
status: backlog
priority: low
created: 2026-10-01
updated: 2026-10-01
assignee:
labels: [deferred, ci]
github_issue:
---

# Mutation-on-diff: skip npm ci when no changed module is eligible

## Summary

The advisory `Mutation-on-diff (advisory)` job runs `npm ci` on every PR,
including docs-only PRs where nothing is eligible and the script only
prints "No eligible changed modules". Selecting first and installing only
when needed would save that install on most PRs.

## Background

Raised as a minor in the Lane F final whole-branch review (runner cost,
not correctness). It was deferred because Lane F's runtime data, the
plan's Step 4 (the three most recent real-PR runs once the workflow is on
main), should show whether the install is a meaningful share of the job.
The F0 replay run took 42 s end to end, with npm ci included.

## Acceptance Criteria

- [ ] A PR with no eligible changed module completes the job without
      running `npm ci`, and its summary still says "No eligible changed
      modules in this PR."
- [ ] A PR with an eligible module still installs and runs as today.
- [ ] Selection still uses only `stryker.targets.mjs`'s exports; no second
      exclusion list.

## Implementation Notes

- `scripts/ci/mutation-on-diff.mjs` imports only Node built-ins and
  `stryker.targets.mjs`, so its selection can run before dependencies are
  installed. One option is a `--select-only` mode that writes the summary
  for the empty case and sets a step output (`run=true|false`), with the
  setup-node, npm ci and run steps gated on it. Pass the list as a file,
  never an env var (E2BIG; see the script's header).
- Files: `scripts/ci/mutation-on-diff.mjs`,
  `scripts/__tests__/mutation-on-diff.test.ts`,
  `.github/workflows/mutation-on-diff.yml`.
