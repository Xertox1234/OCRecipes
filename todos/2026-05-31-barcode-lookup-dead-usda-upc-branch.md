---
title: "Resolve dead cross-validation branch in barcode-lookup lookupBarcode (USDA-UPC-only path)"
status: backlog
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, nutrition, code-quality]
github_issue:
---

# Dead USDA-UPC-only cross-validation branch in lookupBarcode

## Summary

In `server/services/barcode-lookup.ts`, the `lookupBarcode` reconciliation path that fires when there is **no OpenFoodFacts product but a USDA-by-UPC match exists** (`!offProduct && usdaByUPC`) contains an unreachable cross-validation branch: the CNF/USDA secondary search terms are derived solely from the (absent) OFF product, so `secondaryPer100g` is always `null` there and the cross-comparison can never run. Decide whether to delete the dead branch or fix the secondary-term derivation so cross-validation actually happens.

## Background

Surfaced during the 2026-05-31 `nutrition-lookup` refactor (todo `2026-05-31-nutrition-lookup-refactor`, branch `todo/2026-05-31-nutrition-lookup-refactor`). It is a **pre-existing** condition, not introduced by the refactor — the extraction preserved behaviour faithfully and pinned the path with a new regression test. The refactor's advisor flagged it YELLOW and it was surfaced for separate triage rather than changed inside a behaviour-preserving refactor.

No wrong results are produced today: in the USDA-UPC-only path the USDA-by-UPC data is authoritative and is used directly. The issue is structural — the code reads as if it intends to cross-validate against a second source, but in that branch a second source is structurally impossible, so the branch is dead code that misleads future readers.

## Acceptance Criteria

- [ ] Determine the original intent of the secondary/cross-validation branch in the `!offProduct && usdaByUPC` path (git blame + the reconciliation logic in `reconcilePer100g`).
- [ ] Either (a) remove the unreachable cross-validation branch and document why USDA-by-UPC is used directly, OR (b) derive the secondary search terms from the USDA product name (not the absent OFF product) so cross-validation can actually run — whichever matches intent.
- [ ] The existing regression test that pins this path is updated to reflect the chosen behaviour (and still passes).
- [ ] No change to the OFF-present reconciliation paths; behaviour there stays identical.
- [ ] All existing nutrition-lookup / barcode-lookup tests pass.

## Implementation Notes

- File: `server/services/barcode-lookup.ts`, `lookupBarcode` Step-4 reconciliation, specifically the branch guarded by no-OFF-product + USDA-by-UPC.
- The `reconcilePer100g(primary, secondary, secondarySource)` helper (extracted in the refactor) is where the gap-fill/comparison lives — trace how `secondary` is computed in this path.
- This depends on the nutrition-lookup refactor branch having merged (so `barcode-lookup.ts` exists). If that branch is still open, rebase onto it.
- Treat this as nutrition-domain correctness: confirm with the data pipeline behaviour (CNF → USDA → API Ninjas) before deleting vs. fixing.

## Dependencies

- `todos/archive/2026-05-31-nutrition-lookup-refactor.md` — the refactor that created `barcode-lookup.ts` (branch `todo/2026-05-31-nutrition-lookup-refactor`). This todo's file only exists after that branch merges.

## Risks

- The reconciliation thresholds (calorie ratio 0.5–2.0, gap-fill priority order) are subtle; changing secondary-term derivation could alter which source wins in real barcode lookups. Add/keep unit tests for the affected branch before and after.

## Updates

### 2026-05-31

- Created from the `nutrition-lookup-refactor` deferred warning (advisor YELLOW). Pre-existing dead branch; user chose to file as a Medium todo during `/todo` deferred-warning triage.
