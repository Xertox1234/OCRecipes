# Smart Scan — Universal Nutrition Flags & Data Enrichment (Phase 2)

**Status:** Design approved by user 2026-07-22, pre-plan
**Date:** 2026-07-22
**Surface:** Barcode scan result — `ScanScreen` (scan-lock `ProductChip`) → `NutritionDetailScreen`
**Supersedes:** decisions in `docs/superpowers/specs/2026-07-20-smart-scan-personalization-design.md` (see "Relationship to the prior spec" below)
**Builds on:** Phase 1 (allergen safety flags) — shipped PR #679, `shared/types/scan-flags.ts`, `server/services/scan-flags.ts`, `GET /api/nutrition/barcode/:code` flag overlay.

## Overview

Make the barcode scan result **richer and more informative for every user**, so people can make informed food decisions at the moment of scanning. Two halves:

1. **More information** — surface the nutrient and product data Open Food Facts (OFF) already returns and the app currently discards (saturated fat, trans fat, cholesterol, caffeine, NOVA processing group, Nutri-Score grade, additives).
2. **Objective "traffic-light" flags** — surface universal, free warnings that any user sees regardless of health profile:
   - **High in Sugar / Saturated Fat / Sodium** (UK FSA thresholds)
   - **Ultra-processed** (NOVA group 4)
   - **High in Caffeine** (the marquee case — energy drinks)
   - **Contains artificial sweeteners** + **Nutri-Score grade**

