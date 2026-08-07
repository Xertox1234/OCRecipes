---
title: A test comment must claim only what its own harness can observe
track: bug
category: code-quality
module: client
tags: [testing, mocks, documentation, review, accessibility, react-native]
applies_to: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx", "client/**/__tests__/*.test.tsx"]
symptoms: ["A test comment names a regression class it would catch", "The named regression lives in a module the test file mocks wholesale", "Reintroducing the regression leaves the test green", "A reviewer proposes deleting a sibling test suite as redundant with this one"]
created: '2026-08-06'
severity: medium
---

# A test comment must claim only what its own harness can observe

## Problem

A test's comment claimed its assertion would catch a regression that the test's **own
harness makes invisible**.

`client/screens/__tests__/NutritionDetailScreen.test.tsx` asserted
`expect(announce).toHaveBeenCalledTimes(1)` under a comment reading:

> Not drawn is not the same as not spoken, and the defect here was entirely about
> speech. A render-only assertion would stay green if **the hook's deleted announcer**
> were ever restored — it announces without rendering anything for `queryByText` to
> catch.

That file mocks the hook wholesale — `vi.mock("@/hooks/useNutritionLookup", ...)` at the
top — so a restored announcer **inside the hook** is not observable in that file at all.
The assertion cannot catch the regression the comment credits it with, and never could.

## Symptoms

- A test comment names a regression class it "would catch".
- That regression lives in a module the file mocks.
- A mutation reintroducing it leaves the test green.

## Root Cause

The comment was written from a mental model of the **system** rather than of the
**harness**. Both models are usually identical — which is why the habit is normally
safe — and they diverge in exactly one place: where a mock sits. The author was
reasoning correctly about production control flow (the hook really did announce, and
the screen really would not render anything for `queryByText` to see) and carried that
reasoning across a `vi.mock` boundary that silences it.

## Solution

Verified by mutation rather than argued:

- **Reintroducing the deleted effect into the real hook** turned the two
  `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx` tests red and left
  **every** `NutritionDetailScreen.test.tsx` test green — confirming the comment's claim
  was false.
- **Disabling `InlineError`'s own `Platform.OS === "ios"` announce gate** failed only
  that one assertion — confirming the assertion is **not decoration**. It is
  load-bearing, for a different reason than the comment gave.

Both halves matter. A write-up that says only "the comment lied" invites the next
maintainer to delete the assertion; it guards `InlineError`'s announce, which is real.
The comment was rewritten to the guarantee the harness actually provides:

> Note what this does and does NOT guard: this file mocks `useNutritionLookup`
> wholesale, so a restored announcer inside the HOOK is invisible here —
> `useNutritionLookup.labelRead` owns that, and its tests are not redundant with this
> one. What this assertion does catch, proven by mutation, is `InlineError`'s own
> [iOS-gated announce].

## Prevention

**When a test comment names a regression it guards, introduce that regression and
confirm the test goes red.** If it stays green, the comment is describing the system,
not the harness — rewrite it to what this file can observe, and name the file that
observes the rest.

The concrete risk of skipping this is not merely a stale comment. A maintainer reading
a false "this catches X" reasonably concludes that the sibling tests genuinely covering
X are **redundant, and deletes them**. Here the `useNutritionLookup.labelRead` hook
tests are the only tests in the repo that can see a hook-level announcer regression;
losing them to a comment's overclaim would remove the coverage while leaving a green
suite that appears to prove it.

State the ownership explicitly in the comment ("`X` owns that; its tests are not
redundant with this one") so the deletion argument is answered before it is made.

## Related Files

- `client/screens/__tests__/NutritionDetailScreen.test.tsx` — the corrected comment and the `toHaveBeenCalledTimes(1)` assertion
- `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx` — the tests that actually observe a hook-level announcer
- `client/components/InlineError.tsx` — the iOS-gated announce the assertion really guards

## See Also

- [tdd-red-phase-comment-left-in-shipped-test-2026-07-13.md](tdd-red-phase-comment-left-in-shipped-test-2026-07-13.md) — the adjacent failure: a comment that was true when written and went stale, versus this one, which the harness never made true
- [../conventions/test-guard-ordering-needs-toggleable-input-mock-2026-05-31.md](../conventions/test-guard-ordering-needs-toggleable-input-mock-2026-05-31.md) — related and narrower: a test made vacuous by its own mock, where the mock defeats the assertion rather than the comment describing it
- [../conventions/test-verified-against-one-trigger-misses-its-siblings-2026-08-05.md](../conventions/test-verified-against-one-trigger-misses-its-siblings-2026-08-05.md) — the red-then-green habit this rule extends: watching a test fail proves what it catches, so run it for every claim the comment makes
- [../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md](../conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md) — the same demand for a negative control, applied to a gate rather than a comment
- [../conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md](../conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md) — the other half of the same review: the residual collision this fixture now pins
