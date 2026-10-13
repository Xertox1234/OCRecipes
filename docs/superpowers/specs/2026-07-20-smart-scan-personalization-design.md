# Smart Scan — Personalized Scan Flags

> **⚠ PARTIALLY SUPERSEDED (2026-07-22).** Phase 1 (allergen safety) shipped as
> designed (PR #679). Phases 2–3 were **re-decided** by the user on 2026-07-22 and
> are now specified in `2026-07-22-smart-scan-universal-nutrition-flags-design.md`.
> Two approved decisions below are **overturned** there: (1) nutrient/processing
> insights are now **free & universal**, not premium; (2) the `condition → nutrient`
> gate is **inverted** to `threshold → universal flag + optional boost`. Read the
> newer spec for Phase 2+; treat the "premium insights" and "condition-gated" rows
> below as historical for Phases 2–3.

**Status:** Design approved, pre-plan (Phase 1 shipped; Phases 2–3 superseded — see banner)
**Date:** 2026-07-20
**Surface:** Scan / barcode flow (`ScanScreen` → `NutritionDetailScreen`)
**Related:** `todos/P2-2026-07-20-universal-contains-allergen-label-recipes.md` (sibling, out of scope here)

## Overview

Make the barcode scan experience personal and safety-aware. When a scanned
product matches the user's stored health profile, surface a flag:

- **Allergen match** — the product contains an allergen the user declared.
- **Condition-driven nutrient warning** — e.g. high sugar for a user managing
  blood sugar; high sodium for a user managing blood pressure.
- **Ultra-processed insight** — the product is NOVA group 4.

Flags appear **at scan-lock** (in the in-camera product chip) and **on the
Nutrition Detail screen** (a fuller "For you" section). The scan itself becomes
smarter, not just the result screen.

### Scan types in scope

The original request covers "if an **image** or barcode scanned matches" — both
scan types, which differ in available data:

- **Barcode scans** (Phase 1 focus) — the only path that yields OFF
  allergen/ingredient/NOVA data. Gets the full flag set.
- **Photo scans** (`CLASSIFYING → SMART_CONFIRMED`, `server/services/photo-analysis.ts`)
  — produce estimated **nutrients** but no barcode, so no ingredient/allergen/NOVA
  data. They can carry **nutrient/condition flags** (high sugar/sodium) and, for
  users with declared allergies, the fail-dangerous **allergen-unverified** flag —
  but never a positive allergen match. Scoped as a **defined later phase** (see
  Phasing), not dropped.

### Surfaces that show a product (each must render flags before it is "covered")

1. `ProductChip` at scan-lock (`ScanScreen.tsx:678`).
2. `NutritionDetailScreen` — the deep-link result screen.
3. **The `confirmCard` on the `returnAfterLog` path** (`ScanScreen.tsx:784-917`) —
   POSTs to `/api/scanned-items` directly and **never navigates to
   NutritionDetail**. A user can log a product without ever seeing the detail
   screen, so safety flags MUST render here **before the "Log It" action** — else a
   severe-allergen item is logged with no warning, defeating invariant #1.
4. `BatchScanScreen` (multi-item) — reuses the same lookup; **later phase**, listed
   so it is not silently missed.

## Goals

- Turn a flat scan into a personalized, safety-aware moment using data the app
  already collects and already fetches.
- Reuse the existing allergen engine (`shared/constants/allergens.ts`) rather
  than build a second one.
- Introduce condition-based nutrient flagging (currently `healthConditions` is
  captured, consented, and read by nothing).

## Non-goals

- Recipe allergen labeling (separate surface + universal model — see the sibling
  todo).
- Any interruptive/blocking UX. Per product decision, flags are **badges only**;
  nothing gates the scan flow.
- Diagnosis, prescriptive/medical directives, or a health-tracking dashboard
  (the app stays camera/OCR-focused).
- Saturated-fat and potassium/phosphorus based flags (deferred — the nutrients
  aren't reliably in the feed yet; see Phase 3).

## Approved product decisions

| Decision                    | Choice                                                                   |
| --------------------------- | ------------------------------------------------------------------------ |
| Where flags appear          | **Both** scan-lock (`ProductChip`) and detail screen                     |
| Assertiveness               | **Badges only, never interrupt** the flow                                |
| Premium model               | **Allergen safety free; condition/nutrient/processing insights premium** |
| "Insulin resistant" mapping | **Add `insulin_resistance` + `prediabetes`** conditions                  |

Within "badges only," a _severe_ allergen badge is made maximally salient
(danger color, top-anchored, haptic tap + screen-reader priority announcement) —
raising salience for the dangerous case without ever blocking the flow.

## Architecture

**Chosen approach: server-side per-user flag overlay** on top of cacheable,
product-level data. Rejected alternatives: client-side evaluation (duplicates
medical-threshold logic on-device, harder to test/keep consistent, tamperable)
and precompute-and-store (per-user flags can't live in the shared product cache
and go stale on profile edits).

### 1. Product enrichment — user-independent, cacheable

The barcode pipeline already fetches **Open Food Facts first**
(`server/services/barcode-lookup.ts` → `lookupBarcode()`), and `offNutrimentsSchema`
is `.passthrough()` with the raw product typed `Record<string, any>`. OFF's
allergen/ingredient/processing fields are **already in the HTTP response and
discarded today**.

- Extend `offNutrimentsSchema`, `BarcodePer100g`, and `BarcodeLookupResult` to
  read these OFF fields (OFF API keys — verify against a live payload, not
  currently referenced in-repo):
  - `ingredients_text`
  - `allergens_tags` (e.g. `en:milk`, `en:nuts`)
  - `nova_group` (1–4)
  - `additives_tags`
  - `nutriscore_grade` (a–e) — optional future signal
  - `saturated-fat_100g`, `salt_100g` — Phase 3 (enables cholesterol/BP nutrient rules)
- Add `allergenDataAvailable: boolean` to the result — **true only when the
  source actually returned ingredient/allergen data** (i.e. an OFF hit). This is
  the single signal that drives the fail-dangerous no-data case.
- **OFF-derived _content_ is NOT persisted (decided 2026-07-20).** Open Food Facts
  is **ODbL** (share-alike + attribution), and `barcodeNutrition` feeds the Public
  API / sellable verified-product DB. Nutrient _numbers_ are bare facts;
  `ingredients_text` / `allergens_tags` / `nova_group` are OFF _database content_.
  To keep the sellable table to facts, OFF content is **read live from the
  per-request lookup and discarded after flag evaluation** — never written to
  `barcodeNutrition` or any table feeding the Public API. The flag path already
  fetches OFF on each cache-miss, so no persisted copy is needed. Revisit only if a
  dedicated OFF-content cache is later introduced (would owe attribution/share-alike
  and must never feed the Public API).

### 2. Flag evaluation — per-user, never cached

New pure module `server/services/scan-flags.ts`:

```
evaluateScanFlags(product, userProfile, { isPremium }) -> ScanFlag[]
```

```
ScanFlag = {
  kind:     'allergen' | 'nutrient' | 'processing',
  severity: 'danger' | 'warn' | 'info',
  tier:     'safety' | 'insight',
  title, detail, matchedOn
}
```

- **Allergen flags** — map OFF `allergens_tags` to our 9 allergen IDs _and_ run
  `detectAllergens(ingredients_text)` as a backup, matched against
  `parseUserAllergies(profile.allergies)`. Flag severity inherits the user's
  stored `mild | moderate | severe`.
- **Condition → nutrient flags** — a new declarative `CONDITION_FLAG_RULES` table
  (see below).
- **Processing flag** — `nova_group === 4` → "ultra-processed". Not gated by any
  specific health condition (shown to any premium user regardless of conditions),
  but it is an **insight-tier** flag, so free users see only the locked count, not
  the content.

### 3. Delivery

`GET /api/nutrition/barcode/:code` (`server/routes/nutrition.ts:89-120`) is
already authenticated and already called at scan-lock via `fetchProductInfo`. It
already runs `lookupBarcode` + `storage.getVerification` in parallel — add
`storage.getUserProfile` alongside them, then attach:

- `flags: ScanFlag[]` (safety flags always; insight flags only when premium)
- `insightsLocked: boolean`, `insightsCount: number` (for free users' upsell stub)

**The profile fetch must fail _dangerous_, not fatal.** Use `allSettled`/`catch`
so a profile-read hiccup never breaks scanning — product identity still returns.
But per invariant #1, a failed profile read for a user with allergies must NOT
silently drop allergen flags: emit a degraded **"Couldn't check this against your
profile"** state instead of silence.

Profile is one indexed row by `userId` — negligible added latency. One code path
feeds every product surface listed above (scan-lock chip, detail screen, and the
`returnAfterLog` confirm card), so no surface can render a product without also
having its flags. (`isPremium` derives from `users.subscriptionTier` on the
`users` row — confirm it is already on `req.user` rather than re-fetched from
`user_profiles`.)

### 4. Client rendering

- **Scan-lock (`ProductChip`, `client/screens/ScanScreen.tsx:678`):** a compact
  badge row, highest-severity safety flag first. `fetchProductInfo` (line 293)
  currently keeps only `{name, brand, imageUri}` in the `PRODUCT_LOADED` dispatch;
  extend the payload and `ProductSummary` (`client/camera/types/scan-phase.ts:4-8`)
  to carry the top safety flag(s).
- **Detail (`NutritionDetailScreen.tsx`, via `useNutritionLookup.ts`):** a "For
  you" section near the top — full flag cards with the _why_; insight cards render
  the upsell state for free users. No new screen; reuses deep link
  `nutrition/:barcode` (`linking.ts:42`).
- **`returnAfterLog` confirm card (`ScanScreen.tsx:784-917`):** render the
  highest-severity **safety** flag inline on the card, above the "Log It" button.
  This path bypasses the detail screen, so it is the one place invariant #1 is
  easiest to violate — treat it as Phase 1 scope, not an afterthought.

## Condition → nutrient rules

Thresholds anchor to the **UK FSA front-of-pack ("traffic light")** standard, an
objective published basis. Evaluated **per-serving when `isServingDataTrusted`**,
falling back cautiously to per-100g otherwise.

| Condition(s)                                                                    | Nutrient               | Basis                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `diabetes_type1`, `diabetes_type2`, `insulin_resistance`, `prediabetes`, `pcos` | Sugar                  | FSA red: ≥ 22.5 g/100g (or > 27 g/portion)                                                          |
| `high_blood_pressure`, `heart_disease`                                          | Sodium / salt          | FSA red: salt ≥ 1.5 g/100g (or > 1.8 g/portion)                                                     |
| `celiac`                                                                        | Gluten                 | OFF `en:gluten` primary **+ extended engine** catches barley/rye/malt in ingredient text (see note) |
| `high_cholesterol`                                                              | Saturated fat          | **Phase 3** — needs `saturated-fat_100g`                                                            |
| `kidney_disease`                                                                | Potassium / phosphorus | **Phase 3** — not in feed                                                                           |

Notes:

- **Celiac ≠ wheat — extend the engine (decided 2026-07-20).** The engine's 9 IDs
  include `wheat` but not gluten, so `detectAllergens(ingredients_text)` alone
  catches wheat and **misses barley, rye, and malt** — a dangerous under-flag.
  Two-layer fix: (a) OFF `en:gluten` is the primary celiac signal; (b) extend
  `shared/constants/allergens.ts` with a **distinct gluten-grain concept** (barley,
  rye, malt, spelt, triticale …) keyed to celiac — do **NOT** overload the `wheat`
  ID, or every barley-containing recipe would mislabel as "Contains: Wheat" on the
  recipe surfaces that consume the same engine. Only when _both_ the OFF tag and
  ingredient-text signals are unavailable does it fall through to
  **allergen-unverified**. Because this engine is wired into recipe search,
  catalog, meal-plan, and community recipes, run an **LSP find-references** on the
  touched symbols before editing (Phase 2). Side benefit: `deriveRecipeAllergens`
  gains the same coverage, strengthening the sibling recipe-labeling todo.
- Sodium unit reconciliation is an implementation detail: the app stores `sodium`;
  FSA is stated in salt (salt ≈ sodium × 2.5). Convert consistently.
- Deferred conditions (`high_cholesterol`, `kidney_disease`) produce **no flag**
  until their data lands — never a false "you're fine."

## Safety invariants (non-negotiable)

1. **Allergen flags fail _dangerous_.** If the user has any declared allergy and
   `allergenDataAvailable === false`, emit an explicit
   **"⚠ Couldn't verify allergens for this product"** flag. Absence of data must
   never render as silence or as a "safe" signal.
2. **Nutrient flags fail _safe_.** Missing a nutrient → no flag (acceptable).
3. **Informational framing, never prescriptive.** "High in sugar — you've noted
   managing blood sugar," not "don't eat this" / "this is dangerous." No
   diagnosis, no directive.
4. **Persistent disclaimer** on the detail flag section: "Informational only — not
   medical advice. Talk to your healthcare provider." Mirrors the coach's existing
   defer-to-professional posture (`server/services/nutrition-coach.ts:312`).
5. **Consent-gated.** Condition flags compute only when `healthDataConsentAt` is
   set (collected in onboarding).

## Premium tiering

- `tier: 'safety'` (allergen matches + the allergen-unverified warning) — **always
  returned, free.** Gating "does this contain nuts" behind payment is not
  acceptable.
- `tier: 'insight'` (condition/nutrient/processing) — full content for premium;
  free users receive only `insightsLocked: true` + `insightsCount` so nothing
  leaks and the detail screen can show a count-only upsell. **Insight content must
  be stripped in the server serializer**, not hidden behind a client-side blur over
  a payload that still ships the data — it is a paid-feature boundary, so the bytes
  must never reach a free client.

## Onboarding / profile changes

- Add `insulin_resistance` and `prediabetes` to the condition list.
- The 10-condition list is currently **duplicated** in
  `client/screens/onboarding/HealthConditionsScreen.tsx` and
  `client/screens/EditDietaryProfileScreen.tsx`. Extract it to
  `shared/constants/health-conditions.ts`, which becomes the single source of
  truth for both screens **and** for `CONDITION_FLAG_RULES` (kills drift).
- Update the server validation whitelist (`server/routes/_schemas.ts:102-119`,
  `userProfileInputSchema`) to accept the two new IDs.

## Testing (TDD)

Most weight sits on the pure evaluator — `evaluateScanFlags`:

- Allergen match by OFF tag; by ingredient text; and — the safety-relevant case —
  **disagreement**: tag misses but ingredient text catches (and vice versa). The
  flag set is the **union** of both paths, never either alone.
- **OFF `allergens_tags` → 9-ID taxonomy mapping** as its own unit — it is NOT 1:1
  (`en:gluten`→`wheat`, `en:crustaceans`/`en:molluscs`→`shellfish`,
  `en:nuts`/`en:peanuts`→`tree_nuts`/`peanuts`). A naïve map silently drops
  allergens, which is safety-relevant, so every OFF allergen tag must have an
  asserted mapping or an explicit "unmapped" fallback.
- Severity escalation (mild/moderate/severe inheritance).
- **No-data → allergen-unverified flag** emitted when the user has allergies.
- Each condition rule; FSA threshold boundary cases; per-serving vs per-100g
  selection driven by `isServingDataTrusted`.
- `nova_group === 4` → processing flag.
- Premium tiering: free response omits insight content but returns
  `insightsLocked` + `insightsCount`; premium returns full insights.

Plus: an OFF-payload fixture test for field extraction (OFF hit populates fields;
non-OFF source → `allergenDataAvailable === false`), a route-shape test, and
client render tests (utils-extracted) for badge mapping and the upsell stub.

## Phasing

- **Phase 1 — Allergen safety** (mostly _wiring the existing engine_ to a new
  surface): OFF field extraction + `allergenDataAvailable` + the taxonomy mapping,
  allergen matching, the fail-dangerous unverified state, and rendering across all
  three barcode surfaces — scan-lock chip, detail screen, **and the `returnAfterLog`
  confirm card** (the log-without-detail path). Highest value, lowest risk.
  Independently shippable.
- **Phase 2 — Condition insights** (the greenfield bulk): `CONDITION_FLAG_RULES`,
  FSA thresholds, the two new conditions + shared constant, the gluten-grain
  allergen-engine extension for celiac (LSP-first — shared blast radius), premium
  tiering, the medical disclaimer.
- **Phase 3 — Enrichment**: NOVA/ultra-processed insight polish, saturated-fat
  and kidney nutrients once the OFF fields are wired, Nutri-Score, "better swap"
  suggestions.
- **Phase 4 — Additional scan surfaces**: **photo scans** (nutrient/condition
  flags + the allergen-unverified state — no positive allergen match without a
  barcode) and **batch scan**. Deferred because they add no allergen data; the
  pure evaluator built in Phases 1–2 applies unchanged, so this is wiring, not new
  logic.

## Risks & open questions

- **OFF ODbL licensing (resolved 2026-07-20).** OFF-derived _content_ is **not
  persisted** to `barcodeNutrition` or any table feeding the Public API / sellable
  verified-product DB — read live per request, discarded after flag evaluation
  (§1). Revisit only if an OFF-content cache is introduced.
- **OFF field verification** — the exact OFF keys and localization of
  `ingredients_text` must be confirmed against a live payload before wiring; they
  are not referenced in-repo today.
- **OFF coverage** — allergen/NOVA data only exists for OFF-covered products.
  Handled by invariant #1, but worth measuring hit-rate to set expectations.
- **Sodium/salt unit reconciliation** — must be consistent end-to-end.
- **Latency at scan-lock** — adding the profile fetch is cheap, but flag
  computation must not delay the lock-time chip noticeably; measure.
- **Severe-allergen salience under "badges only"** — verify the haptic +
  accessibility announcement is sufficient without a blocking step (product
  decision is badges-only; this is the mitigation, not a re-open).
