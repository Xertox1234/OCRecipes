---
title: "Remediate barcodeNutrition rows poisoned by the pre-Atwater reconcile policy (human-executed prod sweep)"
status: backlog
priority: medium
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, data-quality, barcode, nutrition]
github_issue:
human_led: true
blocked_reason: "Requires production database credentials + a manual DELETE/re-seed against live barcode_nutrition rows. Per docs/solutions/logic-errors/name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md this class is human-executed ONLY — never run autonomously (an auto-mode permission classifier also blocks reading prod DB creds). Re-check: has the barcode-source-pollution fix (P2-2026-07-22) deployed to prod before running the sweep."
---

# Remediate barcodeNutrition rows poisoned by the pre-Atwater reconcile policy

## Summary

The barcode source-pollution fix (P2-2026-07-22, Atwater self-consistency fallback) stops NEW pollution but does not self-heal rows already cached under the old policy — `storage.insertBarcodeNutritionIfAbsent` is strictly first-write-wins (`onConflictDoNothing`, no update/delete path exists). A human must delete the poisoned rows so a fresh scan re-seeds correct values.

## Background

`GET /api/nutrition/barcode/3017620422003` (Nutella) was live-verified returning a name-matched secondary's macros (182 kcal / 3.1g sugar) instead of OFF's correct 539 kcal / 56.3g sugar; that wrong row is cached in `barcode_nutrition`. The Atwater fallback (PR for P2-2026-07-22) **widens** the previously-poisoned population: before, only entries WITH per-serving energy were shielded; now any OFF entry lacking per-serving energy but with self-consistent macros is shielded too — so more historical rows may hold the wrong (secondary-replaced) values.

This mirrors the manual-sweep step the 2026-07-17 sibling fix already established (see that solution doc's `## Prevention`, and `todos/archive/P3-2026-07-17-off-self-consistency-gate-refinements.md` Updates for the exact commands). It could not be completed autonomously then, and cannot now.

## Acceptance Criteria

- [ ] Confirm the P2-2026-07-22 fix is deployed to prod before touching cached rows.
- [ ] Delete the known poisoned row: `DELETE FROM barcode_nutrition WHERE barcode = '3017620422003';` then re-scan/re-lookup to re-seed correct macros; verify `per100g.sugar ≈ 56.3` and the FSA `nutrient:sugar` flag fires.
- [ ] Broader sweep: identify + delete rows whose `source` is a secondary (`cnf`/`usda`/`api-ninjas`) for barcodes that DO resolve in OFF with complete, self-consistent per-100g macros (the population the Atwater fallback now protects), so they re-seed from OFF.
- [ ] Record the affected/remediated barcode count in this todo's Updates before archiving.

## Implementation Notes

- Human-executed against prod only (Railway). Read-only inspection first (count candidates), then targeted DELETE, then re-lookup.
- Do NOT run autonomously and do NOT delegate to any cheap-worker script — this touches live user-facing nutrition data.
- The re-seed happens automatically on the next `lookupBarcode` for each deleted barcode (fire-and-forget insert).

## Scope Contract

- **Mechanisms to use:** the `human_led` frontmatter gate — no new mechanism.
- **Files in scope:** none (operational/DB task); this todo file only.
- No code changes — this is a data remediation, not a code fix.

## Dependencies

- P2-2026-07-22 barcode-nutriment-source-pollution fix must be deployed to prod first.

## Risks

- A too-broad DELETE could evict correct rows (they simply re-seed on next scan, so low blast radius, but avoid a full-table wipe).

## Updates

### 2026-07-24

- Filed as a review follow-up to the P2-2026-07-22 barcode source-pollution fix (server-reviewer WARNING: poisoned first-write-wins rows are not self-healing).
