---
title: "Kimi CI review reliability — minor follow-ups"
status: done
priority: low
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [deferred, testing]
github_issue:
---

# Kimi CI review reliability — minor follow-ups

## Summary

Three low-severity polish items surfaced by the final review of branch
`fix/2026-05-29-kimi-ci-reliability` (the deadline/retry/keep_unverified
hardening). The code is correct as-is; these improve test coverage, a comment,
and CI-log UX.

## Background

The reliability branch was reviewed per-task and holistically; it is correct and
ready. The final whole-branch review flagged three optional improvements that did
not block integration. Filed here so they aren't lost.

## Acceptance Criteria

- [x] Add a thin automated test for the `main()` deadline wiring (faked OpenAI
      client) so a regression that drops `deadline=deadline` from the draft
      `call_with_retry` or the `verify_agentic` call, or that recomputes the
      deadline per-phase, fails a test. Today the wiring is verified by inspection + the symbol smoke check only; all 63 harness tests would still pass if the
      wiring regressed.
- [x] Add a one-line comment at the `remaining = (deadline - time.monotonic()) ...`
      computation in `verify_agentic` documenting that a negative `remaining` is
      intentional (`as_completed(timeout=negative)` raises `TimeoutError`
      immediately → harvest loop → all unfinished CRITICALs become
      `keep_unverified`).
- [x] Reduce CI-log noise: a _persistent transient empty-verdict_ makes
      `call_with_retry` raise `RuntimeError("empty verdict content")`, which
      `verify_one_agentic`'s `except Exception` logs via `traceback.print_exc()` —
      reading like an engine bug. Consider logging a one-line warning for the
      `RuntimeError("empty ...")` case while keeping the full traceback for
      genuinely unexpected exceptions (BudgetExceeded is already separated out).

## Implementation Notes

- Engine source of truth is the CANONICAL `~/.local/share/claude-coworker/tools/kimi-review`;
  after any edit run `npm run kimi:engine:sync` (regenerates `scripts/kimi-review.py`)
  or the pre-commit drift check blocks the commit. See `docs/kimi-review-architecture.md`.
- The `main()` smoke test is awkward because `main()` does real I/O (git diff,
  file reads, OpenAI client). A faked client + monkeypatched `get_diff`/`git_root`
  in a `python3 -` heredoc (matching the existing harness style in
  `.claude/hooks/test-kimi-review.sh`) is the likely shape; wire it into both the
  runner and the canonical-parity `&&`-chain.
- Files in scope: `scripts/kimi-review.py` (via canonical), `.claude/hooks/test-kimi-review.sh`.

## Dependencies

- None. The reliability branch should be merged first (these refine it).

## Risks

- Low. All three are additive/cosmetic; none changes the verdict contract or the
  security/exit-code invariants.

## Updates

### 2026-05-29

- Initial creation from the final whole-branch review of
  `fix/2026-05-29-kimi-ci-reliability`.
- Completed all three items. AC1: `run_python_main_deadline_tests` added to
  `.claude/hooks/test-kimi-review.sh` (drives `main()` with a faked `openai`
  module + monkeypatched `git_root`/`get_diff`/`detect_profile`/
  `resolve_client_config` and faked `call_with_retry`/`verify_agentic`; asserts the
  draft and verify call sites receive the SAME non-`None` deadline, with a
  strictly-increasing `time.monotonic` so a per-phase recompute is guaranteed to
  fail). AC2: intent comment added at the `remaining = ...` line in
  `verify_agentic`. AC3: `verify_one_agentic`'s `except` now logs one line for a
  persistent empty-verdict `RuntimeError` and keeps the full traceback for genuine
  errors. Edited the canonical engine, re-synced via `npm run kimi:engine:sync`,
  drift check clean. Harness: 64 passed / 0 failed (was 63 → +1). Per the final
  review, no dedicated AC3 test was added — both `except` branches return
  `keep_unverified`, so an assertion on the return value cannot discriminate a
  correct AC3 from a broken one (existing case (c) already guards the contract).
