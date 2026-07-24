---
title: "A remediation classifier's verdict must be production's own criterion — value-delta proxies and partially-ported gates both misclassify"
track: bug
category: logic-errors
tags: [data-quality, barcode, nutrition, classifier, policy-drift, operator-tooling]
module: server
applies_to: ["scripts/**/*.ts"]
symptoms: ["operator sweep tool reports ok for a cached row production's current policy would replace with better data (Cherry Coke: 6.5 vs 11.1 kcal inside the calorie threshold, but 1.0 g fat on a cola)", "tool reports POISONED for a row the current policy would NOT shield, so deleting it re-seeds the identical value (churn) and inflates the remediation count", "verdicts change when a production tolerance is retuned, but the tool's don't (or vice versa)"]
created: 2026-07-24
severity: medium
---

# A remediation classifier's verdict must be production's own criterion

## Problem

`scripts/verify-barcode-cache-candidates.ts` classifies cached
`barcode_nutrition` rows as POISONED (operator deletes → row re-seeds from the
current pipeline) vs legitimate. Two versions of the same defect appeared in one
session:

1. **Proxy criterion (under-flag).** The verdict gated on "do cached and OFF
   calories differ materially?" (`> max(5, off·0.25)`). Cherry Coke's cached
   6.5 vs OFF's 11.1 kcal/100 ml passed the threshold — while the row carried
   1.0 g fat and 0.2 g protein *for a cola*, i.e. another food's macros. The
   operator left poisoned data in prod.
2. **Partially-ported gate (over-flag).** After importing the real policy
   primitives, the zero-calorie arm still shielded on `off100 === 0` alone.
   Production's explicit-zero shield ALSO requires the entry's own macros ≈ 0
   (`ZERO_CAL_MAX_MACRO_KCAL_100G`), per-serving zero, and un-contradicted kJ
   fields. A placeholder-zero OFF stub with real macros classified POISONED even
   though deleting it re-seeds the same secondary value.

## Symptoms

- See frontmatter; the unifying smell is any verdict expression in an operator
  tool that is *not* a direct statement of what the production code would do.

## Root Cause

The tool answered a different question than the one the DELETE depends on. The
only question that matters for delete-and-reseed remediation is: **"would the
current code produce a better row than the cached one?"** — i.e. does the
current policy's shield engage for this entry. Cached-vs-live value deltas are a
*symptom* that correlates with the answer; a subset of the gate's conditions is
an *approximation* of the answer. Both drift from it in opposite directions.

## Solution

- State the criterion explicitly in the tool's header, and derive the verdict
  from the production policy: import the real primitives (see the db-free leaf
  pattern) and make the verdict expression mirror the production gate
  condition-for-condition.
- For each production condition you deliberately do NOT port (e.g. it needs
  fields the tool doesn't fetch), write it down as an accepted residual **with
  its bias direction**, and choose the direction that self-heals — here,
  over-flagging costs one redundant delete + identical re-seed, while
  under-flagging leaves poisoned user-facing data.
- Delete value-delta thresholds from the verdict entirely; keep the values as
  informational table columns for the operator.
- When a known limitation ships anyway, pin it with a characterization test
  whose comment says it pins a limitation and must FLIP when the criterion is
  fixed (this session's Cherry Coke test did exactly that, and flipped).

## Prevention

- Review rule (code-reviewer checklist §3): any tool that composes or
  re-implements production policy gets its verdict expression diffed
  condition-by-condition against the source gate — importing real primitives
  does not drift-proof the composition.
- The dev/prod sweep runbook's discriminator ("candidate ≠ poisoned; verify each
  against live OFF") is this criterion in operational form.

## Related Files

- `scripts/verify-barcode-cache-candidates.ts` — `classify()` (criterion + documented residual)
- `scripts/__tests__/verify-barcode-cache-candidates.test.ts` — flipped characterization test; zero-stub regression test
- `server/services/barcode-lookup.ts` — `offSelfConsistent` (the source gate)
- `todos/archive/P2-2026-07-24-barcode-cache-poisoned-rows-remediation.md` — the prod sweep where the Cherry Coke under-flag was caught by hand

## See Also

- [partial-parse-regresses-crude-total-safety-scanner](partial-parse-regresses-crude-total-safety-scanner-2026-07-19.md) — same shape at the gate level: a smarter-but-PARTIAL model regresses where its holes are
- [name-matched-secondary-must-not-replace-self-consistent-label](name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md) — the production policy this classifier must track
- [../design-patterns/db-free-policy-leaf-module-for-operator-tooling-2026-07-24.md](../design-patterns/db-free-policy-leaf-module-for-operator-tooling-2026-07-24.md) — how the tool imports the real primitives in the first place
