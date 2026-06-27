---
title: "Investigate IDE false-positive TS2307 module-resolution errors on auth-account-throttle.test.ts"
status: backlog
priority: low
created: 2026-06-27
updated: 2026-06-27
assignee:
labels: [deferred, code-quality, tooling]
github_issue:
---

# Investigate IDE false-positive TS2307 module-resolution errors on auth-account-throttle.test.ts

## Summary

The IDE/tsserver reports four `TS2307 Cannot find module` diagnostics on
`server/routes/__tests__/auth-account-throttle.test.ts`, but every imported
module exists on disk and `tsc`/CI are green. Confirm it is purely an editor
artifact (stale tsserver project graph) and decide whether any action is
warranted, or close as a known false positive.

## Background

During a dependency review session (2026-06-27) the harness surfaced these
editor diagnostics on the file:

```
auth-account-throttle.test.ts
  [9:32]  Cannot find module '../../__tests__/factories'   TS2307
  [10:25] Cannot find module '../../storage'               TS2307
  [16:8]  Cannot find module '../_rate-limiters'           TS2307
  [17:26] Cannot find module '../auth'                     TS2307
```

These were investigated **without changing code**. Findings:

- The file is **tracked and clean** (`git ls-files` lists it; not in
  `git status --porcelain`) — i.e. no uncommitted edits are confusing the editor.
- **All four import targets exist on disk** and resolve correctly:
  | Import | Resolved target on disk |
  |---|---|
  | `../../__tests__/factories` | `server/__tests__/factories/index.ts` |
  | `../../storage` | `server/storage/index.ts` |
  | `../_rate-limiters` | `server/routes/_rate-limiters.ts` |
  | `../auth` | `server/routes/auth.ts` |
- These are **relative imports** (not `@/` / `@shared/` aliases), so a tsconfig
  `paths` misconfiguration is not the cause.
- `main`'s required CI gate runs `tsc --noEmit` (the `Lint·Types·Patterns`
  check) and is green for the commit that contains this file — so the TS2307
  cannot be a real compile error.

Conclusion: almost certainly a **stale/cold tsserver project graph** in the
editor (the same class of artifact documented in the
`feedback_ide_diagnostics_worktree_false_positives` auto-memory, but here in the
**main checkout** rather than a worktree). This todo is to verify that
conclusion in a fresh session and decide whether anything is worth doing beyond
"restart the TS server."

## Acceptance Criteria

- [ ] Confirm `npm run check:types` (`tsc --noEmit`) reports **no** error for
      `server/routes/__tests__/auth-account-throttle.test.ts` (expected: clean,
      matching green CI on main).
- [ ] Confirm the test itself runs and passes:
      `npx vitest run server/routes/__tests__/auth-account-throttle.test.ts`.
- [ ] Determine the trigger of the editor diagnostics: does an IDE/tsserver
      restart (or an LSP `hover` warm-up) clear them? Is the test file included
      in a tsconfig `project` the editor is using, or is it falling into an
      implicit/inferred project that can't resolve the relative paths?
- [ ] Decide the outcome: - if purely an editor artifact → document it (link the existing
      false-positive memory / `docs/rules/lsp.md`) and close, OR - if it reproduces under `tsc`/CI → treat as a real regression and fix the
      import or tsconfig `include` (do NOT assume false-positive without the
      tsc run above).
- [ ] If a low-cost config change keeps the editor quiet without masking real
      errors (e.g. a tsconfig `include` adjustment), note the tradeoff; otherwise
      record "tsserver restart is the remedy" so future sessions don't re-chase it.

## Implementation Notes

- Primary file: `server/routes/__tests__/auth-account-throttle.test.ts`
  (imports on lines 9, 10, 11-16, 17).
- Import targets to keep in mind when checking tsconfig membership:
  `server/__tests__/factories/index.ts`, `server/storage/index.ts`,
  `server/routes/_rate-limiters.ts`, `server/routes/auth.ts`.
- Per project rules: do NOT run `check:types`/`test:run` ad-hoc _mid-session_ —
  but for THIS todo the explicit `tsc` + targeted vitest run **are** the
  verification deliverable, so running them is in scope.
- LSP cold-start gotcha applies: the first LSP query of a session can be
  degraded — warm tsserver with a throwaway `hover` before trusting a
  find-references / resolution result (see `docs/rules/lsp.md`).
- Relevant auto-memory: `feedback_ide_diagnostics_worktree_false_positives`
  ("Cannot find module + implicit-any squiggles contradict a clean tsc; trust
  tsc/CI, not the editor"). This case extends that pattern to the main checkout.

## Dependencies

- None. Self-contained investigation; no external services.

## Risks

- Low. The likely outcome is "confirmed editor artifact, no code change." The
  only real-defect scenario (TS2307 reproduces under `tsc`) is ruled out by
  current green CI on main, but the fresh session should still run `tsc` to be
  certain before closing.

## Updates

### 2026-06-27

- Initial creation. Investigated during a dependency-review session: confirmed
  all four imports resolve on disk, file is tracked & clean, and CI's required
  `tsc --noEmit` gate is green for the file — pointing to a stale tsserver
  project graph as the cause. Deferred to a fresh session for final
  verification per user request.
