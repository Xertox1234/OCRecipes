---
title: "Lint check: require @vitest-environment jsdom pragma in client/components .test.tsx files"
status: completed
priority: medium
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, ci, lint, audit-2026-05-11-review-feedback]
github_issue:
---

# Lint check: require @vitest-environment jsdom pragma in client/components .test.tsx files

## Summary

PR #148 removed `environmentMatchGlobs` from `vitest.config.ts` (audit 2026-05-11 L1). Now that the glob is gone, a future contributor who adds a new `.test.tsx` under `client/components/` and forgets the `// @vitest-environment jsdom` pragma will get silent fallback to the `node` environment. DOM APIs will be `undefined`, and tests may pass spuriously (no DOM checks) or fail with confusing "ReferenceError: document is not defined" messages.

Add a lint-staged check that errors on `.test.tsx` files under `client/components/**/__tests__/` if they lack the pragma in the first 3 lines.

## Background

Raised by review of PR #148 (testing audit, suggestion 5). The empirical verification at L1 fix time (51/51 files have the pragma) is correct *today* but doesn't prevent regression. The deleted `environmentMatchGlobs` was implicitly serving as a safety net; this lint check is the explicit replacement.

## Acceptance Criteria

- [ ] `scripts/check-jsdom-pragma.js` (or similar) exists, mirroring the style of `scripts/check-accessibility.js`, `check-hardcoded-colors.js`, `check-idor-storage.js`
- [ ] Reads each staged `.test.tsx` file under `client/components/**/__tests__/`
- [ ] Errors if the first 3 lines don't include `// @vitest-environment jsdom` or `/** @vitest-environment jsdom */`
- [ ] Lint-staged config updated: add the check to `client/components/**/__tests__/*.test.tsx` glob in `package.json` `lint-staged` config
- [ ] CI workflow updated: add `node scripts/check-jsdom-pragma.js` as a step alongside the other pattern scripts in `.github/workflows/ci.yml`
- [ ] Test the script locally: temporarily remove the pragma from one file → script errors with clear message; restore → script passes
- [ ] Document in `docs/patterns/testing.md` (existing "When Inline `vi.mock`..." section is a good neighbor) that new `.test.tsx` files in `client/components/` MUST include the pragma, with the lint script as the enforcement mechanism

## Implementation Notes

- The script should accept file paths via process.argv (the lint-staged convention) and exit 1 on the first failure with a clear message: `"<path>: missing '// @vitest-environment jsdom' pragma (required since vitest.config.ts no longer matches via environmentMatchGlobs)"`
- For files outside `client/components/__tests__/`, the pragma is still useful but not required (per the existing testing patterns memory). Don't over-extend the check.
- Consider also auto-fix mode: `node scripts/check-jsdom-pragma.js --fix` could prepend the pragma. Nice to have, not required.

## Dependencies

PR #148 must be merged first (so the change to `vitest.config.ts` is in `main`).

## Risks

- Low. Adds a defensive check for a real footgun. False-positive risk is minimal because the rule is precise.

## Related

- Audit 2026-05-11 finding L1
- Audit 2026-05-11 codification: `docs/patterns/testing.md` "When Inline `vi.mock` of Globally-Aliased Modules IS Correct" (which assumes the pragma is consistently applied)
