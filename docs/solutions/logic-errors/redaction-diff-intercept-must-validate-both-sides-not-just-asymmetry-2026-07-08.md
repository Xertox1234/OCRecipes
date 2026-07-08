---
title: A diff guard that intercepts on "one side looks redacted" must also confirm the other side would actually BE redacted, or it silently swallows real changes
track: bug
category: logic-errors
module: server
severity: high
tags: [redaction, diff, false-negative, heuristic, contract-snapshot, pg-lab]
symptoms: ['A structural diff function reports "no differences" for two shapes that are genuinely, meaningfully different', 'A security fix meant to stop a data-redaction placeholder from leaking real key names instead causes real, unrelated key/shape changes to go undetected', 'A test suite that only covers the intended migration scenario (real dynamic data before a fix vs. its redacted form after) passes cleanly while a differently-shaped case (a static field replaced by a dynamic map) silently reports no diff']
applies_to: [server/lib/contract-shape.ts, scripts/pg-lab/contract-diff-cli.ts]
created: '2026-07-08'
last_updated: '2026-07-08'
---

# A diff guard that intercepts on "one side looks redacted" must also confirm the other side would actually BE redacted, or it silently swallows real changes

## Problem

`server/lib/contract-shape.ts`'s `deriveShape()` redacts dynamically-keyed objects (user
emails, UUIDs, free-text item-name maps) to a `{ "<dynamic>": <mergedValueShape> }`
placeholder before storage, so sensitive key names never land in
`dev.contract_snapshots`. A follow-up fix to `diffRouteShapes()` needed to stop an old
pre-redaction snapshot's real key names from being reprinted when diffed against a new,
correctly-redacted one (the intended migration scenario: same conceptual dynamic data,
redacted on one side, not the other).

The fix intercepted on a single signal: "exactly one side's key set is the sole
`<dynamic>` placeholder" (`isRedactedKeySet(base) !== isRedactedKeySet(feature)`). When
that fired, it discarded key-by-key comparison entirely and compared only a
reconstructed merged value shape. This over-broad trigger condition silently swallowed a
**different, real defect class**: a route whose response genuinely changed from a static
object (e.g. `{ width, height }`) to an unrelated dynamically-keyed map, where the merged
value types happened to coincide (both `number`), was reported as "no differences" —
exactly the opposite of a diff tool's job. A less severe sibling gap: even when a real
difference *was* detected, the branch collapsed it to a lossy `retyped: ["<dynamic>"]"`
instead of the real `added`/`removed` key names, which were safe to show (a key that
doesn't match the redaction heuristic is by definition not the kind of key that needed
protecting).

## Symptoms

- A code review (10 independent finder-agent angles + a gap sweep) found this
  independently from 3 different angles, all converging on the same root cause — a strong
  signal the gap was structural, not a one-off oversight.
- Every existing regression test for the new branch used the SAME shape of input (real
  emails vs. `<dynamic>`) as the intended migration scenario — none tested a shape change
  that was NOT a redaction migration, so the false negative had zero test coverage despite
  the PR shipping "3 regression tests."
- Directly executing the function with a hand-built `{width, height}` vs. `{"<dynamic>": number}`
  pair reproduces the bug in one line — this class of gap is fast to confirm once
  suspected, but easy to miss by reading the diff alone, because the code *looks* correct:
  it reads as "handle the redaction case," not "handle every case where one side happens
  to look like the placeholder."

## Root Cause

The fix conflated two different conditions that happen to produce the same superficial
signal (`isRedactedKeySet` differs between the two sides):

1. **The intended case**: this is genuinely the same dynamic data, observed before and
   after PR #544 shipped — the non-redacted side's real keys WOULD be redacted by
   `deriveShape` if derived today (they match `looksDynamicallyKeyed` or
   `hasUniformNonPrimitiveValueShape`).
2. **An unrelated case**: the route's response shape actually changed between branches —
   from a static, non-redactable object to a dynamic map, or vice versa. The non-redacted
   side's real keys do NOT and never would qualify for redaction.

`isRedactedKeySet` alone cannot distinguish these — it only inspects the *redacted* side's
key set (is it exactly `["<dynamic>"]`?), never the *other* side's real keys. Both cases
produce `baseRedacted !== featureRedacted`, but only case 1 is safe to intercept and
compare via merged value shapes; case 2 needs the normal per-key diff to fire, because
that's a real, reportable change that the tool exists to catch.

A closely related manifestation: a route whose real, static field happens to be **named
the literal string `"<dynamic>"`** (an unlikely but possible coincidence) is
indistinguishable from a true redaction placeholder by `isRedactedKeySet` alone, since it
only does a string-equality check on the key name, not a check of *how* that shape was
derived.

