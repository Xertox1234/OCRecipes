---
title: "reformulation offset test reds the full suite when a parallel worker deletes rows mid-window"
status: backlog
priority: medium
created: 2026-07-26
updated: 2026-07-26
assignee:
labels: [testing, database, ci-reliability]
github_issue:
---

# reformulation offset test reds the full suite when a parallel worker deletes rows mid-window

## Summary

`server/storage/__tests__/reformulation.test.ts > getReformulationFlags >
respects offset parameter` intermittently fails the **full** suite with a
negative row-count delta (`expected -5 to be 3`), while passing 16/16 when the
file is run alone. It survives `retry: 2` — all three attempts fail — so the
existing flakiness mitigation does not cover it.

## Background

Observed 2026-07-26 during a `/todo` Phase 5 verification run on `main` at
`ec266b6c`, against code identical to a baseline that had passed 6917/6917
thirty minutes earlier. Re-running the file alone: 16/16 pass. Re-running the
full suite: 6917/6917 pass. So the tree is green and this is not a regression —
it is a test-isolation defect that reds CI on an unlucky interleaving.

The failure is **not** the CPU-contention flakiness class that `retry: 2` was
added for (see the `project_test_suite_flakiness` note). Retries re-run inside
the same suite window, while the other workers that cause it are still active,
so all three attempts see the same hazard.

Root cause is visible in the test itself (lines ~201-217):

```ts
const before = await getReformulationFlagCount();
// ... seed 3 rows ...
const after = await getReformulationFlagCount();
expect(after - before).toBe(3);
```

The comment above it states the intent explicitly:

> Parallel-worker safety: query a wide window first to capture the count we
> control, then derive expected page sizes from it.

That mitigation models concurrent workers as **monotonically adding** rows —
`after - before` absorbs their inserts. It does not survive a concurrent
**delete**: another worker's `afterEach` (line ~94) removing its own seeded rows
between the two reads drives the delta negative, which is exactly the observed
`-5` and `-1`.

## Acceptance Criteria

- [ ] The offset test no longer depends on a whole-table count taken across a
      window in which other workers may insert **or delete** rows
- [ ] The test's assertions are scoped to rows this test owns (e.g. filter by the
      barcodes it seeded via `makeBarcode()`), so a concurrent worker's
      `afterEach` cannot affect the result in either direction
- [ ] The page-size / non-overlap intent of the original test is preserved — it
      must still prove `getReformulationFlags` respects `limit` and `offset`, not
      merely that seeding worked
- [ ] The misleading "Parallel-worker safety" comment is corrected or removed, so
      the next reader does not re-derive the same insufficient model
- [ ] Running the full suite repeatedly (at least 3 consecutive `npm run test:run`
      passes) shows no recurrence

## Implementation Notes

- Preferred shape: derive expectations from **this test's own barcodes** rather
  than a global count. `getReformulationFlags` orders by `desc(detectedAt)` and
  `detectedAt` is `CURRENT_TIMESTAMP` (fixed per transaction), so the existing
  tie-break caution in the comment is still valid and should be kept — the fix is
  about _which rows are counted_, not about ordering.
- Do NOT "fix" this by raising `retry`. Retries re-run inside the same
  concurrency window and all three already fail; a higher retry count converts a
  reproducible isolation bug into a slower reproducible isolation bug.
- Do NOT serialize the file (`describe.sequential`, `--no-file-parallelism`) as
  the primary fix — that hides the defect and slows the suite. Only consider it
  if scoping to owned rows proves genuinely impossible.
- Check the sibling tests in the same `describe` for the same whole-table-count
  pattern; if they share it, they share the latent bug even if they have not
  failed yet.

## Scope Contract

- **Mechanisms to use:** the test file's existing `makeBarcode()` /
  `seedBarcodeVerification()` / `flagReformulation()` helpers and standard Vitest
  assertions. No new test-infra abstraction, no vitest config change, no
  production-code change.
- **Files in scope:** `server/storage/__tests__/reformulation.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Scoping to owned rows can make the offset assertion vacuous if the seeded set
  is smaller than the page size — the test must still exercise a real second
  page, not just assert an empty tail.
- Reproducing on demand is the hard part: the failure needs a specific
  interleaving. Judge the fix by whether the assertion is _structurally_
  independent of other workers' rows, not by "it passed three times."

## Updates

### 2026-07-26

- Initial creation. Observed during `/todo` Phase 5 verification; isolated to a
  concurrent-delete window rather than CPU contention, and confirmed to survive
  `retry: 2`.
