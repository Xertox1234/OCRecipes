---
title: "reformulation offset test reds the full suite when a parallel worker deletes rows mid-window"
status: resolved
priority: medium
created: 2026-07-26
updated: 2026-08-13
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

- [x] The offset test no longer depends on a whole-table count taken across a
      window in which other workers may insert **or delete** rows
- [x] The test's assertions are scoped to rows this test owns (e.g. filter by the
      barcodes it seeded via `makeBarcode()`), so a concurrent worker's
      `afterEach` cannot affect the result in either direction
- [x] The page-size / non-overlap intent of the original test is preserved — it
      must still prove `getReformulationFlags` respects `limit` and `offset`, not
      merely that seeding worked
- [x] The misleading "Parallel-worker safety" comment is corrected or removed, so
      the next reader does not re-derive the same insufficient model
- [x] Running the full suite repeatedly (at least 3 consecutive `npm run test:run`
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

### 2026-08-13 — RESOLVED

Fixed in `fix/reformulation-offset-test-isolation`. Two corrections to this
todo's original analysis, both established by forcing the interleaving rather
than waiting for it:

```
npx vitest run server/storage/__tests__/reformulation.test.ts \
               server/storage/__tests__/verification.concurrent.test.ts
```

1. **The deleter is not another worker's `afterEach`.** It is
   `verification.concurrent.test.ts`, which deliberately opts out of the
   savepoint harness (it needs real distinct pool connections to exercise a lock
   race), COMMITS ~46 `status='flagged'` rows across its loops, and bulk-deletes
   them in `afterAll`. Those committed rows are visible to this file's
   transaction and then vanish. It is the only committer of `reformulation_flags`
   in the repo.
2. **Two failures, not one.** The forced pairing red on the first run with both
   `expected 4 to be 3` (a mid-window **insert** — so the original "absorbs their
   inserts" model was wrong in both directions) and `expected true to be false`
   at the **no-overlap** assertion (a row shifted between the two page queries,
   because READ COMMITTED re-snapshots per statement). The second was not
   identified in this todo and rules out fixing the count alone.

**Fix (offset test):** pin the three owned rows to distinct far-future
`detectedAt` values. Every foreign row is stamped at or before now, so ours
provably hold ordering positions 0/1/2 whatever else is in the table, and paging
over the head of the list stays inside owned rows. Assertions are now exact page
contents by barcode, including an `offset=1` window lying wholly within owned
rows. The pin asserts its own `timestamptz` round-trip, since the ordering
guarantee rests entirely on the stored value.

**Also fixed — the sibling count tests.** This todo predicted they shared the
latent bug; they did, and they were not latent: `counts flagged rows` reproduced
at **2/10** under the pairing (`expected -3 to be 1`), also surviving `retry: 2`.
The file's own comment claiming only the UNFILTERED count was flake-prone was
falsified — the concurrent writer's rows are `flagged`.

**The assertion shape depends on WHICH partition the foreign writer touches.**
An intermediate revision of this fix asserted a lower bound for _both_ count
tests, on the reasoning that an unscoped `count(*)` admits no deterministic
two-read delta at all. Review disproved that, and it is worth recording why: the
claim generalised from `flagged` to every status, which is the same modelling
error as the original "parallel workers only ADD rows" comment. The committer
only ever calls `flagReformulation`, never `resolveReformulationFlag`, and
deletes by barcode. So as shipped:

- `"flagged"` and the unfiltered count are foreign-churned → **lower bound**,
  paired with a barcode-scoped `getReformulationFlag` assertion. The bound alone
  is satisfiable by foreign rows and would pass even with the seeding disabled.
- `"resolved"` has no foreign writer → stable population → **exact delta** with
  a flagged **negative control**. Without the control a delta cannot distinguish
  a working filter from a dropped one, since the test's own inserts move a
  filtered and an unfiltered count identically. This is the only
  mutation-killing assertion in the block — do **not** "simplify" it back to a
  lower bound.

Correspondingly, do not repeat the claim that the `status` filter is covered by
the sibling `filters by status=…` tests: `getReformulationFlags` declares its
own `conditions` local, so exercising it says nothing about
`getReformulationFlagCount`'s.

**Verification (final, against the merged code — earlier figures in this file's
history predate the count-test reshaping):** hazard pairing 0/10 failures
against a red baseline for both original modes; file alone 17/17 exit 0;
mutation-killed `.offset(0)`, `conditions = undefined`, `ne`-for-`eq`, and
seeding-disabled; three consecutive `npm run test:run` passes. Per this todo's
Risks section, the pairing loop is the proof and the full-suite runs are
confirmation.

**Residuals (not fixed, by design):**

- The cross-file hazard itself — `verification.concurrent.test.ts` must commit
  real rows to do its job, so any future test asserting an exact _unscoped_
  aggregate over `reformulation_flags` hits the same wall.
- The exact `resolved` delta depends on an invariant owned by that other file
  (it never resolves a flag). A note beside its `flagReformulation` import
  records the constraint where someone would break it.
- A change to the `conditions` ternary's ELSE arm alone is caught only when
  `reformulation.test.ts` runs in isolation.
