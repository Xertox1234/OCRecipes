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

Surfaced and deliberately pinned (not fixed) in PR #822: widening the matcher is a security-checker semantic change that requires re-auditing all of `server/storage/` for newly-visible functions and likely growing the 45-entry ALLOWLIST — too much scope for a test PR. The blind spot is documented by a pin test so the gap is at least visible.

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
  flagged. The ALLOWLIST is unchanged at **45** entries — the earlier "55" was
  a miscount; verified two ways (quoted-entry line count and parsing the block
  into a `Set` and reading `.size`), and the block is byte-identical
  (sha256 `3e1cd255de33b2f7…`) across `origin/main`, this branch's first
  commit, and the review-fix commit. The Background section's "likely grow"
  prediction did not materialize.
- Class methods and re-exports (`export { ... } from`, `export * from`)
  confirmed absent for this shape in `server/storage/*.ts` by triage grep —
  left out of scope per the Implementation Notes' own allowance.
- Residual, structurally-identical blind spots that remain (none currently
  exist in `server/storage/`, flagged by review for future awareness, not
  fixed here — out of this todo's scope): type-annotated arrow consts
  (`export const foo: T = async (id) => …`), function-expression consts
  (`export const foo = function(id) {…}`), and curried arrow chains.
  **Superseded by the 2026-08-16 (review fixes) entry below — the
  type-annotated arrow is now detected.**
- Reviewed by `code-reviewer` + `security-auditor`: one WARNING (missing a
  sync/non-`async` arrow fixture) fixed inline with a new test case; two
  trivial SUGGESTIONs (defensive `if (!fnName) continue;` guard against a
  future third regex branch; a test name rewritten to describe behavior
  instead of narrating PR history) applied inline. No CRITICAL findings.

### 2026-08-16 (review fixes on PR #841)

Two WARNINGs and two SUGGESTIONs from the PR #841 review round, all applied.
No ALLOWLIST entry and no `// idor-safe` annotation was added.

- **W1 — remaining arrow blind spots closed.** The first widening still missed
  a type-annotated arrow (`export const getById: Getter = async (id) => …`,
  broken by `(\w+)\s*=`) and a generic arrow (`export const getById =
async <T,>(id) => …`, type params sitting between `async` and `(`). Both are
  the exact class this todo exists to close. `EXPORT_FN_START` now carries
  `(?::[^=]*)?` before the `=` and `(?:<[^>]*>\s*)?` before the parens.
- **W1b — extra find beyond the review list.** The same type-parameter
  position breaks the _function_ branch too: `export async function
getById<T>(recipeId: number)` was blind on both `main` and the first
  widening. Closed with the same `(?:<[^>]*>\s*)?` token on that branch.
- **W2 — arrow branch no longer over-matches non-function consts.** Matching
  on `= (` alone flagged `export const cache = (recipeId);`,
  `export const LIMIT = (MAX_recipeId + 1);` and an IIFE const as IDOR-risk
  "functions". That failed loud, not open, but the tool's own remediation text
  then told developers to add `// idor-safe` or an ALLOWLIST entry to a
  non-function — suppression-training the guard exists to prevent.
  `extractParams` now also returns the remainder of the closing-paren line,
  and an arrow-branch match must satisfy `ARROW_TAIL` (`/^\s*(?::[^=]*)?=>/`)
  before it is treated as a function. Gated on `match[2]` only — requiring
  `=>` on the `function` branch would silence the whole guard.
- **S1 — the arrow "pass" test was non-discriminating.** `arrows-safe.ts` ran
  identically (exit 0) against the pre-widening regex, so it could not tell
  "arrow parsed and judged safe" from "arrow invisible". The fixture now holds
  a safe and an unsafe arrow export and asserts the output names only the
  unsafe one; verified it exits 0 / names nothing against `origin/main`'s
  regex and exits 1 / `Errors: 1` naming only `getEntryById` after the fix.
- **S2 — unnamed-match comment was backwards.** It claimed a `continue` on a
  matched-but-unnamed export "fails closed"; for a detector, skipping a
  declaration it could not inspect is fail-OPEN — a silently missed IDOR.
  Reworded, and strengthened: such a match is now recorded and `main()` exits 1
  before any success path. (`main()` ends its clean path with an explicit
  `process.exit(0)`, which would clobber a `process.exitCode = 1` set from
  `checkFile` — hence the module-level record read by `main()`.) Unreachable
  today; both branches carry a capture group.
- **Real-tree re-verification order matters.** The no-arg scan over the real
  `server/storage/` (38 files) was run with the widened regex _before_ the
  `ARROW_TAIL` gate was added, and came back clean — so "clean" is not an
  artifact of the gate hiding a true positive. Re-run after the gate: still
  clean.
- **W2 follow-up — the gate initially removed coverage; closed.** Requiring
  `=>` on the _same line_ as the closing paren introduced a **net-new** false
  negative that the first widening had detected: a prettier-wrapped signature
  puts the arrow on its own line —

  ```ts
  export const getEntryById = async (
    entryId: number
  )
    : Promise<Entry> => {
  ```

  — leaving the same-line tail empty, so the gate skipped it. Confirmed by
  probe: branch HEAD `exit=1 FLAGGED`, first gate `exit=0 not flagged`. A
  security detector must not lose a shape it already covered, so this was
  fixed rather than documented: `extractParams` now also returns `restLine`,
  and `hasArrowTail()` looks ahead to the next non-blank line (bounded by
  `ARROW_TAIL_LOOKAHEAD_LINES = 5`) **only when the closing paren ends its
  line**. `ARROW_TAIL` is start-anchored, so an unrelated following statement
  (`const x = () => 1;`) does not satisfy it, and both wrapped non-function
  const variants stay unflagged. Two tests added (deny: wrapped arrow — RED
  against the pre-lookahead commit; pass: wrapped non-function const).

- **Callers re-verified this round** (not inherited): `git grep -n
"check-idor-storage"` returns exactly three invocation sites —
  `package.json` lint-staged under the `server/storage/*.ts` glob,
  `.github/workflows/ci.yml:55` (no-arg), and `scripts/preflight.sh:175`
  (no-arg). Both modes are scoped to `server/storage`; there is no third
  caller with a broader glob.
- **Known residuals** (documented in the script, none present in
  `server/storage/` today, all pre-existing — none introduced by this round):
  nested generics (`<T extends Record<string, number>>`, since `[^>]*` stops
  at the first `>`); function-expression consts
  (`export const foo = function (id) {…}`); curried arrow chains.
- Tests: 12 → 18 in `scripts/__tests__/check-idor-storage.test.ts`, all green.
  Every new/changed case was verified RED against the right baseline first
  (the arrow/generic deny cases and the non-function pass case against branch
  HEAD; S1 against `origin/main`; the wrapped-arrow deny case against the
  pre-lookahead commit `ccf442c6`).
