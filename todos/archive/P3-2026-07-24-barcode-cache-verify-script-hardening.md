---
title: "Harden the barcode cache-sweep classifier: macro-aware verdict, padding variants, fetch-error surfacing, drift-proof policy"
status: done
priority: low
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, barcode, nutrition, data-quality, tooling]
github_issue:
---

# Harden the barcode cache-sweep classifier

## Summary

`scripts/verify-barcode-cache-candidates.mjs` (added in PR #702) classifies `barcode_nutrition` rows as POISONED vs legitimate so an operator can delete the poisoned ones. A `/code-review medium` of that PR reported 7 findings; 3 were fixed in the PR (argument validation, stale filename references, missing test). These 4 were deliberately deferred.

## Background

The script's verdicts turn directly into a `DELETE` an operator runs against production, so its failure modes are "operator leaves poisoned data" or "operator deletes an unverified row" — not crashes. All four items below were surfaced by review of real remediation runs against dev and prod on 2026-07-24, not hypotheticals.

## Acceptance Criteria

- [x] **Macro-aware verdict (highest value).** The `materially` gate in `classify()` compares calories only, so a row whose energy lands close to OFF but whose macros came from a different food scores `ok`. Live case: `06772408` Cherry Coke cached 6.5 kcal/100 ml vs OFF's 11.1 — a 4.6 delta, inside `Math.max(5, off100 * 0.25)` — while the row carried **1.0 g fat and 0.2 g protein for a cola**. Change the criterion from _"do calories differ materially?"_ to _"would the current code produce a better row?"_ (source is a secondary AND OFF now shields the entry), or extend the comparison to macros. **When this lands, flip the characterization test** `does NOT flag macro-only pollution when calories happen to be close` to expect `POISONED` — it is labelled in-file as pinning a known limitation, not intended behaviour.
- [x] **OFF barcode padding variants.** The script queries OFF with the literal barcode only; production tries up to four padded/check-digit forms via `barcodeVariants` (`server/services/barcode-lookup.ts`). A row cached under a padding form OFF does not index reports `(not in OFF)` → `LEGITIMATE` → "do NOT delete", so a poisoned row survives permanently. The dev cache held exactly this shape (`0060383653293` and `060383653293` as separate rows), though a direct test of the unpadded form did resolve — the divergence from production is real but was not reproduced on that sample.
- [x] **Surface fetch errors instead of burying them.** A failed fetch pushes a differently-shaped row (3 keys vs 6) that `console.table` renders as mostly `undefined`, and it counts toward the `POISONED: N of M` denominator without being called out — so partial coverage reads as complete. An operator can run the emitted DELETE believing all candidates were checked. Also give the error branch the same 900 ms sleep the other paths use; it currently `continue`s immediately, so a rate-limited run retries at full speed.
- [x] **Stop mirroring production policy.** `valuesMatch`, `corroborates`, and the hardcoded `0.3` re-implement logic that is already exported (`offMacrosCorroborateEnergy` in `server/services/barcode-lookup.ts`, `valuesMatch` in `server/lib/verification-consensus.ts`). If `ATWATER_MACRO_TOLERANCE` is retuned — plausible, since the 0.25-vs-0.30 choice and the fiber-handling question are both explicitly open — the script silently reports verdicts the server would not produce, defeating its entire purpose. The new unit tests pin the mirrored copies' _current_ behaviour but cannot detect drift from the server's. Convert to `.ts` run via `npx tsx` and import the real functions.

## Implementation Notes

- Files in scope: `scripts/verify-barcode-cache-candidates.mjs` (or its `.ts` successor) and `scripts/__tests__/verify-barcode-cache-candidates.test.ts`.
- The test suite is hermetic by design: CLI cases use `spawnSync` and only exercise argument rejection, which returns **before** the first OFF request. Preserve that — a test that reaches the network is a regression signal, not flakiness.
- Context for the whole remediation: `todos/archive/P2-2026-07-24-barcode-cache-poisoned-rows-remediation.md` (runbook + the dev/prod sweep results) and `docs/solutions/logic-errors/name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md`.

## Dependencies

- PR #702 must merge first (it adds the script and its test suite).

## Updates

### 2026-07-24 — all 4 ACs implemented; todo closed

Implemented in 5 TDD steps on `todo/P3-2026-07-24-barcode-cache-verify-script-hardening`:

1. **Scope-contract extension (user-approved in session):** "import the real functions" was impossible within the stated file scope — importing anything from `barcode-lookup.ts` transitively evaluates `server/db.ts`, which throws without `DATABASE_URL`. The pure policy (`barcodeVariants`, `offMacrosCorroborateEnergy`, `BarcodePer100g`, `ZERO_CAL_MAX_MACRO_KCAL_100G`, new `offEnergyKcal`) moved to db-free `server/services/barcode-policy.ts`; `barcode-lookup.ts` re-exports, so no consumer changed. `ATWATER_MACRO_TOLERANCE` stays module-private per review — consumers get the 0.3 policy via `offMacrosCorroborateEnergy`. A spawned no-`DATABASE_URL` import test pins the module as db-free forever.
2. Script converted to `scripts/verify-barcode-cache-candidates.ts` (`npx tsx`), importing the real policy; mirror-pinning test blocks deleted (behaviour pinned at source suites).
3. Macro-aware verdict: POISONED = OFF resolves AND policy shields; the calorie-delta gate is deleted; the characterization test flipped to POISONED as instructed.
4. `resolveOffProduct` mirrors production's variant loop (order-pinned test; errored-variants-never-LEGITIMATE).
5. `runSweep`/`summarize` extraction: uniform 7-column rows, unchecked candidates excluded from the denominator with a stderr coverage warning, sleep on every path, exit 2 on partial coverage.

Also updated the archived P2 runbook's step-2 command to the `.ts` invocation (dead command in a reusable runbook; narrative history untouched).
