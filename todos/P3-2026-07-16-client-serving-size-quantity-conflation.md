<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Client OFF-fallback path still conflates `serving_size` with package `quantity` (server-side fixed in #642)"
status: backlog
priority: low
created: 2026-07-16
updated: 2026-07-16
assignee:
labels: [deferred, nutrition, barcode, client]
github_issue:

---

# Client OFF-fallback path still conflates `serving_size` with package `quantity`

## Summary

`client/lib/serving-size-utils.ts`'s `validateAndNormalizeNutrition` builds `rawServingSize` from `product.serving_size || product.quantity || ""` (line 306). PR #642 removed exactly this fallback server-side (`server/services/barcode-lookup.ts`) because `quantity` is the whole package's net weight, not a per-serving amount — a package weight that happens to parse under the plausibility thresholds can be scaled and labeled as trusted serving data. The client path has the identical conflation and was explicitly deferred out of #642's scope.

## Background

Surfaced as a DEFERRED_WARNING during the P3-2026-07-16-barcode-quantity-fallback todo (PR #642, merged as `bae7ba69`). The gap is documented as "known, deferred" in `docs/solutions/conventions/indicate-data-source-to-users-2026-05-13.md` (Exceptions section). This client path is only exercised when the server is unreachable (offline OFF fallback), which is why it was low-severity enough to defer — but it should match the server's semantics: `quantity` is the wrong field semantically, not a weaker version of the right one.

Note the client path differs from the server's in one relevant way: it already reads OFF's numeric `serving_quantity` field as a parse fallback (lines 307–313), which IS a real per-serving field — the very source #642's server-side comment names as the correct future recovery path for quantity-only products. So the fix here is a narrow removal of `product.quantity` from line 306, not a redesign.

## Acceptance Criteria

- [ ] Remove `product.quantity` from the `rawServingSize` construction in `validateAndNormalizeNutrition` (`client/lib/serving-size-utils.ts:306`), mirroring #642's server-side decision — do NOT down-weight it or add a partial-trust middle ground
- [ ] Keep the numeric `serving_quantity` fallback (lines 307–313) intact — it is a legitimate per-serving source, distinct from package `quantity`
- [ ] A quantity-only product (no `serving_size`, no `serving_quantity`, no explicit per-serving nutriments) falls back to the per-100g/untrusted path; verify whatever trust flag this file derives (`isServingDataTrusted` in the parsed-serving-weight branch) reflects that
- [ ] Add a regression test mirroring #642's server-side one: a product where only `quantity` is present and its value parses under the plausibility thresholds must NOT be treated as trusted serving data
- [ ] Update the "known deferred gap" note in `docs/solutions/conventions/indicate-data-source-to-users-2026-05-13.md` to record the gap as closed

## Implementation Notes

- Target: `client/lib/serving-size-utils.ts` line 306 (`const rawServingSize = product.serving_size || product.quantity || "";`), inside `validateAndNormalizeNutrition`
- Reference fix: PR #642 / commit `bae7ba69` — see the comment block it added above `rawServing` in `server/services/barcode-lookup.ts` for the full rationale (including why `quantity` must never be re-added)
- The explicit per-serving nutriment branch (Step 3, `existingPerServing` from `energy-kcal_serving` etc.) is unaffected — it never touches `rawServingSize`
- Existing tests for this file live in `client/lib/__tests__/` — check for current `validateAndNormalizeNutrition` coverage before adding scaffolding

## Dependencies

- None — the server-side counterpart (PR #642) is already merged

## Risks

- Low — behavior change only affects the offline OFF-fallback path for quantity-only products, which shifts from "possibly mislabeled as trusted" to the honest per-100g/untrusted fallback

## Updates

### 2026-07-16

- Filed at user request from PR #642's DEFERRED_WARNINGS after the /todo session merged #641–#644