These flags are **universal and free**. Personalized escalation (a flag getting louder because it matches the user's declared health conditions) is designed here but deferred to a **v2** slice.

### The energy-drink motivating example

A user scans an energy drink. Today they get 7 nutrient numbers. After this change they get: a **"High in caffeine · 160 mg"** badge, an **"Ultra-processed"** badge, a **"High in sugar"** badge (beverage threshold), a **Nutri-Score E** grade, and rows for saturated fat / the full nutrient set OFF provides — enough to make an informed choice at a glance.

## Relationship to the prior spec (what this changes)

The 2026-07-20 spec (`smart-scan-personalization-design.md`) planned Phases 1–4. Phase 1 shipped. This spec is **Phase 2**, and it deliberately **overturns two of that spec's approved decisions** because the user re-decided the product direction on 2026-07-22:

| Prior approved decision (2026-07-20)                                                                                     | Superseded by (2026-07-22)                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Allergen safety free; **condition/nutrient/processing insights premium**."                                              | **All objective nutrition flags are FREE and universal.** Nothing about the four flag families is gated. Monetization stays where it already is (Coach, recipe generation, verified-product API).                                   |
| Architecture: **`condition → nutrient`** — a nutrient flag appears only when the user has a matching declared condition. | Architecture **inverts** to **`nutrient threshold → universal flag`**, with an _optional_ condition-driven **boost** layered on top (v2). Everyone sees "High in sugar"; a diabetic user sees a louder, personalized version later. |

The `CONDITION_FLAG_RULES` table described in the prior spec still applies, but only as the **v2 boost/annotation layer**, not as the gate that decides whether a flag renders at all.

**Action taken:** a banner was added to the top of the 2026-07-20 spec pointing here, and the `project_smart_scan_personalization` auto-memory is updated so no future session acts on the stale "insights = premium" / "condition-gated" decisions.

## Goals

- Turn the thin barcode result screen into an informative one using data the app already fetches and discards.
- Give every user free, objective, at-a-glance nutrition flags — no profile, no paywall.
- Reuse the Phase 1 `ScanFlag` architecture and `ScanFlagBadge` component rather than build a parallel one.
- Keep the caffeine flag robust against OFF's uneven data (mg → presence → nothing).

## Non-goals (v1)

- **Personalized boost / condition-matching** — designed here, built in v2. v1 flags are purely product-driven.
- **Merging `NutritionDetailScreen` (barcode) with `LabelAnalysisScreen` (label OCR).** The label path already extracts a richer set (added sugars, trans fat, cholesterol); converging the two screens is a larger, unrelated refactor. Noted as a v2 candidate. v1 enriches the barcode screen from OFF only.
- Any interruptive/blocking UX. Flags are **badges only** (carried from the prior spec).
- Diagnosis, prescriptive/medical directives, or a health dashboard. The app stays camera/OCR-focused.
- Broad "contains additives" flagging — scoped down to **artificial sweeteners only** for v1 (see §Additives).

## Approved product decisions (2026-07-22)

| Decision             | Choice                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Flag model           | **Universal + personal boost** (boost deferred to v2)                                            |
| v1 flag catalog      | **All four families** — High-in-X, Ultra-processed, Caffeine, Sweeteners/Nutri-Score             |
| Monetization         | **All objective flags free & universal** (overrides prior "premium insights")                    |
| v1 scope             | **Enrich data + all four universal flags.** Personal boost + caffeine profile-matching = v2      |
| Additives flag (v1)  | **Artificial sweeteners only** (aspartame/acesulfame-K/sucralose/saccharin family), neutral copy |
| Caffeine "high" line | **≥ 150 mg/serving** → "High"; any lesser detection → "Contains caffeine"                        |
| Screen convergence   | **Not in v1** (barcode screen enriched from OFF; label screen untouched)                         |

## Architecture

Delivery reuses the Phase 1 path: `GET /api/nutrition/barcode/:code` already runs `lookupBarcode` + `storage.getVerification` and attaches `flags: ScanFlag[]`. This spec extends the flag evaluator and the OFF extraction; the transport shape is unchanged.

**Data-dependency ordering (why v1 is shaped this way).** A "High in saturated fat" flag cannot exist until saturated fat is actually in the barcode feed — so enrichment is the _foundation_ the flags sit on, not a parallel workstream. The v1 build order is therefore: **(1) OFF field extraction → (2) richer nutrient display → (3) objective flag evaluation → (4) badge rendering.**

### 1. OFF data enrichment — user-independent

`server/services/barcode-lookup.ts` already fetches OFF first; `offNutrimentsSchema` is `.passthrough()` and the raw product is `Record<string, any>`, so these fields are **already in the HTTP response and discarded today** (Phase 1 confirmed this for the allergen fields).

Extend `offNutrimentsSchema`, `BarcodePer100g`/`perServing`, and `BarcodeLookupResult` to read (OFF keys — all optional, verify against live payloads per house methodology):

- Nutriments: `saturated-fat_100g`, `trans-fat_100g`, `cholesterol_100g`, `caffeine_100g` / `caffeine_serving` / `caffeine_value` / `caffeine_unit`, plus the already-mapped `sugars_100g`, `salt_100g` (→ sodium), `fiber_100g`.
- Product-level: `nova_group` (1–4), `nutriscore_grade` (a–e), `additives_tags` (`en:eXXX`), `categories_tags`, and `ingredients_text` (Phase 1 already reads `ingredients_text` for allergens — reuse it for caffeine detection).

**Coverage is uneven** (verified in the spike: Monster had no `saturated-fat_100g`; classic Coke had no caffeine mg). Every new field is optional and every consumer (display row and flag) must treat "missing" as **no row / no flag**, never as zero.

**ODbL constraint (carried from Phase 1, unchanged).** All OFF-derived content used here — `nova_group`, `additives_tags`, `nutriscore_grade`, `ingredients_text`, and the caffeine values — is **read live per request and discarded after flag/row evaluation**. None of it is persisted to `barcodeNutrition` or any table feeding the sellable Public API. `barcodeNutrition` continues to store only bare nutrient facts (its current cal/protein/carbs/fat columns).

### 2. Flag evaluation — universal, pure, no profile

Extend the Phase 1 evaluator (`server/services/scan-flags.ts`) with a **pure** universal-flag pass that takes only the product and emits objective flags. **v1 needs no user profile** for these four families — a meaningful risk reduction (no profile fetch, no consent gate, no premium stripping on this path).

New `ScanFlagKind` values (extend `shared/types/scan-flags.ts`):

```
ScanFlagKind =
  | "allergen" | "allergen-unavailable"   // Phase 1
  | "nutrient"                            // high sugar / sat-fat / sodium / caffeine
  | "processing"                          // NOVA
  | "sweetener"                           // artificial sweeteners
  | "nutriscore"                          // A–E grade badge
```

`ScanFlag` gains an optional discriminator for nutrient flags, e.g. `nutrient?: "sugar" | "saturated_fat" | "sodium" | "caffeine"`, and an optional `value?: { amount: number; unit: string }` for the "· 160 mg" style detail.

**Tier landmine (must not regress).** Phase 1's `ScanFlagTier = "safety" | "insight"`, where `"insight"` is the reserved **premium-strip** marker. The universal flags are free, so they **must NOT be tagged `"insight"`** — otherwise a future premium serializer that strips `tier === "insight"` content for free users would silently remove the free universal flags (the exact opposite of the intent). Add a distinct free tier value (e.g. `"nutrition"`) to `ScanFlagTier` for these families; `"insight"` stays reserved for the v2 personalized-boost content. Reuse `severity` unchanged. Because v1 flags are all free, **no server-side content stripping** applies on this path.

Evaluator responsibilities:

- **Nutrient thresholds** — FSA red thresholds (§FSA thresholds), evaluated **per-serving when `isServingDataTrusted`**, else per-100g/ml. Beverage vs food thresholds selected from `categories_tags`.
- **Processing** — `nova_group === 4` → `warn` "Ultra-processed". **v1 ships NOVA-4 only**; a NOVA-3 "Processed" `info` badge is deferred to reduce badge fatigue (NOVA 3/4 already blanket most packaged goods — see Risks).
- **Caffeine** — the degradation ladder (§3).
- **Sweeteners** — `additives_tags` ∩ the curated artificial-sweetener E-number set (§Additives) → `info` "Contains artificial sweeteners".
- **Nutri-Score** — `nutriscore_grade` → `info` grade badge (A–E). Rendered as an at-a-glance grade, not a warning.

### 3. Caffeine — graceful-degradation ladder

Validated against live OFF data on 2026-07-22 (Red Bull 80 mg/serving, Monster 160 mg/serving, Coke Zero 34 mg/serving present as `caffeine_serving`; classic Coke had no mg but "caffeine" in `ingredients_text`; Celsius & 5-Hour Energy absent from OFF entirely).

1. **`caffeine_serving` (or `caffeine_100g` × serving) ≥ 150 mg** → **"High in caffeine · N mg"** (`warn`).
2. **mg present but < 150**, OR **no mg but caffeine detected** via:
   - multilingual ingredient match on `ingredients_text`: `/caffeine|caféine|koffein|cafeína|cafeina|guaraná|guarana/i` (the spike caught Red Bull's German "Koffein" slipping past an English-only match), **or**
   - `categories_tags` ∈ {`en:energy-drinks`, `en:coffees`, `en:colas`, `en:teas`, `en:energy-shots`}
     → **"Contains caffeine"** (`info`).
3. **No mg and no signal / product absent from OFF** → **no flag** (fail-safe; caffeine is not allergen-level safety).

Unit handling: OFF caffeine is grams (`caffeine_unit: "g"`, e.g. `0.16`); convert to mg for display and thresholding. Guard against products that report caffeine in mg already.

**Serving-basis consistency (implementation watch-item).** `caffeine_serving` is tied to _OFF's_ `serving_size`, which may not match the serving the screen renders or `isServingDataTrusted`. The displayed "· N mg" and the 150 mg threshold must be computed against **the same serving the detail screen shows** — derive mg from `caffeine_100g` × the app's rendered serving when serving data is trusted, so the number never contradicts the serving line. When serving is **untrusted**, do not assert a "High" number — **fail-safe to "Contains caffeine"** (presence, no mg).

### 4. Delivery

`GET /api/nutrition/barcode/:code` (`server/routes/nutrition.ts`) attaches the universal flags into the existing `flags: ScanFlag[]`. Phase 1's allergen flags (which DO use the profile, fail-dangerous) continue to flow on the same array; the universal pass is additive and profile-free. Response also carries the new nutrient fields on `per100g`/`perServing` and the product-level `novaGroup`, `nutriScore`, so the client can render rows and badges from one payload.

### 5. Client rendering

- **`NutritionDetailScreen`** (`client/screens/NutritionDetailScreen.tsx`, via `useNutritionLookup.ts`):
  - New **"Heads up"** universal-flag row near the top of the content (below the calorie/macro tiles, above "Additional Nutrients"), rendering `ScanFlagBadge` for each universal flag, highest-severity first. Nutri-Score renders as a distinct grade chip.
  - The Phase 1 **"For you"** allergen section stays as-is (personal, fail-dangerous) and remains visually distinct from "Heads up" (universal). In v2, personalized boosts add "for you" variants of nutrient flags into that section.
  - New nutrient rows (saturated fat, trans fat, cholesterol, caffeine) join the existing "Additional Nutrients" card, each rendered **only when defined** (existing pattern at `NutritionDetailScreen.tsx:561-596`).
  - The informational/medical disclaimer caption already present under "For you" is extended to cover the "Heads up" section: _"Informational only — not medical advice."_
- **Scan-lock `ProductChip`** (`ScanScreen.tsx`): show the single top flag by severity. Allergen safety (Phase 1) still outranks universal flags; among universal flags, `warn` (high-in-X, ultra-processed, high-caffeine) outranks `info`.
- **`returnAfterLog` confirm card:** unchanged from Phase 1 (allergen safety only). Universal flags are informational, not gating, so they do not need to appear on the log-without-detail path.

**Simultaneous-badge rule (resolving the NOVA-ubiquity risk into a concrete rule).** A single energy drink realistically raises five badges at once (High Sugar + High Caffeine + Ultra-processed + Artificial Sweeteners + Nutri-Score E). Fixed ordering, applied everywhere:

1. Sort by severity: `danger` (Phase-1 allergen) → `warn` (high-in-X, ultra-processed, high-caffeine) → `info` (contains-caffeine, artificial sweeteners). Nutri-Score is not sorted into this list — it renders as its own **grade chip** at the end of the "Heads up" row.
2. **Scan-lock `ProductChip`:** top **one** flag only (unchanged from Phase 1).
3. **`NutritionDetailScreen` "Heads up" row:** **no collapse** — show every `warn`/`danger` badge plus the info badges, in the order above, then the Nutri-Score chip. Full transparency is the point ("as much info as possible"), and the realistic ceiling is ~5. Defensive cap only: if the total exceeds **6**, render the first 6 by the ordering above and a trailing **"+N more"** affordance that expands in place (no navigation). This cap should effectively never trigger; it exists so a pathological product can't overflow the layout.

## FSA thresholds (concrete)

UK FSA front-of-pack "red" (high) thresholds. Salt↔sodium: `salt(g) = sodium(mg) / 1000 × 2.5`, i.e. `sodium(mg) = salt(g) × 400`.

**Salt↔sodium — convert exactly once (watch-item).** OFF's canonical field is `salt_100g`, the app stores `sodium`, and OFF _sometimes also_ returns `sodium_100g`. Pick one source of truth in the extractor (prefer the app's existing sodium mapping) and convert in a single place — double-conversion across the extractor and the flag evaluator is an easy, silent 2.5× error.

**Beverage detection — anchor on the parent, tolerate garbage (watch-item).** `categories_tags` is polluted: the spike returned non-English and malformed leaves mixed in (`en:Napoje`, `pt:bebidas cafeína`). Select the beverage (per-100 ml) threshold set by testing for the **`en:beverages`** parent tag (present on every drink in the spike), not by matching leaf categories. If no clean beverage signal is found, fall back to **food** thresholds (conservative for solids; slightly less sensitive for an unrecognized drink — acceptable and documented).

**Food (per 100 g):**
| Nutrient | Red (High) |
|---|---|
| Total sugars | > 22.5 g |
| Saturated fat | > 5.0 g |
| Salt | > 1.5 g → sodium > 600 mg |

**Drinks (per 100 ml)** — selected when `categories_tags` indicates a beverage:
| Nutrient | Red (High) |
|---|---|
| Total sugars | > 11.25 g |
| Saturated fat | > 2.5 g |
| Salt | > 0.75 g → sodium > 300 mg |

**Per-portion escalation** (portions > 100 g/ml): also flag red if a portion contains > 27 g sugars, > 6 g saturated fat, or > 1.8 g salt (> 720 mg sodium).

**Caffeine:** ≥ 150 mg/serving → High; > 0 or detected → Contains (no FSA basis — EFSA references 200 mg single dose / 400 mg daily for adults).

Note the beverage thresholds matter for the marquee case: Red Bull (~11 g sugar/100 ml) sits just under the drink red line → **not** "high sugar" (correctly), while Monster (~11.4 g/100 ml) is just over → "high sugar." Both still flag ultra-processed + caffeine.

## Additives — artificial sweeteners only (v1)

OFF `additives_tags` are E-numbers (`en:e951`). v1 flags only the **artificial sweetener** family, matched against a curated set:

- Aspartame **E951**, Acesulfame-K **E950**, Sucralose **E955**, Saccharin **E954**, Cyclamate **E952**, Neotame **E961**, Advantame **E969**, Aspartame-acesulfame salt **E962**.
- **Excluded** (natural/polyol, not "artificial"): Steviol glycosides E960, sugar alcohols (erythritol E968, xylitol E967, etc.).

Copy: **"Contains artificial sweeteners"** (`info`, neutral). Broad "contains additives" flagging is a non-goal for v1 (alarmist, low-signal).

## Safety invariants (non-negotiable)

1. **Nutrient/processing/caffeine/sweetener flags fail _safe_** — missing data → no flag, never a false "you're fine" and never treating missing as zero.
2. **Allergen flags (Phase 1) unchanged — fail _dangerous_**. The universal pass must not alter Phase 1's fail-dangerous allergen behavior.
3. **Informational framing, never prescriptive.** "High in sugar," not "don't drink this." No diagnosis, no directive.
4. **Persistent disclaimer** on the flags section: "Informational only — not medical advice."
5. **ODbL** — OFF content read live, never persisted to the Public-API-feeding tables (§1).

## Accessibility (gated — this project fails CI on a11y regressions)

Adding 4+ badge families to the detail screen and scan chip is exactly where accessibility regresses, and it overlaps an **already-open Phase-1 follow-up todo** — _"P2 badge-family WCAG contrast + sibling `accessible={true}` grouping."_ **This work absorbs that todo**: implement its two asks as part of the "Heads up" section rather than leaving it to be re-done, and close/annotate the todo when this ships.

Requirements:

- **WCAG contrast** — every new severity and info color (badge text + icon against badge background) meets AA, verified in **both light and dark** themes. Reuse Phase-1 `ScanFlagBadge` severity colors where they already pass; any new `info`/`nutrition`-tier color and the Nutri-Score grade chip's A–E palette must be contrast-checked, not eyeballed.
- **Grouping** — the "Heads up" row is one `accessible={true}` group with a summarizing label (e.g. "3 nutrition flags: high in sugar, high in caffeine, ultra-processed"), so a screen reader announces a coherent unit, not N unlabeled pills. Each badge keeps its own `accessibilityLabel = "title. detail"` (Phase-1 pattern) for when the user navigates into the group.
- **Static content, NOT announcements (regression guard).** Universal flags are **static reading-order content** placed in the DOM/view tree — they must **not** be pushed via `announceForAccessibility`. Phase 1 already codified the iOS _same-commit `announceForAccessibility` collision_ (`docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`); rendering 4+ flag families through announcements would re-open it. `accessibilityLiveRegion` is Android-only and is **not** an acceptable substitute. The severe-allergen haptic/announcement path from Phase 1 is unchanged and is the _only_ announcer on this screen.
- **Ordering for AT** — reading order follows the visual severity order from §5 (danger → warn → info → grade chip), so assistive-tech users hit the most important flag first.

An a11y assertion (grouping label present; no new `announceForAccessibility` call introduced; contrast tokens sourced from the theme) is part of the client render tests below.

## Testing (TDD)

Most weight on the pure evaluator:

- **FSA boundaries** — food and beverage thresholds; on-the-line vs just-over for sugar/sat-fat/sodium; per-serving vs per-100g/ml selection driven by `isServingDataTrusted`; beverage vs food selection driven by `categories_tags`; the sodium↔salt conversion.
- **Caffeine ladder** — mg ≥ 150 → High with value; mg < 150 → Contains; **no mg + multilingual ingredient hit (incl. "Koffein") → Contains**; category-only hit → Contains; no signal → no flag; grams→mg conversion.
- **NOVA** — 4 → ultra-processed; 3 → **no flag in v1**; absent → none.
- **Sweeteners** — each artificial E-number maps; excluded naturals (E960) do **not** flag; empty `additives_tags` → none.
- **Nutri-Score** — grade passthrough; absent → no badge.
- **Missing-data fail-safe** — a product with none of the fields yields zero universal flags and Phase 1 allergen behavior intact.

Plus: OFF-payload fixture tests (using real captured payloads — Red Bull EU, Monster, Coke, Coke Zero) for field extraction; a route-shape test; and client render tests (utils-extracted, per the project's `*-utils.ts` pattern) for badge mapping, the "Heads up" section, and the new nutrient rows.

## Phasing

- **v1 (this spec)** — OFF enrichment + richer nutrient display + all four **universal** objective flags (free), rendered on `NutritionDetailScreen` and the scan-lock chip.
- **v2 — Personal boost + caffeine personalization** — the `CONDITION_FLAG_RULES` annotation layer: nutrient flags escalate wording/salience when they match declared conditions (diabetes → sugar, hypertension → sodium, etc.), reusing the Phase 1 profile fetch (fail-dangerous for allergens, fail-safe for nutrients). Caffeine personalization needs a **new profile signal** (no caffeine-sensitivity/pregnancy field exists today) — either new onboarding capture or a mapping to existing conditions; decided in the v2 spec. Premium boundary (if any) for the boost layer revisited then.
- **Later** — screen convergence (`NutritionDetailScreen` ⊕ `LabelAnalysisScreen`), photo-scan and batch-scan flag surfaces, "better swap" suggestions, kidney/potassium nutrients.

## Risks & open questions

- **OFF field verification** — exact keys/units for `caffeine_*`, `nova_group`, `nutriscore_grade`, `additives_tags`, `saturated-fat_100g`, `trans-fat_100g`, `cholesterol_100g` must be confirmed against live payloads before wiring (spike on 2026-07-22 confirmed the caffeine/NOVA/Nutri-Score keys on 4 products; trans-fat/cholesterol not yet observed in the wild — treat as best-effort optional rows).
- **OFF coverage** — many US products (Celsius, 5-Hour Energy) are absent from OFF entirely → no data, no flags. Same limitation Phase 1 documented; worth measuring hit-rate to set expectations. For a barcode with no OFF hit, the screen shows what other sources provide and simply omits the universal flags.
- **Beverage detection** — beverage vs food threshold selection depends on `categories_tags` being present and correct; fall back to food thresholds if the category is ambiguous (more conservative for solids, slightly less sensitive for drinks — acceptable, documented).
- **Ultra-processed ubiquity** — NOVA 4 covers nearly all packaged drinks/snacks, so the badge will be very common. That is accurate and informational, but verify it doesn't create badge fatigue that dilutes the higher-signal flags.
- **"Contains artificial sweeteners" scope** — E-number list is curated and finite; a sweetener not on the list won't flag. Acceptable for v1; extendable.
- **Latency** — universal flag evaluation is pure/in-memory over data already fetched; negligible. No new network calls on this path.
