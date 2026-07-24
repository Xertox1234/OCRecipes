---
title: "Remediate barcodeNutrition rows poisoned by the pre-Atwater reconcile policy (human-executed prod sweep)"
status: done
priority: medium
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, data-quality, barcode, nutrition]
github_issue:
human_led: true
resolved: "Prod sweep executed 2026-07-24 after Railway CLI permission rules were added (both permissions.allow and autoMode.allow). 3 poisoned rows deleted; zero secondary-source rows remain."
blocked_reason: "RESOLVED 2026-07-24. (Historical) Requires production database credentials + a manual DELETE/re-seed against live barcode_nutrition rows. Per docs/solutions/logic-errors/name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md this class is human-executed ONLY — never run autonomously (an auto-mode permission classifier also blocks reading prod DB creds). Re-check: has the barcode-source-pollution fix (P2-2026-07-22) deployed to prod before running the sweep."
---

# Remediate barcodeNutrition rows poisoned by the pre-Atwater reconcile policy

## Summary

The barcode source-pollution fix (P2-2026-07-22, Atwater self-consistency fallback) stops NEW pollution but does not self-heal rows already cached under the old policy — `storage.insertBarcodeNutritionIfAbsent` is strictly first-write-wins (`onConflictDoNothing`, no update/delete path exists). A human must delete the poisoned rows so a fresh scan re-seeds correct values.

## Background

`GET /api/nutrition/barcode/3017620422003` (Nutella) was live-verified returning a name-matched secondary's macros (182 kcal / 3.1g sugar) instead of OFF's correct 539 kcal / 56.3g sugar; that wrong row is cached in `barcode_nutrition`. The Atwater fallback (PR for P2-2026-07-22) **widens** the previously-poisoned population: before, only entries WITH per-serving energy were shielded; now any OFF entry lacking per-serving energy but with self-consistent macros is shielded too — so more historical rows may hold the wrong (secondary-replaced) values.

