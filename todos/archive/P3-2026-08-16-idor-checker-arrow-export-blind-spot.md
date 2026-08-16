---
title: "check-idor-storage: widen EXPORT_FN_START past the arrow-export blind spot"
status: done
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, security]
github_issue:
---

# check-idor-storage: widen EXPORT_FN_START past the arrow-export blind spot

## Summary

The IDOR checker's `EXPORT_FN_START` regex matches only `export [async] function name(` — an exported arrow const (`export const getById = async (recipeId) => …`), class method, or re-export with a naked id param is invisible to the scan.

## Background

Surfaced and deliberately pinned (not fixed) in PR #822: widening the matcher is a security-checker semantic change that requires re-auditing all of `server/storage/` for newly-visible functions and likely growing the 55-entry ALLOWLIST — too much scope for a test PR. The blind spot is documented by a pin test so the gap is at least visible.

## Acceptance Criteria

- [x] `EXPORT_FN_START` (or a second pattern) matches `export const <name> = [async] (` arrow exports
- [x] Full no-arg scan over `server/storage/` triaged: every newly-flagged function either gains a `userId` param, an `// idor-safe` comment, or a justified ALLOWLIST entry
- [x] The PR #822 pin test ("known matcher blind spot") flipped from pinning non-detection to asserting detection
- [x] `scripts/__tests__/check-idor-storage.test.ts` gains a deny case for an arrow export

## Implementation Notes

Start from the pin test in `scripts/__tests__/check-idor-storage.test.ts` ("exported arrow consts are invisible"). The scan is line-based; arrow signatures can span lines, so reuse `extractParams`' multi-line collection anchored at the `=>`-less opening paren. Class methods and re-exports can stay out of scope if triage shows none exist in `server/storage/`.

## Scope Contract

- **Mechanisms to use:** the existing regex + ALLOWLIST + `// idor-safe` machinery — no new config surface.
- **Files in scope:** `scripts/check-idor-storage.js`, `scripts/__tests__/check-idor-storage.test.ts`, `server/storage/*.ts` (annotations/params only as triage requires).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #822 merged (the pin test this flips).

## Risks

- Widening may flag many long-standing functions; triage is the real work, not the regex.

## Updates

### 2026-08-16

- Initial creation from PR #822 review follow-up.

### 2026-08-16 (implementation)

- `EXPORT_FN_START` widened to a two-branch alternation covering both
  `export [async] function name(` and `export const name = [async] (`;
  `fnName = match[1] || match[2]` threads the arrow-const capture into the
  existing ALLOWLIST / `// idor-safe` / issue-reporting logic unchanged.
- Both real invocation paths (lint-staged glob `server/storage/*.ts` in
  `package.json`, and the no-arg discovery used by CI/preflight) are scoped
  exactly to `server/storage/*.ts` — the widened matcher has zero blast
  radius outside the checker's stated subject.
- Full no-arg scan over the real `server/storage/` tree (38 files) came back
  **clean** after the widening: no `export const name = [async] (` arrow
  exports exist there today (verified by direct grep, independently
  reverified by both dispatched reviewers). AC #2's triage requirement is
  legitimately vacuous, not skipped — no `userId` param, `// idor-safe`
  annotation, or ALLOWLIST entry was warranted because nothing new was
  flagged. The ALLOWLIST is unchanged at 55 entries (the Background section's
  "likely grow" prediction did not materialize).
- Class methods and re-exports (`export { ... } from`, `export * from`)
  confirmed absent for this shape in `server/storage/*.ts` by triage grep —
  left out of scope per the Implementation Notes' own allowance.
- Residual, structurally-identical blind spots that remain (none currently
  exist in `server/storage/`, flagged by review for future awareness, not
  fixed here — out of this todo's scope): type-annotated arrow consts
  (`export const foo: T = async (id) => …`), function-expression consts
  (`export const foo = function(id) {…}`), and curried arrow chains.
- Reviewed by `code-reviewer` + `security-auditor`: one WARNING (missing a
  sync/non-`async` arrow fixture) fixed inline with a new test case; two
  trivial SUGGESTIONs (defensive `if (!fnName) continue;` guard against a
  future third regex branch; a test name rewritten to describe behavior
  instead of narrating PR history) applied inline. No CRITICAL findings.