## Solution

Before trusting an asymmetric redaction signal, re-apply `deriveShape`'s own redaction
heuristic (`looksDynamicallyKeyed` / `hasUniformNonPrimitiveValueShape` — the exact
functions that decide whether to redact) to the **non-redacted** side's real keys. Only
intercept and reconstruct-and-compare when that side would actually qualify as dynamic
today; otherwise fall through to the normal per-key loop, which is safe because a key
that fails the heuristic is by definition not the kind of sensitive/dynamic data the
placeholder protects:

```typescript
const baseRedacted = isRedactedKeySet(baseKeys);
const featureRedacted = isRedactedKeySet(featureKeys);
if (baseRedacted !== featureRedacted) {
  const realKeys = baseRedacted ? featureKeys : baseKeys;
  const realKeyNames = Object.keys(realKeys);
  const realValueShapes = Object.values(realKeys);
  const realMergedValue = mergeShapes(realValueShapes);
  const realSideLooksDynamic =
    looksDynamicallyKeyed(realKeyNames) ||
    hasUniformNonPrimitiveValueShape(realValueShapes, realMergedValue);

  if (realSideLooksDynamic) {
    // Genuine pre/post-redaction migration: compare value shapes only, never real keys.
    const baseValue = baseRedacted ? baseKeys[DYNAMIC_KEY_PLACEHOLDER] : realMergedValue;
    const featureValue = featureRedacted ? featureKeys[DYNAMIC_KEY_PLACEHOLDER] : realMergedValue;
    return {
      added: [],
      removed: [],
      retyped: canonicalKey(baseValue) === canonicalKey(featureValue) ? [] : [DYNAMIC_KEY_PLACEHOLDER],
    };
  }
  // else: not a redaction migration -- fall through to the normal per-key loop, which
  // safely reports real added/removed/retyped keys (they were never classified as
  // dynamic/sensitive, so printing them is not a leak).
}
```

This single guard resolves BOTH the false-negative (case 2 above) and the
`"<dynamic>"`-literal-name collision, because both stem from the same missing check:
never trust "one side looks like the placeholder" without confirming the other side
would independently earn that classification.

As a side benefit, reusing `realMergedValue` for both the interception decision and the
comparison itself (instead of two separate, duplicated ternaries each independently
recomputing `mergeShapes`) also removed a cleanup/simplification finding from the same
review pass — validating the redaction hypothesis and eliminating the code duplication
turned out to be the same refactor.

## Prevention

- When a fix intercepts on a signal that's *correlated* with the bug you're solving but
  isn't *definitionally identical* to it (here: "one side is redacted" correlates with,
  but doesn't prove, "this is a pre/post-migration comparison of the same conceptual
  data"), write the test that would prove the correlation false before shipping — a case
  where the signal fires for an unrelated reason. Here: a genuine static-to-dynamic shape
  change with coincidentally-matching value types was the disproof case, and it was never
  tested.
- If a heuristic function already exists to make a classification decision (here,
  `looksDynamicallyKeyed` / `hasUniformNonPrimitiveValueShape`, which `deriveShape` itself
  uses to decide whether to redact), reuse the SAME function everywhere that
  classification matters, rather than inventing a narrower proxy check (`isRedactedKeySet`,
  which only inspects the *result* of a prior redaction decision, not whether that
  decision would independently apply to new data). A proxy check can drift out of sync
  with the real decision it's standing in for.
- A code review that runs many independent finder angles in parallel (rather than a
  single linear pass) is well-suited to catching this class of bug: 3 separate angles
  (removed-behavior auditor, cross-file tracer, wrapper/proxy correctness) converged on
  the identical root cause from different starting questions, which is strong evidence
  the gap was structural rather than a one-off blind spot any single angle might have
  missed.

## Related Files

- `server/lib/contract-shape.ts` — `diffRouteShapes()` (the fixed function),
  `looksDynamicallyKeyed()` / `hasUniformNonPrimitiveValueShape()` (the reused heuristic,
  originally written for `deriveShape()`'s own redaction decision).
- `scripts/pg-lab/contract-diff-cli.ts` — `formatReport()` / `buildDiffReport()`, the
  consumers that inherited the false negative unmodified (no fix needed there once the
  root cause in `diffRouteShapes` was corrected).
- `server/lib/__tests__/contract-shape.test.ts` — regression tests for both the false
  negative and the `"<dynamic>"`-literal-name collision, added alongside the fix.

## See Also

- `todos/archive/P1-2026-07-08-contract-diff-cli-leaks-old-unredacted-keys.md` — the
  original todo this fix followed up on (PR #544's redaction leak into the diff/CLI
  layer); this solution documents a regression introduced while fixing that todo.
