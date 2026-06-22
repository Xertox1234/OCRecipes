<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Clear GitHub Actions Node 20 deprecation warning (checkout/setup-node)"
status: done
priority: low
created: 2026-06-21
updated: 2026-06-21
assignee:
labels: [deferred, ci]
github_issue:

---

# Clear GitHub Actions Node 20 deprecation warning (checkout/setup-node)

## Summary

CI jobs emit: "Node.js 20 is deprecated. The following actions target Node.js 20
but are being forced to run on Node.js 24: actions/checkout@v4,
actions/setup-node@v4." Bump the pinned action versions to their Node-24 majors so
the warning clears before the runtime is removed.

## Background

Surfaced as a `.github` annotation on multiple CI jobs (Tests shards, Solutions-DB
gates) during the `main` CI watch for `af4468a3` on 2026-06-21. It's a forward-looking
GitHub-runner deprecation, not a current failure — the actions still run (forced
onto Node 24). Filed low-severity so it's handled before GitHub drops Node 20.

## Acceptance Criteria

- [ ] Bump `actions/checkout@v4` → the current Node-24 major (e.g. `@v5`) across all workflows
- [ ] Bump `actions/setup-node@v4` → the current Node-24 major (e.g. `@v5`) across all workflows
- [ ] No Node-20 deprecation annotation on any CI job
- [ ] All existing CI checks still pass after the bump

## Implementation Notes

- Grep the workflow dir for the pins: `grep -rn "actions/checkout@\|actions/setup-node@" .github/workflows/`.
- Verify the target major actually ships a Node-24 runtime before pinning (check the
  action's release notes) — don't bump blindly to a major that changed inputs/behavior.
- This is a dependabot-eligible bump too; confirm `dependabot.yml` covers
  `github-actions` so it doesn't re-open the same PR.

## Dependencies

- None.

## Risks

- A major bump of `checkout`/`setup-node` can carry behavior changes (rare). Read the
  release notes; the CI suite is the regression net.

## Updates

### 2026-06-21

- Initial creation — surfaced from `.github` CI annotations during the post-push
  watch of the harness commits (`af4468a3`).
