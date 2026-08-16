---
title: "check-idor-storage: widen EXPORT_FN_START past the arrow-export blind spot"
status: backlog
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

- [ ] `EXPORT_FN_START` (or a second pattern) matches `export const <name> = [async] (` arrow exports
- [ ] Full no-arg scan over `server/storage/` triaged: every newly-flagged function either gains a `userId` param, an `// idor-safe` comment, or a justified ALLOWLIST entry
- [ ] The PR #822 pin test ("known matcher blind spot") flipped from pinning non-detection to asserting detection
- [ ] `scripts/__tests__/check-idor-storage.test.ts` gains a deny case for an arrow export

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
