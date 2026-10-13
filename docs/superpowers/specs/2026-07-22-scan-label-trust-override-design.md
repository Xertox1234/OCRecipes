# Smart Scan — "Trust the Label" OCR Override (Design)

**Status:** Design approved 2026-07-22 (user). Not yet planned/implemented.
**Line:** Smart Scan Phase 2 follow-up (sibling to universal-flags v1, PR #694).
**Location note:** `docs/superpowers/` is gitignored — this spec is local-only.

## Goal

When a user scans a product's **barcode and its nutrition label**, and the label's
numbers materially disagree with the barcode-database entry, let the user choose
which source to trust — defaulting to the scanned label — and recompute the
nutrition flags on the chosen data.

## Motivating bug (why this exists)

Scanning a can of Cherry Coke (barcode `06772408`) showed **39 kcal per 355 ml**
and **no "High in Sugar" flag**, despite a Health-Canada "High in Sugars" warning
printed on the can. Root cause, confirmed by triangulation (user observation =
Open Food Facts raw values, exactly):

- OFF's crowdsourced entry for that barcode is **factually wrong** — the real
  per-100 ml values were entered into the per-355 ml-serving fields, so every
  value is ~3.55× too low (`energy-kcal_100g: 11.11`, `energy-kcal_serving: 39.4`,
  `sugars_100g: 3.09`). Real Cherry Coke ≈ 150 kcal / 39 g sugar per can.
- The app displayed OFF's data **faithfully** — the scan, the reconciliation, and
  the serving-scaling all worked; the source lied.
- The error is **internally self-consistent** (`11.11 × 3.55 = 39.4`; Atwater
  `4 × 3.09 ≈ 11.11`), so every automated sanity check passes. **No correct value
  exists anywhere in the OFF record.** Only the physical label — which the user
  photographed — carries the truth.

This is distinct from the name-match "source pollution" bug (Nutella,
`todos/P2-2026-07-22-barcode-nutriment-source-pollution.md`), which _is_ a
fixable code bug and stays a separate track.

**The only robust fix for a self-consistent-but-wrong source entry is to trust
the scanned label.** Today the STEP2 nutrition-label photo is OCR'd, stored in
the scan reducer, and then **dropped** — the session navigates to
`NutritionDetail` with only `{ barcode }`, which re-does a pure database lookup.
The label never gets a chance to correct anything.

## Scope

**In scope (v1 of this feature):**

- The **barcode flow when a nutrition-label photo was also captured** (the normal
  3-photo scan: barcode → nutrition label → front label).
- Carry the STEP2 OCR text forward to the detail screen (stop dropping it).
- Parse it, compare against the database entry, prompt the user on conflict,
  merge on the user's choice, and recompute flags.
- **Extend `parseNutritionFromOCR` for Canadian / bilingual Nutrition Facts**
  (serving "Per 355 mL" / "pour", bilingual field names "Fat / Lipides",
  "Sugars / Sucres", "Sodium", "Calories") so the feature fires on Canadian
  products — the motivating can is Canadian. See "Parser extension" below.

**Out of scope (v2 / follow-ups):**

- Barcode present but in **no** database, label read cleanly → use the label as
  the source directly. (Deferred; the code should leave a clean seam for it.)
- Standalone label-scan flow (`LabelAnalysisScreen`) — already parses labels; not
  touched here.
- Barcode-only scans and front-label-only captures — unchanged.
- Fixing the Nutella name-match pollution bug (separate P2 track).
- Contributing corrections upstream to OFF (optional, non-code).

## Key existing building blocks (reused, not rebuilt)

- **`client/lib/nutrition-ocr-parser.ts` → `parseNutritionFromOCR(text)`** returns
  `LocalNutritionData { calories, protein, carbs, fat, fiber, sugar, sodium,
saturatedFat?, …, servingSize: string | null, confidence: number }`. Values are
  per-serving (as printed on the label); `confidence = extractedFields /
TOTAL_FIELDS`; fields not found are `null`. Already used by `LabelAnalysisScreen`.
- **`server/services/barcode-lookup.ts`** — the `GET /api/nutrition/barcode/:code`
  pipeline: OFF fetch, reconciliation, `parseServingGrams`, `scaleNutrients`, the
  OFF category/NOVA/Nutri-Score extraction, and the ODbL strip. _Verified:_
  `parseServingGrams` already matches `ml` (`(\d+\.?\d*)\s*(?:g|ml)`) and treats it
  1:1 as grams — correct for water-like beverages (soda density ≈ 1.0). No change
  needed for beverage serving normalization.
- **`server/services/universal-flags.ts` → `evaluateUniversalFlags(input)`** — the
  pure FSA/NOVA/caffeine/sweetener/Nutri-Score flag evaluator (needs per-100g +
  perServing + `categoriesTags` + `novaGroup` + `nutriScore` + `additivesTags`).
- **`LabelAnalysisScreen` confirm UX** — the visual/interaction pattern for
  confirming OCR'd nutrition; the conflict prompt reuses its styling.
- **Scan reducer** already carries `ocrText`/`nutritionImageUri` to
  `SESSION_COMPLETE`; only the `ScanScreen` navigation drops them.

## Parser extension — Canadian / bilingual labels

`parseNutritionFromOCR` is US-oriented today. Canadian Nutrition Facts / Valeur
nutritive tables differ: the serving line is "Per 355 mL" / "pour 355 mL"
(not "Serving Size"), and field names are short or bilingual ("Fat / Lipides",
"Sugars / Sucres", "Carbohydrate / Glucides", not "Total Fat" / "Total Sugars").
Values remain **per-serving** (the stated "Per X"), so the comparison basis is
unchanged. Required additions (regex-level; keep the parser pure + fixture-tested):

- **Serving:** accept `Per` / `Pour` / `Portion` in addition to `Serving Size`,
  e.g. `/(?:serving\s+size|per|pour|portion)\s+(.+)/i`. Prefer an explicit
  "serving size" match; fall back to the `per/pour/portion` form **only when the
  capture contains a `g`/`ml` token** (so a stray "per" line can't hijack it).
  `parseServingGrams` then extracts the grams/ml as today.
- **Fields:** broaden each field pattern to the Canadian/bilingual forms —
  `fat` / `lipides` (not only `total fat`), `sugars` / `sucres` (not only
  `total sugars`), `carbohydrate` / `glucides`, `sodium` (same), `protein` /
  `protéines`, `calories` (same). Handle the "EN / FR" slash layout so a value
  after "Sugars / Sucres 39 g" is captured.
- **Accents:** match `é`-bearing French terms (`protéines`, `glucides`) safely;
  don't rely on `\b` around accented letters.

Risk note: on-device OCR reliability on a curved/bilingual can is a separate
device-testing concern; the presence gate + human-in-the-loop mean a poor read
degrades to "no prompt → DB", never to wrong-but-confident data.

## Architecture: two results, client toggles

The compare + merge + flag-recompute happen **server-side**. Rationale: the FSA
flags need the product's OFF **category** (drink vs food threshold) and NOVA
group, but the route **strips raw OFF category tags from every client response**
(ODbL). Computing both candidate results where that data already lives keeps the
ODbL boundary and all nutrition logic on the server, and reduces the client to a
pure presentation toggle with no nutrition math to get wrong.

### Data flow

1. **Scan (client).** Barcode locked; STEP2 nutrition-label photo captured; OCR
   runs (existing). `SESSION_COMPLETE` already carries `ocrText`.
2. **Carry forward (client).** `ScanScreen` navigation passes `ocrText` (and/or
   the parsed `LocalNutritionData`) to `NutritionDetail`, not just `{ barcode }`.
   `NutritionDetail`/`useNutritionLookup` parse the OCR (`parseNutritionFromOCR`)
   if not already parsed.
3. **Request (client → server).** The existing `GET /api/nutrition/barcode/:code`
   stays unchanged for the no-label path (a GET cannot carry a structured body).
   When label data is present with sufficient confidence, the client instead
   issues a **`POST /api/nutrition/barcode/:code`** whose body carries the parsed
   label macros: `{ labelNutrition: { calories, sugar, fat, saturatedFat?,
sodium?, servingSize, confidence } }`. Both routes share the same lookup core;
   only the POST runs the label comparison. (Client parses; the server does not
   need the OCR parser. The body is validated with zod.)
4. **Compute (server).** As today: OFF fetch → DB result (`perServing`, `per100g`,
   `servingInfo`, enrichment, flags). **New:** if `labelNutrition` is present and
   comparable, build a **label-corrected result**:
   - Normalize the label's per-serving macros to per-100g using
     `parseServingGrams(labelNutrition.servingSize)`. If that yields no grams →
     **not comparable** → skip (return the DB result only).
   - Compare **each macro the OCR read** (non-null): `calories`, `sugar`, `fat`
     (extendable). **Conflict** = any compared macro's relative difference exceeds
     the threshold (see below).
   - If conflict: assemble `labelResult` = **label macros** (per-100g + rescaled
     perServing on the label's serving) **+ the DB's OFF-only enrichment**
     (`novaGroup`, `nutriScore`, category-derived caffeine/ultra-processed inputs)
     → run `evaluateUniversalFlags` on the corrected macros to get `labelResult.flags`.
5. **Response (server → client).** On conflict:
   `{ ...dbResult, conflict: { fields: [...], label: labelResult } }`. No conflict
   / not comparable / low confidence: today's shape (DB result only, no `conflict`).
6. **Present (client).** If `conflict` present → show the prompt (label
   pre-selected). Picking toggles which result object drives the screen — DB
   result vs `conflict.label` — both fully formed (macros + flags). No client-side
   nutrition logic.

### Comparison rules (server)

- **Basis:** per-100g/ml for both sides (DB is already per-100g; label normalized
  via its parsed serving grams).
- **Fields compared:** `calories`, `sugar`, `fat` — only those the OCR read
  (`!= null`). (Sat-fat/sodium may be added later; keep the field list a constant.)
- **Field-name mapping:** the parser names fields `calories`, `totalSugars`,
  `totalFat` (also `saturatedFat`, `sodium`). Map `totalSugars → sugar` and
  `totalFat → fat` when comparing against the DB result.
- **Threshold (per macro):** relative difference **> 25%**, with a small absolute
  floor to ignore rounding noise on near-zero values (e.g. skip a macro whose both
  sides are under a few units). Tunable constants; documented in code.
  _(Chosen to match the user's "any macro disagrees / most thorough" preference —
  more sensitive than the 2× reconcile threshold. Cherry Coke is 3.55× off, well
  past any of these.)_
- **Presence gate (NOT the aggregate `confidence` ratio):** only offer the label
  when `calories` is non-null **and** at least one comparable macro (`totalSugars`
  or `totalFat`) is non-null. The parser's `confidence = extracted / 10 fields`
  systematically **under-scores beverages** — a regular soda legitimately fills
  only ~4–6 of the 10 fields (no fiber/cholesterol/sat-fat/protein), so a ratio
  floor like 0.5 would suppress the prompt on the exact beverage case this feature
  targets. Gate on field presence of the fields we actually compare; keep
  `confidence` only as a logged diagnostic. Below the gate → no prompt (DB, as today).

### Merge rules (label chosen)

- **Replace:** the compared/parsed macros (calories, sugar, fat, and any other
  non-null label macros) at both per-100g and perServing (rescaled on the label's
  serving), plus the label's serving size.
- **Keep from DB (label can't carry these):** `novaGroup` / ultra-processed flag,
  `nutriScore` grade/flag, caffeine (category/ingredient-derived), product name,
  brand, image. These come from OFF; the label has none of them.
- **Trusted per-serving is MANDATORY for the flags to fire (load-bearing).**
  `conflict.label` MUST populate `perServing` from the label's per-serving macros,
  set `servingGrams` from the parsed label serving, and mark serving data
  **trusted**, so `evaluateUniversalFlags` receives the `sv` (perServing) argument.
  Corrected sugar is ~11 g/100 ml — _below_ the 11.25 g/100 ml drink line — so
  "High in Sugar" fires ONLY through the per-portion path
  (`perServing.sugar ~39 > FSA_PORTION.sugar 27` **AND** `servingGrams 355 > 100`).
  If the label result is assembled per-100g-only / untrusted, the macros correct
  but the flag silently does **not** fire — the feature's headline promise breaks.
- **Recompute:** the FSA nutrient flags (`High in Sugar/Sat-Fat/Sodium`) on the
  corrected macros — this is the whole point (Cherry Coke → 39 g sugar/can → the
  portion path fires → "High in Sugar").
- **ODbL:** unchanged — the response still strips `additivesTags`/`categoriesTags`;
  flag titles remain static literals; nothing raw-OFF is persisted.

## Conflict UX

Reuse `LabelAnalysisScreen` confirm styling. A card/sheet that:

- States plainly: "The label you scanned differs from our database."
- Lists **each disagreeing macro** with both values in two columns —
  **"Label (your photo)"** and **"Database"** — the label column selected by
  default.
- One tap to confirm (keep label) or switch to database.
- **Accessibility:** each row announces both values and the current selection
  (e.g. "Calories: label 150, database 39. Label selected."); the choice control
  has a clear role/state; announce the applied choice. Follows the codified iOS
  `announceForAccessibility` single-commit rule
  (`docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`).

Placement: on/atop `NutritionDetailScreen` when the response carries `conflict`
(so the detail data is present behind it). Not a blocking full-screen modal —
badges-only philosophy; the user can dismiss to the DB default.

## Error handling & edge cases

- **Low OCR confidence / no calories read** → no prompt; DB result (today).
- **Label serving unparseable to grams** → not comparable → no prompt (never
  compare per-serving-of-unknown-size against per-100g).
- **Label agrees with DB (within threshold)** → no prompt; DB result.
- **Barcode-only or front-label-only capture** → no `labelNutrition`; unchanged.
- **`returnAfterLog` confirm-card path** (quick-log without opening the detail
  screen; `ScanScreen` fetches the barcode and never navigates to
  `NutritionDetail`) → **out of scope for v1**, uses the unchanged `GET`. Surfacing
  the conflict there is a v2 parity follow-up (mirrors the universal-flags v1
  confirm-card parity decision).
- **Barcode not in any database** but label read cleanly → **v2** (leave a seam;
  today shows "Product Not Found" + manual search).
- **Server unreachable (direct-OFF client fallback path)** → no server-side
  compare; existing fallback behavior (no conflict prompt). Acceptable — the
  fallback is already degraded.
- **Both label and DB wrong** → the user still chooses; human-in-the-loop is the
  backstop. We default to the label per the approved principle.

## Testing

**Server (`barcode-lookup` / route):**

- Comparison: agree (no conflict), >25% on calories only, sugar-only disagreement,
  fat-only disagreement, multi-macro, near-zero absolute-floor suppression.
- Confidence gate: low-confidence label → no conflict returned.
- Unparseable label serving → no conflict returned.
- Response shape: `conflict.label` carries both corrected macros and recomputed
  flags; DB-only path unchanged.
- **Parser (Canadian/bilingual):** fixtures for "Per 355 mL" serving extraction,
  "Sugars / Sucres 39 g" / "Fat / Lipides 0 g" field extraction, accented terms,
  and the "prefer Serving Size, fall back to Per only with a g/ml token" rule;
  keep the existing US-format fixtures green (no regression).
- **Cherry Coke fixture** (`06772408`-shaped, **Canadian bilingual** label OCR
  string — "Per 355 mL", "Sugars / Sucres 39 g", "Calories 150"): DB
  per-100g 11.11 kcal / 3.09 g sugar; label serving "355 mL", 150 kcal, 39 g sugar
  → conflict on calories+sugar. Assert the **flag-firing preconditions**, not just
  the corrected numbers: `conflict.label.servingGrams === 355`, serving-data
  **trusted**, `perServing` populated, and `conflict.label.flags` **includes**
  `nutrient:sugar` (High in Sugar) — while `novaGroup:4` (ultra-processed) and the
  category-derived caffeine flag are **retained from DB**. (This is the regression
  guard for Blocker 2 — a per-100g-only label result would pass the macro
  assertions but fail the flag assertion.)
- ODbL: response still strips `additivesTags`/`categoriesTags` on both branches.

**Client:**

- `ScanScreen` navigation forwards `ocrText`/parsed label to `NutritionDetail`.
- `useNutritionLookup` includes `labelNutrition` in the request when present +
  confident; omits it otherwise.
- Conflict prompt renders both columns, label selected by default; toggling swaps
  the active result (macros + flags) on screen; a11y labels/announcements.
- No conflict → no prompt; screen identical to today.

## Global constraints (carried into the plan)

- **Free & universal** — no premium gating; flags stay `"nutrition"` tier, never
  `"insight"` (the universal-flags v1 landmine).
- **ODbL** — OFF-derived content read live, never persisted to `barcodeNutrition`;
  `additivesTags`/`categoriesTags` stripped from every response.
- **Health-facing** — human-in-the-loop on conflict; default to label; no silent
  override; fail toward "show the DB and let the user decide," never toward
  fabricated data.
- **Cross-platform** — iOS and Android parity for the prompt + a11y.
- **TDD** — failing test first per task; server + client suites green before PR.

## Open questions resolved during design

- Guardrail: **ask the user on conflict** (default label), not blind override.
- Trigger breadth: **any macro** (calories/sugar/fat) disagrees.
- Where it runs: **server-side** two-result computation; client toggles.
- No-DB-but-good-label: **v2**, not v1.
- Canadian/bilingual label parsing: **in v1** (the motivating can is Canadian; a
  US-only parser would no-op on it).
- Beverage confidence gate: **field-presence** (calories + ≥1 compared macro), not
  the aggregate ratio (which under-scores sparse beverage labels).
- Label result must be **trusted per-serving with servingGrams > 100** or the
  recomputed High-in-Sugar flag won't fire (per-portion path is the only one that
  catches a full-sugar cola).
