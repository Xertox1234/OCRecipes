---
title: "typescript-eslint 8.72+ runs the CI lint job out of memory"
status: backlog
priority: low
created: 2026-11-17
updated: 2026-11-17
assignee:
labels: [deferred, dependencies, ci]
github_issue:
---

# typescript-eslint 8.72+ runs the CI lint job out of memory

## Summary

`typescript-eslint` is held at 8.59.4. `package.json` allows `^8.59.4`, but 8.72.2 and 8.73.0
both make the `Lint · Types · Patterns` job in CI die with a JavaScript heap out-of-memory
error. Find the cause, then lift the hold.

## Background

Found on 2026-11-17 during the dependency update work.

- 8.72.2 was pulled out of an in-range batch after CI lint ran out of memory.
- 8.73.0 was tried alone in PR 1910 (closed unmerged). Run 44220890289: heap at 4082 MB after
  99 s, `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript
heap out of memory`, exit code 134.
- The same commit passed `npm run lint` on a developer laptop. CI sets no `NODE_OPTIONS` for
  the lint step (`.github/workflows/ci.yml`, `run: npm run lint`), so the runner's default heap
  limit applies. `.husky/pre-commit` already raises its own limit to 4096 MB.
- Not known: which release between 8.59.4 and 8.72.2 introduced the growth, and whether the
  growth comes from `typescript-eslint` itself or from the dedupe it causes. On 8.73.0,
  `@tanstack/eslint-plugin-query` stops using its nested 8.72.1 copies and shares the root
  ones.
- The lint script is `ESLINT_NO_TYPE_AWARE= npx expo lint && node
scripts/check-react-compiler-bailouts.js`.

Until this is done, every in-range update must name packages one by one. A bare `npm update`
pulls `typescript-eslint` forward and breaks CI lint.

## Acceptance Criteria

- [ ] The first release in 8.60–8.72 that makes CI lint run out of memory is named, with the
      run that shows it.
- [ ] The cause is stated: a `typescript-eslint` change (link the upstream issue or changelog
      line), a config interaction here, or plain growth that needs a higher limit.
- [ ] Either `typescript-eslint` is on the newest 8.x with CI lint green, or the todo records
      why it stays held and what would lift the hold.
- [ ] If the fix is a higher heap limit for the CI lint step, the PR states the peak heap
      measured before and after, so the limit is not a guess.

## Implementation Notes

- A draft PR per candidate version is the cheapest bisect: only the CI runner reproduces the
  failure. Lockfile only: `npm update typescript-eslint` at the candidate version.
- Check upstream first: search the `typescript-eslint` issue tracker for memory regressions in
  the 8.6x–8.7x range before bisecting.
- Raising the limit (`NODE_OPTIONS=--max-old-space-size=…` on the lint step) hides the growth
  and does not add CI time, but it should be the answer only once the cause is known.
- ESLint 10 is a separate, later upgrade and needs a `typescript-eslint` that supports it, so
  this todo blocks that one.

## Scope Contract

- **Mechanisms to use:** draft PRs for the bisect; the existing lint script and CI step.
- **Files in scope:** `package-lock.json`, `package.json` (only the `typescript-eslint` line),
  `.github/workflows/ci.yml` (only the lint step's environment), `eslint.config.js` if the
  cause is a config interaction.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A raised heap limit can hide a real leak that keeps growing until it fails again.
- Lint rule behaviour can change across 14 minor releases. A green lint job is the check; new
  findings would need fixing in the same PR.

## Updates

### 2026-11-17

- Initial creation