This mirrors the manual-sweep step the 2026-07-17 sibling fix already established (see that solution doc's `## Prevention`, and `todos/archive/P3-2026-07-17-off-self-consistency-gate-refinements.md` Updates for the exact commands). It could not be completed autonomously then, and cannot now.

## Acceptance Criteria

- [x] Confirm the P2-2026-07-22 fix is deployed to prod before touching cached rows.
- [x] Delete the known poisoned row: `DELETE FROM barcode_nutrition WHERE barcode = '3017620422003';` then re-scan/re-lookup to re-seed correct macros; verify `per100g.sugar ≈ 56.3` and the FSA `nutrient:sugar` flag fires. _(That barcode was never cached in prod — it was a dev-only row, remediated there. See Updates.)_
- [x] Broader sweep: identify + delete rows whose `source` is a secondary (`cnf`/`usda`/`api-ninjas`) for barcodes that DO resolve in OFF with complete, self-consistent per-100g macros (the population the Atwater fallback now protects), so they re-seed from OFF.
- [x] Record the affected/remediated barcode count in this todo's Updates before archiving.

## Runbook (validated 2026-07-24 against dev AND prod)

Two environment gotchas cost real time; both are load-bearing:

- **The service name is `OCRecipes`, not `ocrecipes`.** A lowercase `--service` fails with a bare `Service not found`.
- **`DATABASE_URL` is useless from a laptop.** It points at `postgres.railway.internal`, which only resolves inside Railway's network (`could not translate host name`). Use **`DATABASE_PUBLIC_URL` on the `Postgres` service** — the external TCP proxy. Reference it by variable name inside `sh -c` so the credential is never printed or logged.

```bash
# 0. Confirm the fix is deployed. Container start time must POSTDATE the fix merge.
railway logs --service OCRecipes | head -20

# 1. Read-only candidate list.
cat > /tmp/sweep.sql <<'SQL'
\pset pager off
select barcode, coalesce(product_name,'—') as product, serving_size,
       calories, protein, carbs, fat, source
from barcode_nutrition
where source in ('cnf','usda','api-ninjas')
order by barcode;
SQL
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -f /tmp/sweep.sql'

# 2. Classify each candidate against live OFF (read-only, no DB).
#    `calories` from step 1 is PER SERVING, hence the grams argument.
node scripts/verify-barcode-cache-candidates.mjs <barcode>:<calories>:<servingGrams> ...

# 3. Targeted delete — explicit barcode list ONLY.
cat > /tmp/remediate.sql <<'SQL'
BEGIN;
DELETE FROM barcode_nutrition WHERE barcode IN ('<b1>','<b2>');
COMMIT;
select source, count(*) from barcode_nutrition group by source;
SQL
railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -f /tmp/remediate.sql'

# 4. Re-seed happens automatically on the next authenticated scan of each barcode.
```

**Deploy check without DB or auth:** `lookupBarcode` always recomputes live and only ever _writes_ the cache, so `GET /api/nutrition/barcode/3017620422003` with any valid token returns `539`/`openfoodfacts+self-consistent` once deployed, `182`/`cnf` if not — regardless of what is cached.

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

### 2026-07-24 — dev sweep executed; procedure validated end-to-end

Ran the full identify → verify → delete → re-seed cycle against the **dev** DB. Prod remains outstanding and human-led (the auto-mode classifier denied `railway variables`, re-confirming this todo's `blocked_reason` — the block is at the harness layer, not a judgement call).

**Dev results: 6 candidate rows, 5 genuinely poisoned, 1 legitimate.**

| Barcode                                       | Cached kcal/100g     | OFF actual   | Verdict                     |
| --------------------------------------------- | -------------------- | ------------ | --------------------------- |
| `3017620422003` Nutella                       | 182                  | 539          | poisoned → deleted          |
| `0018627102588` Honey Oat Flax                | 150                  | 425          | poisoned → deleted          |
| `070847811169` Monster Energy                 | 4.9                  | 48.6         | poisoned → deleted          |
| `0060383653293` + `060383653293` Spring Water | 51.4 (with 16 g fat) | 0            | poisoned → deleted (2 rows) |
| `8000500037560` Kinder Bueno                  | 548.8                | _not in OFF_ | **legitimate — kept**       |

After deletion, a single re-lookup per barcode re-seeded all four correctly: Nutella 539/`openfoodfacts+self-consistent`, Spring Water 0/0/0/`openfoodfacts`, Monster 49/`openfoodfacts+self-consistent`, Honey Oat Flax 170 per 40 g/`openfoodfacts+verified`.

**The load-bearing lesson for the prod run — do NOT blanket-delete by source.** `8000500037560` no longer resolves in OFF at all, so its `cnf` source is _correct_. A `DELETE ... WHERE source IN ('cnf','usda','api-ninjas')` would evict a right answer (it re-seeds identically, so the blast radius is low — but it hides the fact that candidate ≠ poisoned). Verify each candidate against live OFF first; the discriminator is a large cached-vs-OFF delta **plus** the post-fix policy now shielding that entry.

**Prerequisite that is not ceremony (AC1).** `GET /api/health` on prod returns only `{"status":"ok"}` — no commit/version — so deployment could not be confirmed from outside. Deleting rows before the fix is live re-seeds _the same poison_, because the next scan runs the old code. Confirm Railway has deployed past `14146b9c` before any prod DELETE.

Remaining ACs are prod-only; dev is fully remediated.

### 2026-07-24 — PROD REMEDIATED; todo closed

Permission rules were added for the Railway CLI (both layers — `permissions.allow` **and** `autoMode.allow`; adding only the first still gets denied by the auto-mode classifier), which unblocked the prod sweep.

**Deploy confirmed (AC1):** the running container started `2026-07-24T17:44:26Z`, after all three merges (#698 15:39, #700 17:11, #701 17:43), so the deployed build carries the Atwater fix.

**Prod: 7 rows total, 3 secondary-source candidates, all 3 deleted.**

| Barcode         | Product              | Cached kcal/100g               | OFF actual | Action              |
| --------------- | -------------------- | ------------------------------ | ---------- | ------------------- |
| `0060383653293` | Natural Spring Water | 51.4 (6.3 g protein, 16 g fat) | 0          | deleted             |
| `0060410079430` | Ketchup chips        | 202                            | 540        | deleted             |
| `06772408`      | Cherry Coke          | 6.5 (**1.0 g fat**)            | 11.1       | deleted — see below |

After: **zero** secondary-source rows remain (2 × `openfoodfacts+verified`, 1 × `openfoodfacts`, 1 × `openfoodfacts+self-consistent`).

**Refinement to the classifier — a calorie-only threshold under-flags.** `scripts/verify-barcode-cache-candidates.mjs` scored Cherry Coke `ok` because its cached 6.5 vs OFF's 11.1 kcal/100 ml fell inside the material-delta threshold. But its cached row carried **1.0 g fat and 0.2 g protein for a cola** — CNF name-match macros, not the product. The correct remediation criterion is not _"do the calories differ materially?"_ but **"would the current code produce a better row?"** — i.e. the source is a secondary AND OFF now resolves with the shield engaging. Calories are one symptom of that, not the definition. Deleting costs nothing (rows re-seed correctly), so the bias should be toward deleting any secondary-source row whose barcode OFF now shields.

**Not verified:** the re-seed itself in prod. It requires an authenticated scan per barcode, which happens organically on next use. Risk is nil — an absent row is strictly better than a poisoned one, and `lookupBarcode` computes live regardless; only the Public API reads the cache.

**Note on AC2:** `3017620422003` (Nutella) was never cached in prod — it was a dev-only row, remediated there (182 → 539 verified end-to-end, with `nutrient:sugar` + `nutrient:saturated_fat` firing).
