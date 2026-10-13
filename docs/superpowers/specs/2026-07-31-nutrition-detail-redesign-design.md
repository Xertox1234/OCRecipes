# Nutrition Detail Redesign — Design (Barcode Scan Flow 2.0, Phase 2)

**Parent spec:** `docs/superpowers/specs/2026-07-29-barcode-scan-flow-2.0-design.md`.
That document's Decisions and Non-goals remain binding and are not re-litigated here.
This spec supersedes only its Phase 2 section (the five-component sketch at its lines
260-274), which named components without designing the presentation they were to carry.

**Status of the parent's complaints:** four of five closed in Phase 1 (`main` @ `d09e135a`,
PRs #736-#745, device-verified 2026-07-31). This spec addresses the fifth: _"The overall
design of the Nutrition Facts screen is poor."_

## Goal

Turn `NutritionDetailScreen` from a flat data dump into a screen that has a point of view
about what it scanned — surfacing more of the nutrition data the app already collects,
giving warnings visual weight proportional to their severity, and giving beneficial
nutrients (fibre, protein) a way to be good news.

## What the user actually asked for

Recorded verbatim, because the parent spec's D4 ("dead Help verify CTA") was already
fixed in #736 and is not what this work is about:

> "It looks unpolished / dated. We should be able to capture more information in my
> opinion. We pay no attention to fiber. We should [be] giving users as much info from
> their scans as possible. […] Items that are high in sugar should be given warnings like
> processed or high in saturated fats. Also the warning chips should be different colours
> so they stand out compared to regular tags. This screen should and can be more robust.
> Also current and advanced design principles, this app needs to feel alive."

Two clarifications from the design session materially changed scope:

1. **The nutrient warnings already ship.** Smart Scan Universal Nutrition Flags v1
   (PR #694, 2026-07-22) emits High-in-Sugar / Sat-Fat / Sodium, Ultra-processed (NOVA 4),
   caffeine and sweetener flags, and renders them in "Heads up" on this screen. The defect
   is **visual, not functional**: `client/components/badge-severity-visuals.ts` gives every
   badge — allergen, nutrient, and neutral tag alike — the identical pill at
   `BADGE_SEVERITY_FILL_OPACITY = 0.1`, with severity carried by text colour alone.
2. **The screen should get longer, not shorter.** The user explicitly wants more
   information per scan. Any proposal that trims content to reduce scroll is wrong.

## Decisions

Settled with the user during the design session. Not open for re-litigation during
implementation.

1. **Nutrient display becomes an FSA traffic-light panel** — red / amber / green bands per
   nutrient, with the value shown. Chosen over solid-fill badges and accent-edge cards
   because it is the only option with a slot for a _positive_ result, which is the only way
   fibre stops being invisible.
2. **The screen leads with a verdict card, using adaptive standouts** (option "B2" in the
   design session). The card promotes the two nutrients that stand out on _this_ product —
   best and worst — above a fixed Calories · Carbs · Protein strip.
3. **Fibre is never omitted.** It is guaranteed a promoted row when only one standout slot
   fills, and renders an explicit grey `NONE` at zero. A zero row and a missing row must be
   visually distinguishable.
4. **The traffic-light panel absorbs "Additional Nutrients."** Sugar, saturated fat and
   sodium currently appear twice — once as a "Heads up" badge, again as a row in the flat
   list — with no connection between them. One panel replaces both. This deletes a section
   rather than adding one.
5. **`Add to Today` moves to a sticky bottom bar.** The screen is getting longer by design;
   the primary action must not get further away.
6. **Three strictly sequential slices** (2a → 2b → 2c below), not one diff. Individually
   reviewable, but **not** independently mergeable — 2b and 2c rewrite the same file, so they
   must never run in parallel worktrees.
7. **Recipe suggestions are Phase 3**, with their own design pass. See Deferred.
8. **A band is never computed from an unverified denominator.** Added after the design
   session, when review found the per-100 g basis is fabricated on the saved-item path
   (see "The basis problem"). Where the basis cannot be resolved, the row renders unbanded.
   This is the one decision below that the user has not seen a mockup of: it means some
   saved items show a panel with values but no traffic lights.

## Non-goals

Inherited from the parent spec and still binding: the `client/camera/` capture path; the
three-valued `ocrText: string | null | undefined` contract from #734; the Today page.

Added here:

- **No change to which flags the server emits.** No existing flag changes its _emission
  condition_. Slice 2a does change the **shape** of the `FSA_*` constants (adding LOW and
  MEDIUM beside the existing HIGH cut-offs), which changes every call site in
  `server/services/universal-flags.ts` — see "The constant shape" below. That is a
  mechanical call-site change, not a behaviour change, and the tests named in Slice 2a
  exist to prove it.
- **No new server route.** All band computation is pure and shared (see Architecture).
  The existing barcode route's **response body does gain one derived scalar** (`isBeverage`)
  — see "The beverage-scale problem". That is the only server-surface change in this spec,
  and it is required rather than convenient.
- **No change to `partitionScanFlags` / `pickTopFlag` / `toRecipeAllergenA11ySuffix`.**
  They relocate call sites only. This repo has been bitten twice by duplicated flag
  composition desyncing across surfaces.

## The two entry paths

`NutritionDetailScreen` serves two callers, distinguished by `route.params.itemId`. Six
sections are already gated on `!itemId` (`:270, 446, 469, 789, 933, 978`). Any design that
considers only the scan-flow view ships a redesign that exists on one of two paths.

The paths have **different data**. `scanned_items` (`shared/schema.ts:218-265`) stores
`calories, protein, carbs, fat, fiber, sugar, sodium` and nothing else. Saturated fat,
trans fat, cholesterol and caffeine have no columns — a documented won't-fix recorded at
`client/hooks/useNutritionLookup.ts:179-185`.

| Panel row                                   | Scan path (`barcode`) | Saved-item path (`itemId`)                |
| ------------------------------------------- | --------------------- | ----------------------------------------- |
| Sugar                                       | ✅ banded             | ⚠️ banded **only if the basis resolves**  |
| Sodium                                      | ✅ banded             | ⚠️ banded only if the basis resolves      |
| Total fat                                   | ✅ banded             | ⚠️ banded only if the basis resolves      |
| Fibre                                       | ✅ banded             | ⚠️ banded only if the basis resolves      |
| Protein (benefit)                           | ✅ banded             | ⚠️ banded only if the basis resolves      |
| Saturated fat                               | ✅ banded             | ❌ **"Not recorded"** — never a green LOW |
| Trans fat, cholesterol, caffeine (unbanded) | ✅ value shown        | ❌ **"Not recorded"**                     |

The ⚠️ rows are the subject of "The basis problem" below, and the reason `bandFor` takes an
explicit basis rather than reading `effectivePer100g` directly. On the saved-item path
`effectivePer100g` currently reports per-**serving** numbers labelled as per-100 g.

**The scan path is not unconditionally ✅ either.** It bands correctly whenever the server
response is present, because that response carries both a trustworthy `per100g` and the
`isBeverage` scale flag. On the direct-OFF client fallback — or any path without that
response — it falls to the same rule-2 resolution as saved items, and can land on `unknown`.
Read the ✅ column as "banded when the server response is present".

The saved-item view therefore receives the same panel, with saturated fat rendering as
explicitly unknown. This is not a special case bolted on: it is the same `unknown` band the
scan path uses when a product genuinely lacks the value, and Decision 3 already requires
unknown and zero to look different.

The saved-item view keeps its existing omissions (no serving controls, no notices, no
verification panel, no log button) — those gates are correct and unchanged.

## Architecture

### Where band logic lives, and why

Bands must be computed **client-side from `effectivePer100g`**, not server-side.

The saved-item path never touches `GET /api/nutrition/barcode/:code` — it fetches
`/api/scanned-items/:id`, which returns the Drizzle row with no `flags[]`. A server-computed
band would therefore be absent on exactly one of the two entry paths.

But duplicating thresholds between `server/services/nutrition-flag-rules.ts` and a client
copy is the desync failure this repo has already suffered twice. So:

**The thresholds and the band function move to `shared/`, and the server imports them.**

- `shared/constants/nutrition-bands.ts` — the threshold table. The existing `FSA_FOOD`,
  `FSA_DRINK`, `FSA_PORTION` constants **move here from
  `server/services/nutrition-flag-rules.ts`**, along with `isBeverageCategory` and
  `BEVERAGE_PARENT`.
- `shared/lib/nutrition-bands.ts` — pure functions (`resolveBasis`, `bandFor`,
  `pickStandouts`). No React, no Express. Sits beside the existing pure helpers
  `label-serving.ts`, `quantity.ts`, `units.ts`.

**`server/services/universal-flags.ts` imports these directly from
`@shared/constants/nutrition-bands`** — it must NOT go through a re-export in
`nutrition-flag-rules.ts`. A re-export would leave `FSA_` identifiers under `server/` and
defeat any duplication guard. After 2a, **zero `FSA_` identifiers exist under `server/`**,
and that is assertable.

#### The constant shape

The move is not a pure move: adding LOW and MEDIUM changes each nutrient from a scalar to a
band triple. `universal-flags.ts` currently reads them flat (`per100.sugar`,
`FSA_PORTION.sugar`, `FSA_PORTION.saturatedFat`, `FSA_PORTION.sodium`), so every one of
those call sites changes.

```
// shared/constants/nutrition-bands.ts
export const FSA_FOOD = {
  sugar:        { low: 5.0,  high: 22.5 },
  saturatedFat: { low: 1.5,  high: 5.0  },
  fat:          { low: 3.0,  high: 17.5 },
  sodium:       { low: 120,  high: 600  },   // mg
} as const;
// FSA_DRINK: same keys, drink values.
// FSA_PORTION: red-only — { sugar: 27, saturatedFat: 6, sodium: 720 }, NO `fat` key.
```

MEDIUM is the open interval between `low` and `high`; it is not stored, so it cannot drift
out of step with the two boundaries that define it.

**State the 2a diff honestly:** it is a _call-site shape change_ in `universal-flags.ts` with
**emission conditions unchanged** — `per100.sugar` becomes `per100.sugar.high`. It is not a
no-op diff, and the row in the file map says so.

### File map

**New — shared**

| File                                  | Purpose                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared/constants/nutrition-bands.ts` | FSA low/medium/high boundaries + EU 1924/2006 benefit-claim thresholds. Receives the three `FSA_*` constants plus `isBeverageCategory` / `BEVERAGE_PARENT`, moved out of the server. |
| `shared/lib/nutrition-bands.ts`       | `resolveBasis(...)`, `bandFor(nutrient, basis)` and `pickStandouts(bands)`. Pure.                                                                                                    |

**New — client** (all under `client/components/nutrition/`)

| File                                     | Purpose                                                                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NutritionSummaryCard.tsx` + `-utils.ts` | The verdict card: Nutri-Score ring, two promoted standout rows, fixed Calories · Carbs · Protein strip.                                            |
| `NutritionPanel.tsx` + `-utils.ts`       | The full nutrient table — banded rows above, unbanded rows below (see "Panel composition"). Replaces "Additional Nutrients".                       |
| `ProductHero.tsx`                        | Product image, name, brand, serving context.                                                                                                       |
| `FlagSections.tsx`                       | "For you" and "Heads up". Non-scalar flags only (processing, sweetener, caffeine, allergen, Nutri-Score) — scalar nutrients now live in the panel. |
| `CapturedPhotos.tsx`                     | The captured-photo tiles, moved from the screen.                                                                                                   |
| `VerificationPanel.tsx`                  | Verification badge + the front-label CTA.                                                                                                          |
| `LogActionBar.tsx` + `-utils.ts`         | Sticky bar. Owns the `logGate` branch and the acknowledgement state.                                                                               |
| `NoticeStack.tsx` + `-utils.ts`          | One consistent treatment for all advisory notices.                                                                                                 |

**Modified**

| File                                          | Change                                                                                                                                                                                                                                                 | Slice       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `server/services/nutrition-flag-rules.ts`     | Loses the `FSA_*` constants, `isBeverageCategory`, `BEVERAGE_PARENT` to shared. Keeps the caffeine/sweetener rules. **No re-export.**                                                                                                                  | 2a          |
| `server/services/universal-flags.ts`          | Imports the constants from `@shared/constants/nutrition-bands`; call sites updated for the band-triple shape (`per100.sugar` → `per100.sugar.high`). Emission conditions unchanged.                                                                    | 2a          |
| `server/routes/nutrition.ts`                  | Response body gains the derived scalar `isBeverage: **boolean \| undefined**` (key OMITTED when `categoriesTags` is empty — see the amendment note under "The beverage-scale problem"), computed before the ODbL tag trim. Sole server-surface change. | 2a          |
| `shared/lib/label-serving.ts`                 | Gains a unit-aware basis parser (sibling `parseServingBasis`, or a widened return) + docblock scope extension. Permissiveness must not narrow.                                                                                                         | 2a          |
| `client/hooks/useNutritionLookup.ts`          | Reads `isBeverage` through an explicit boundary check (response is currently untyped `json()` at `:389`). Exposes the resolved basis.                                                                                                                  | 2a          |
| `client/screens/NutritionDetailScreen.tsx`    | 2b: extraction + `useHeaderContentInset` swap. 2c: new presentation.                                                                                                                                                                                   | 2b, then 2c |
| `client/components/badge-severity-visuals.ts` | Gains the benefit (green) entry **and** a distinct concern-LOW green — see "Tokens". Existing severity mappings unchanged.                                                                                                                             | 2c          |

### The basis problem — a band is only as good as its denominator

**Every FSA threshold is per 100 g or per 100 ml. A band computed on the wrong denominator
is confidently wrong, and nothing on screen says so.** This is the single largest
correctness risk in the design.

**It is latent today, and this design is exactly what would arm it.** `effectivePer100g`
has one consumer — `recalculateNutrition` (`:273`) — reachable only from `ServingControls`,
which does not render when `itemId` is set (`NutritionDetailScreen.tsx:270`). So the
fabricated value is computed and never read on the saved-item path. That protection is an
accident of which components render, not a guard: reading `effectivePer100g` from the panel
would arm it immediately, with no test failure and no visible signal.

Verified in code, not assumed:

- `useNutritionLookup.ts:186-190` — `effectivePer100g` returns `validatedData.per100g` when
  present, otherwise back-calculates: `const grams = servingSizeGrams || 100; factor = 100 / grams`.
- On the saved-item path `validatedData` is null (its own comment at `:180`), and the
  `existingItem` effect at `:782-787` calls **only** `setNutrition` — it never calls
  `setServingSizeGrams`, which therefore stays `null` from its initialiser at `:92`.
- So `servingSizeGrams || 100` yields `factor = 1`, and **per-serving values are returned
  labelled as per-100 g**. `isPer100g` stays false, so no banner fires either.

Worked examples of what the panel _would_ show if it read `effectivePer100g` — both wrong
in the alarming direction:

| Product                            | True basis      | Fabricated basis | Correct band   | Band as computed |
| ---------------------------------- | --------------- | ---------------- | -------------- | ---------------- |
| Amy's chili, 680 mg sodium / 236 g | 288 mg / 100 g  | 680 mg           | MEDIUM         | **HIGH**         |
| Cherry Coke, 39 g sugar / 355 ml   | 11.0 g / 100 ml | 39 g             | MEDIUM (drink) | **HIGH**         |

A second, independent basis failure: FSA drink thresholds are roughly **half** the food
ones (sugar HIGH 11.25 vs 22.5). Choosing the wrong scale flips bands on its own, and the
saved-item path has no category tags to choose with.

**Therefore `bandFor` takes an explicit basis, and an unresolvable basis produces no band.**

```
type Basis =
  | { scale: "food"; per100: number }    // value already per 100 g
  | { scale: "drink"; per100: number }   // value already per 100 ml
  | { scale: "unknown" }                 // → row renders UNBANDED

bandFor(nutrient, basis): Band
```

An `unknown` basis renders the row in the **unbanded** state already defined under Panel
composition — value shown, no indicator dot, no tag. This is the correct meaning of that
state widened by one case: _known value, no standard we can safely apply_. It is never
rendered as a green LOW.

Basis resolution, in order:

1. `validatedData.per100g` present → trustworthy denominator. Scale from the response's
   `isBeverage` flag (see "The beverage-scale problem" below — **not** from category tags,
   which the client is licensed not to receive).
2. No `validatedData`, but the item's serving string parses to a positive metric quantity →
   back-calculate from **that** number, never from the `|| 100` default. Take the scale from
   the parsed **unit**: millilitres → `drink`, grams → `food`. This mirrors the FSA's own
   per-100 g / per-100 ml split, so the unit is a legitimate signal rather than a guess.
3. Anything else — no parse, a zero or negative quantity, a non-metric-only string,
   or a resolved quantity with no usable scale → `unknown`.

#### Rule 2 needs a parser change — the existing one discards the unit

`shared/lib/label-serving.ts` handles the real-label forms (`"1 can (355 mL)"`, dual-unit
`"(198g/7oz)"`, OCR spacing), but **it cannot supply the scale as written**: its `UNIT` is a
**non-capturing** group — `(?:grams?|g|millilit(?:re|er)s?|ml)` — and `parseLabelServingGrams`
returns `parseFloat(match[1])`, the number only. The unit never leaves the function.

Its docblock also scopes it to _photographed label text_ and states outright that the two
existing `parseServingGrams` functions "are left alone for their own callers (DB serving
strings, the serving-size controls)". A saved item's `servingSize` is a DB string — the case
that module explicitly hands off.

So Slice 2a must **widen it deliberately**, in one of two shapes:

- Change `parseLabelServingGrams` to return `{ grams: number; unit: "g" | "ml" } | null`
  (capture the alternation) and update its two existing gate callers, `isLabelReady` and
  `buildLabelConflict`; **or**
- Add a sibling `parseServingBasis` in the same module, leaving the gate function untouched.

Prefer the sibling unless the gate callers genuinely want the unit — it keeps the two
load-bearing gates off the diff. Either way, the same slice must extend the docblock's scope
sentence to cover DB serving strings, and extend its regression suite. That suite exists
because the two gates previously drifted apart; the docblock's **"MUST BE AT LEAST AS
PERMISSIVE AS BOTH PREDECESSORS"** warning is binding on this change — a narrowing here
rejects labels that work today and tells the user their nutrition values could not be read.

#### The beverage-scale problem — the client is licensed not to know

FSA drink thresholds are roughly **half** the food ones (sugar HIGH 11.25 vs 22.5), so the
scale is not a detail — choosing wrong flips bands on its own.

**The signal the server uses is deliberately withheld from the client.**
`server/routes/nutrition.ts:138-150` destructures `categoriesTags` out of the response body,
with the comment: _"additivesTags/categoriesTags are OFF-licensed (ODbL) content that must
never reach the client or be persisted."_ There are zero references to `categoriesTags`,
`isBeverageCategory` or `en:beverages` anywhere in `client/` or `shared/`. Shipping the tags
to satisfy this design would breach a constraint the repo treats as absolute — the same one
protecting the sellable Verified Product API.

**Resolution: the response gains a derived scalar `isBeverage: boolean | undefined`.** A
computed boolean is not OFF content — it is our own classification _about_ the product, the
same category of output as the `flags[]` array the route already returns. The ODbL rationale
for trimming the raw tags is preserved intact, and the client gets exactly the one bit it needs.

> **AMENDED 2026-07-31 during slice-2a implementation (user-approved). This section
> originally specified `isBeverage: boolean`.** That was wrong, and reachable in production
> rather than theoretical: `isBeverageCategory([])` returns `false` by design, and
> `extractOffUniversalData(null)` (`server/services/barcode-lookup.ts:123-146`) returns
> `categoriesTags: []` for a null/absent OFF product — its own docblock says so. So **every
> USDA-only barcode with no Open Food Facts entry**, and every OFF product lacking
> `categories_tags`, would have shipped a confident `isBeverage: false`.
>
> That is worse than omitting the field. `resolveBasis` treats `false` as fully trusted and
> **short-circuits before its serving-unit fallback arm ever runs** — so an untagged beverage
> with a parseable `"1 can (355 mL)"`, which the unit fallback resolves correctly to `drink`,
> is instead forced onto the food scale. Food thresholds are roughly double drink thresholds,
> so it receives half the strictness. An **absent** field is safe (it reaches the fallback);
> a present-but-wrong `false` overrides the heuristic that would have got it right.
>
> The server now **omits the key** when `categoriesTags` is empty. This section's own
> error-handling table already defined that behaviour ("`isBeverage` absent → scale falls
> back to the parsed serving unit → never defaults to food"), so the `: boolean` annotation
> was the internally inconsistent part, and it lost to the two safety constraints it
> collided with ("three states stay distinct" and "never defaults to food").
>
> Client-side narrowing is unchanged and already handled it:
> `typeof data.isBeverage === "boolean" ? data.isBeverage : null`.
>
> Tests must assert absence with `expect(res.body).not.toHaveProperty("isBeverage")`, **not**
> `toBeUndefined()` — the latter also passes for a present-but-undefined key and would miss a
> regression that serializes `null`.

This requires:

- `server/routes/nutrition.ts` — compute `isBeverage` from the tags it already holds, before
  they are trimmed, and add it to the returned object. It is the sole server-surface change.
- `isBeverageCategory` and `BEVERAGE_PARENT` move to `shared/constants/nutrition-bands.ts`
  alongside the `FSA_*` constants (client code cannot import from `server/`).
- `useNutritionLookup` reads it through an explicit boundary check — the barcode response is
  consumed as untyped `await serverRes.json()` at `:389`, so a new wire field must be
  narrowed at the boundary rather than trusted as `any`.

**Consequence for the entry-path table above:** a scan-path product whose lookup succeeded
still bands correctly, because `isBeverage` arrives with it. But a product on the direct-OFF
client fallback, or any path without the flag, falls to rule 2 — and a drink whose serving
string is `"1 bottle"` resolves to `unknown` and renders unbanded. The ⚠️ marks apply to the
scan path too whenever the server response is absent.

**Side effect worth noting:** touching `server/routes/nutrition.ts` puts this work under the
auto-merge guard's **sensitive override** (`server/routes/` is listed there), so 2a cannot
auto-merge. That is the correct outcome — see Slices.

**The `|| 100` fallback is not fixed by this spec.** It stays where it is, serving its
existing callers; the band path simply stops trusting it. Repairing it is
`todos/P3-2026-07-30-secondary-normalization-fabricates-100g-basis.md` and touches the
serving-controls maths, which is out of scope here.

Consequence to accept openly: saved items whose `servingSize` text does not parse show an
unbanded panel. That is the honest outcome — the alternative is a red dot derived from a
number the code invented.

### Thresholds — exact values

**FSA concern bands.** LOW and MEDIUM are per 100 g (food) / 100 ml (drink). HIGH uses the
per-100 basis _or_ the per-portion override for portions >100 g/ml — this asymmetry is the
FSA's own design, and is why the existing `FSA_PORTION` constant is red-only. Preserve it.

Per 100 g (food):

| Nutrient      | LOW (green) | MEDIUM (amber)    | HIGH (red) |
| ------------- | ----------- | ----------------- | ---------- |
| Sugars        | ≤ 5.0 g     | > 5.0 to ≤ 22.5 g | > 22.5 g   |
| Saturated fat | ≤ 1.5 g     | > 1.5 to ≤ 5.0 g  | > 5.0 g    |
| Total fat     | ≤ 3.0 g     | > 3.0 to ≤ 17.5 g | > 17.5 g   |
| Sodium        | ≤ 120 mg    | > 120 to ≤ 600 mg | > 600 mg   |

Per 100 ml (drink):

| Nutrient      | LOW (green) | MEDIUM (amber)     | HIGH (red) |
| ------------- | ----------- | ------------------ | ---------- |
| Sugars        | ≤ 2.5 g     | > 2.5 to ≤ 11.25 g | > 11.25 g  |
| Saturated fat | ≤ 0.75 g    | > 0.75 to ≤ 2.5 g  | > 2.5 g    |
| Total fat     | ≤ 1.5 g     | > 1.5 to ≤ 8.75 g  | > 8.75 g   |
| Sodium        | ≤ 120 mg    | > 120 to ≤ 300 mg  | > 300 mg   |

Sodium values are pre-converted from the FSA's salt figures at salt (g) × 400 = sodium (mg).
The existing file carries a **single-conversion rule** — do not re-derive salt or re-convert
sodium anywhere downstream. Sodium LOW is 120 mg on **both** bases: FSA salt LOW is 0.3 g/100
for food and drink alike, and only the HIGH figure differs (1.5 g vs 0.75 g → 600 / 300).
That asymmetry is correct; do not "fix" it.

**What is new versus what is shipped.** For sugar, saturated fat and sodium, the HIGH values
above match the shipped constants exactly (22.5 / 5.0 / 600 and 11.25 / 2.5 / 300); only LOW
and MEDIUM are new. **Total fat is entirely new** — `FSA_FOOD`/`FSA_DRINK` carry no `fat`
member today, so its HIGH (17.5 food / 8.75 drink) is a new value, and `FSA_PORTION` has no
`fat` key at all. **The per-portion HIGH override does not apply to total fat**: the FSA
publishes portion figures only for the three nutrients it already covers, and inventing a
fourth would be our number, not theirs. Adding a `fat` key to the per-100 objects does not
alter emission, because `universal-flags.ts` enumerates the nutrients it flags explicitly.

**Cite the sources in the constants file, not only here.** These 24 boundary values will be
transcribed into `bandFor`'s tests _from this table_, so a transcription error becomes a
green test asserting the wrong threshold — no executable check can catch that. Put the FSA
front-of-pack guidance reference and the EU Regulation 1924/2006 Annex reference in
`shared/constants/nutrition-bands.ts` beside the numbers, so a reviewer can check them
against a source rather than against themselves.

#### Band tag copy

The tag is the non-colour channel (see Accessibility), so its text is a requirement, not a
styling choice:

| Band                    | Tag                  | Notes                                  |
| ----------------------- | -------------------- | -------------------------------------- |
| Concern HIGH            | `HIGH`               |                                        |
| Concern MEDIUM          | `MED`                |                                        |
| Concern LOW             | `LOW`                |                                        |
| Benefit EXCELLENT       | `EXCELLENT`          | Card copy: "Excellent source of fibre" |
| Benefit GOOD            | `GOOD`               | Card copy: "Good source of fibre"      |
| Benefit NONE (zero)     | `NONE`               | Grey. Distinct from not-recorded.      |
| Unknown band / unbanded | _(no tag)_           | Value only, no indicator               |
| Not recorded            | `—` + "Not recorded" | Distinct from a zero value             |

#### Tokens

`badge-severity-visuals.ts` currently maps LOW severity to **`badgeInfoText` — blue, not
green** (`LOW_SEVERITY_VISUALS`). So "red / amber / green" does not fall out of the existing
three-level mapping, and the file needs **two** additions, not one: a concern-LOW green and a
benefit green. State whether they share a token; they should not if `LOW` and `EXCELLENT`
must be distinguishable at a glance, which Decision 3's zero-vs-unknown logic argues for.

That module's docblock describes a "WCAG-safe **text/icon** token triple" — each severity is
deliberately paired with a distinct Feather icon (`alert-triangle` / `alert-circle` / `info`).
A plain circle in three colours drops that channel. Either the indicator carries the severity
icon (and the new entries gain one, keeping `BadgeSeverityVisuals` whole), or the spec states
that the tag text is the sole non-colour channel and the indicator is purely redundant.
Decide it here rather than at implementation time.

Beverage detection uses the response's derived `isBeverage` flag when present, and otherwise
the parsed serving unit — see Basis resolution above. It never defaults to the food scale:
defaulting would silently halve the strictness applied to every drink whose scale is unknown.

**The per-portion HIGH override needs a portion weight**, which is the same value that may
be missing. When the portion weight is unknown, apply the per-100 basis alone and do **not**
apply the portion override. The override can only ever move a row _up_ to HIGH, so skipping
it fails toward under-warning rather than toward a fabricated red — consistent with every
other unknown-basis decision here, and the row is still banded from a denominator we trust.

**Benefit bands** (EU Regulation 1924/2006 Annex, per-100 g forms, for basis consistency
with the FSA table above):

| Nutrient | GOOD             | EXCELLENT        |
| -------- | ---------------- | ---------------- |
| Fibre    | ≥ 3 g / 100 g    | ≥ 6 g / 100 g    |
| Protein  | ≥ 12 % of energy | ≥ 20 % of energy |

Protein energy share = `protein_g × 4 / total_kcal`. When `total_kcal` is absent or zero,
the band is `unknown`, not `none`.

Display copy is "Good source of fibre" / "Excellent source of fibre". The FDA per-serving
%DV regime was considered and rejected: it uses a different denominator from the FSA table,
and mixing bases in one panel is how conversion bugs start.

### Panel composition — nothing currently shown may be lost

Decision 4 says the panel absorbs "Additional Nutrients". That section currently renders
seven rows: fibre, sugar, sodium, saturated fat, **trans fat, cholesterol, caffeine**. Only
the first four have FSA bands; the last three have no published traffic-light threshold.

Deleting them would remove data on a screen whose whole purpose is to show _more_. So the
panel has two zones in one card:

1. **Banded rows** — sugar, saturated fat, sodium, total fat, fibre, protein. Value plus a
   red/amber/green indicator and a band tag. Tag text is fixed in "Band tag copy"; the
   indicator's screen-reader treatment and the row's composed label are specified under
   Accessibility, and are requirements rather than implementation latitude.
2. **Unbanded rows** — trans fat, cholesterol, caffeine. Value only, no indicator dot, no
   tag, visually quieter. They render under a divider inside the same card.

An unbanded row is not a green row. The absence of an indicator must not read as "low" —
this is the same distinction Decision 3 draws between zero and unknown, applied to a third
state: _known value, no standard to judge it against_.

Unbanded rows are never eligible for standout promotion, since promotion is defined in
terms of bands.

Note that total fat and protein appear both in the summary card's fixed strip (as raw
values) and in the panel (as bands). That is intentional: the strip answers "how much", the
panel answers "is that a lot".

### The standout rule

`pickStandouts(bands)` — pure, deterministic, exactly two rows.

1. **Concern nutrients** (sugar, saturated fat, sodium, total fat) band to
   `high | medium | low | unknown`.
2. **Benefit nutrients** (fibre, protein) band to `excellent | good | none | unknown`.
3. Slot one: the worst concern at MEDIUM or above. Slot two: the best benefit at GOOD or
   above.
4. If exactly one slot fills, the other is **always fibre's row**, whatever its band —
   including `none` and `unknown`. This is what guarantees fibre appears on every product
   (Decision 3).
5. If neither fills, promote fibre plus the first concern in fixed order that has a known
   **value** — regardless of band. Do **not** rank by raw magnitude here: the concerns carry
   different units (grams and milligrams) and comparing them numerically is meaningless.
6. Ties break on fixed nutrient order — concerns `[sugar, saturatedFat, sodium, fat]`,
   benefits `[fibre, protein]` — so the same product always shows the same two rows across
   renders and sessions.

**Rules 3 and 4 test the BAND. Rule 5 tests VALUE-PRESENCE, deliberately.** An `unknown`
band never satisfies rules 3 or 4 — it cannot, since those ask "is this high enough to
promote" and an unknown band has no position on the scale. But rule 5 is the exhaustion
fallback, and it is reached on exactly the state Decision 8 manufactures: a saved item whose
basis did not resolve, where **every band is unknown while every value is known**. That is
the dominant saved-item case, not an edge case. Showing two unbanded value rows there is the
intended outcome; showing nothing would be a blank card on a screen whose premise is
surfacing data.

`pickStandouts` therefore always returns exactly two distinct rows whenever at least two
nutrients have values, and this must be asserted in every test case, not only the happy
ones.

> **AS BUILT in 2a — `Standout` carries `hasValue: boolean`.** This section did not specify
> the return type, so nothing above is wrong; this records what 2c will actually receive.
> Rule 4 promotes fibre _regardless of `hasValue`_, so without carrying the flag through, a
> promoted fibre row representing a nutrient with **no recorded value at all** would arrive
> byte-identical to one whose value merely could not be placed on a scale — collapsing two of
> the three states this design says must stay distinct.
>
> **2c must derive `hasValue` from the raw value's presence, NEVER from `band === "unknown"`.**
> `concernBand` and `benefitBand` both return `unknown` for an absent value _and_ for an
> unresolved basis, so deriving the flag from the band re-collapses exactly the two states it
> exists to separate — silently, and in a way no type checker can see.

### Slices

**Strictly sequential: 2a → 2b → 2c. Never in parallel.** 2b and 2c both rewrite
`client/screens/NutritionDetailScreen.tsx`, so they cannot run in separate worktrees (which
is how `/todo` executes batches) and cannot merge in either order independently. Each slice
is _individually reviewable_; they are not _independently mergeable_.

| Slice                  | Content                                                                                                                                                                                                                                                    | Verification                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **2a — Bands & basis** | Constants + `isBeverageCategory` move to `shared/`; `shared/lib/nutrition-bands.ts` (`resolveBasis`, `bandFor`, `pickStandouts`); `universal-flags.ts` call-site shape update; `isBeverage` on the barcode response; the unit-aware serving parser. No UI. | Unit tests + literal constant pins + the 4 missing emission cases. Emission conditions unchanged (not "no diff"). |
| **2b — Extraction**    | Move `ProductHero`, `FlagSections`, `CapturedPhotos`, `VerificationPanel` into `client/components/nutrition/`. Swap `useHeaderHeight` → `useHeaderContentInset`, both branches. Behaviour-preserving.                                                      | Existing tests stay green with **zero visual delta**.                                                             |
| **2c — Presentation**  | `NutritionSummaryCard`, `NutritionPanel`, sticky `LogActionBar`, `NoticeStack`. Deletes "Additional Nutrients". Narrows `FlagSections`. Fixes animation ordering.                                                                                          | New tests + device pass.                                                                                          |

**`FlagSections` is a verbatim move in 2b — scalar nutrient flags included.** The narrowing
to non-scalar flags happens in **2c**, when the panel that replaces them exists. Applying it
in 2b would delete the sugar / saturated-fat / sodium badges with nothing rendering in their
place, inside a slice whose whole claim is zero visual delta. When the narrowing does land,
`"nutrient"` must stay in `UNIVERSAL_KINDS` — `partitionScanFlags` warn-and-drops unmodelled
kinds, so removing it there would silently swallow the flags rather than relocate them.

**Auto-merge must be disarmed on 2a and 2c.** `scripts/todo-automerge-guard.sh` allowlists
`^client/`, `^server/services/`, `^shared/constants/`, `^shared/lib/` — every path here — so
a `medium`-priority todo would arm `gh pr merge --auto` and land on green CI. But 2c makes a
**device pass** a merge precondition and that is not a CI check, and 2a changes the code
deciding whether a user is told their food is high in sugar. Both todos carry
`priority: high`, which the guard never auto-merges. (2a additionally touches
`server/routes/`, which is on the guard's sensitive override — belt and braces, but do not
rely on that alone, since the route change is one line of a much larger diff.)

## Motion

The user asked for the app to "feel alive". Three changes, all gated on the existing
`useAccessibility().reducedMotion`:

1. **Fix the entrance-order defect.** Today the flag sections render at `:379-444` (upper)
   with `delay(450)/(475)` while the calorie card renders at `:588-679` (lower) with
   `delay(200)` — content fades in bottom-up. Delays must ascend with final visual position.
   This is a bug, not a preference, and accounts for much of what reads as unpolished.
2. **Animate value transitions.** Changing the serving quantity currently snaps every
   number. The macro strip and panel values should transition, so a serving change is
   visibly a change.
3. **Entrance transition on the summary card** — the one element that earns emphasis.

No motion is added to the log action, which must stay immediately actionable.

**No formatting inside a worklet.** Animating a number normally tempts a formatter into
`useAnimatedProps` / `useDerivedValue`. A function imported from `NutritionPanel-utils.ts` or
`shared/lib/nutrition-bands.ts` and called inside a worklet body needs its own `"worklet"`
directive, and a miss is a **silent app close in release/OTA builds** that `tsc`, ESLint and
the entire Vitest suite all pass. Drive item 2 with `withTiming` on opacity/translate only
and set the text through React state. Adding `"worklet"` to `shared/lib/nutrition-bands.ts`
is the wrong escape hatch here — the Express server imports that module.

**`reducedMotion` must still land on the value.** The reduced-motion branch skips the
transition but must assign the new number; a branch that skips the animation _and_ the
assignment leaves stale figures on a screen whose entire premise is showing true ones.
Cancel any in-flight animation before a static assignment, and resync when `reducedMotion`
changes at runtime.

## Notices

Six advisory surfaces exist today with three different treatments at three scroll depths:
`labelReadNotice` (`:446`), `correctionNotice` (`:469`), `error` (`:508`), the per-100g info
banner (`:789`), `ScanConflictPrompt` (`:369`), and the "Informational only — not medical
advice" caption repeated in both flag sections.

`NoticeStack` renders all of them in one position with one row treatment, ordered by
severity. `ScanConflictPrompt` keeps its own component (it is interactive — it offers a
source choice — and must not be collapsed into a passive row). The medical-advice
disclaimer renders once, not per section.

Preserved exactly: the `!itemId` gating on all four.

**Not preserved — the announcement mechanism is replaced, deliberately.** Today each notice
is a sibling `View` carrying `accessibilityLiveRegion="polite"`. Two things are wrong with
carrying that forward:

1. **`accessibilityLiveRegion` is Android-only.** `announceForAccessibility` appears exactly
   twice in the screen (`:71` Loading, `:993` acknowledge), so **iOS users are told nothing**
   when any of the four notices appears. `NoticeStack` is written test-first — this is the
   one moment it gets fixed for free.
2. **Hoisting the region to the shared container is a codified anti-pattern.** A `"polite"`
   region on a container wrapping multiple variants makes TalkBack compose
   `CONTENT_CHANGE_TYPE_SUBTREE` and re-read _every_ mounted notice plus the always-present
   medical-advice disclaimer on any single descendant change — and `correctionNotice`
   mutates on every serving adjustment.

So: **`NoticeStack` carries no `accessibilityLiveRegion` on its container, and no per-row
live regions.** It owns one edge-guarded imperative announcer, keyed on the notice **content
string** rather than the notice kind — the ProductChip precedent exists because content that
mutates while the discriminator stays constant silently stops announcing. With no live region
anywhere there is no double-announce risk, so the announce is **ungated on both platforms**.

**The announcer must not collide with the acknowledge announce.** iOS
`UIAccessibility.post(.announcement)` does not queue: two calls in one commit and one is
dropped. The casualty must never be the `logGate` acknowledge announce (`:993`), which exists
specifically to stop a screen-reader user logging unreviewed values. Make the two mutually
exclusive, and assert it by **call count** — a test asserting only that the string was
announced passes when both fire.

**`error` renders through `InlineError`**, not as a `NoticeStack` row: error messages require
`assertive`, not `polite` (`docs/rules/accessibility.md`), and `InlineError` is the canonical
component. It fires its own iOS-gated announce internally, so it must be **excluded** from
the `NoticeStack` announcer or iOS hears it twice.

## Accessibility

The 2026-07-22 universal-flags spec carries a section like this and this work is a larger
visual change than that one was. Every item below is a requirement, not a guideline.

**The traffic-light indicator is a visual-only status indicator.** Per
`docs/rules/accessibility.md`, it gets `accessible={false}` +
`importantForAccessibility="no"`, and its meaning is rolled into the row's group label. Never
give it `accessibilityRole="checkbox"`/`"radio"`/`"switch"` — it is not a `Pressable`, and
announcing a toggle affordance that does nothing is worse than silence.

**Each panel row is one `accessible` group** whose label is composed by a pure function in
`NutritionPanel-utils.ts` from (nutrient, value, unit, band word). Requirements:

- **Spell the unit out** — "39 grams", not "39 g". VoiceOver reads a bare `g` as "gee".
- Unbanded rows compose without a band word; not-recorded rows say "not recorded".
- The composed label is **assertable in jsdom** — the harness limitation below concerns
  `accessible` subtree _collapse_, not label props. This must not be deferred to the device
  pass.
- No interactive child inside a grouped row, or the group swallows it.

**The band must never be conveyed by colour alone** (WCAG 1.4.1). The tag text in "Band tag
copy" is the non-colour channel and is therefore load-bearing, not decoration.

**Contrast has two different criteria here.** Tag/label text is WCAG 1.4.3 at 4.5:1 — route
every new token through the existing `badge-contrast` test. The indicator is a _graphical
object_: WCAG 1.4.11 at 3:1 against the card background, in **both** themes. Naming only the
text criterion invites picking a lighter green that passes the wrong test.

**The Nutri-Score currently appears twice under this design** — a ring in the summary card
and a chip in `FlagSections`. Decide which survives. If the ring stays, it inherits the
existing chip's reasoning verbatim: a collapsed subtree announces only the group label and
the grade letter is not in it, so the ring is either `accessible={false}` with the grade
rolled into the card's label, or it renders outside the group as the chip does today.

**The promoted standout rows duplicate panel rows below them.** A screen-reader user hears
sugar twice. The macro strip's duplication is justified in "Panel composition" ("the strip
answers how much, the panel answers is that a lot"); this one needs the same one-sentence
justification or a suppression.

**The sticky bar renders inside the `accessibilityViewIsModal` root**, or it falls outside
the modal's a11y scope on iOS. As an absolutely-positioned sibling after the ScrollView it
becomes the **last** VoiceOver stop on a screen this spec deliberately lengthens — state the
intended focus order and verify it on device. Its controls stay ≥44pt.

**The summary card's grade ring** gets the same treatment as any other visual-only indicator
if it is not the group's label source.

## Safety invariants

Numbered so they can be cited in review, following the 07-22 precedent.

1. **A band is never computed from an unverified denominator.** Unresolvable basis → unbanded
   row. This is Decision 8 and it outranks completeness of the panel.
2. **Nutrient flags fail toward under-warning; allergen flags fail toward warning.** This
   spec touches only the nutrient side. Where a choice exists — a skipped per-portion
   override, an unknown scale — prefer showing less rather than inventing a red.
3. **Three display states must stay visually distinct**: a zero value, a value with no
   applicable standard (unbanded), and no value at all (not recorded). Collapsing any two
   reproduces the fail-silent shape that `nutrient-unavailable` exists to prevent.
4. **OFF content is read live and never persisted, and raw OFF fields never reach the
   client.** The `isBeverage` scalar is our derived classification, not OFF content — that
   distinction is what makes it permissible, and it must not become a precedent for
   forwarding the tags themselves. `barcodeNutrition` feeds the sellable Verified Product
   API; ODbL applies.
5. **The log gate's behaviour is unchanged.** Nothing in this redesign may make it easier to
   log values the user has not confirmed.

## Invariants that must survive the move

These carry non-obvious reasoning. Each is currently guarded by a comment at its site; the
reasoning moves with the code or it silently breaks.

- **`acknowledgedUnverified`'s effect dependency list** (`:264-267`) is keyed on
  `logGate.kind` and `nutrition?.productName` — two _primitives_, deliberately not the
  objects. `useNutritionLookup` returns fresh objects each render, so depending on them
  would reset the acknowledgement every render and leave the log button permanently
  unreachable. `productName` (not `barcode`) is the field that discriminates the
  manual-search transition. 25 lines of comment guard this. When `LogActionBar` takes
  ownership, the comment goes with it.
- **`AccessibilityInfo.announceForAccessibility` on acknowledge** (`:993`) exists because
  both branches render the same `Button` at the same JSX position with no `key`, so a
  changed `accessibilityLabel` on an already-focused node is not re-spoken. Without it a
  screen-reader user perceives nothing and logs unreviewed database values. Any redesign
  that changes keys or positions changes this calculus and must re-derive it.
- **`headsUpSummaryLabel(universalToShow)` / `.slice(0, 6)` parity** (`:280`) — one array
  feeds both the announced group label and the rendered badges. Two call sites desync.
- **The Nutri-Score chip renders outside the `accessible` group** (`:414-421`) on purpose:
  a collapsed subtree announces only the group label, and the grade letter is not in it.
- **The captured-photo group wrapper is device-verified** (iOS VoiceOver, 2026-07-31, PR
  #745). The label belongs on the wrapper, not the `<Image>`, and the group label must
  contain the caption's words. Codified in
  `docs/solutions/design-patterns/accessibility-grouping-pattern-2026-05-13.md`. The tiles'
  JSX is provisional and may be redesigned; **the label strings, the wrapper shape, and the
  tests are not**.
- **`"nutrient-unavailable"` must stay in `UNIVERSAL_KINDS`**
  (`client/screens/nutrition-detail-flags-utils.ts`) — `partitionScanFlags` warn-and-drops
  unmodelled kinds.
- **`accessibilityViewIsModal` is on BOTH branches** — the loading branch (`:292`) and the
  main branch (`:310`). The screen is `presentation: "modal"`
  (`client/navigation/RootStackNavigator.tsx:246`) and VoiceOver navigates behind it without
  this. The loading branch is exactly what an extraction drops silently; 2b owns keeping it.
- **The top inset is currently a rule violation, and 2b fixes it.** `:180` calls
  `useHeaderHeight()` and `:298` / `:316` hand-roll `paddingTop: headerHeight + Spacing.xl`,
  against `docs/rules/react-native.md` — the repo has `useHeaderContentInset()` and
  `ScreenScrollView` for this, already used by six screens. `useHeaderContentInset(Spacing.xl)`
  is arithmetically identical, so the swap clears 2b's zero-visual-delta bar. Both branches.
  Never fix this with an iOS-only prop — it no-ops on Android and leaves the bug live there.
- **The bottom inset must count `insets.bottom` exactly once.** The sticky bar sits over the
  home indicator, so **the bar** owns `paddingBottom: insets.bottom + …`. The ScrollView's
  existing `paddingBottom: insets.bottom + Spacing["3xl"]` (`:299`/`:317`) must not survive
  alongside it, or the inset is double-counted. The ScrollView's bottom padding is the
  **measured** bar height (via `onLayout`, never a hardcoded constant) plus spacing —
  `LogActionBar` has at least three heights, since it owns the `logGate` branch.
- **The micronutrient gate uses sentinel strings** (`:915-917`:
  `!== "Unknown Product"`, `!== "Product Not Found"`). Fragile, and out of scope to fix —
  but if 2c touches that condition, it must be changed deliberately and not incidentally.

## Error handling

| Situation                                                           | Behaviour                                                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A nutrient value is absent                                          | Row renders with an explicit "Not recorded" treatment — never a green LOW. Distinct from a zero value.                                 |
| All nutrients absent                                                | Panel renders its rows as unknown rather than disappearing. A vanished panel reads as "nothing to worry about".                        |
| `total_kcal` absent or zero                                         | Protein benefit band is `unknown`. No division.                                                                                        |
| Saved-item path                                                     | Saturated fat is always "Not recorded" (no column). Other rows band only if the basis resolves.                                        |
| Basis unresolvable                                                  | Every banded row degrades to **unbanded** — value, no dot, no tag. Never a green LOW, and never a fabricated red.                      |
| `isBeverage` absent (older bundle, direct-OFF fallback, saved item) | Scale falls back to the parsed serving unit (ml → drink, g → food). If that fails too, the basis is `unknown`. Never defaults to food. |
| `isBeverage` present but the response is otherwise unusable         | Treated as absent. The flag is only trusted alongside the `per100g` it arrived with.                                                   |
| Portion weight unknown                                              | Per-100 bands still apply; the per-portion HIGH override is skipped.                                                                   |
| Offline                                                             | Unchanged — the existing enqueue path. Bands are pure and need no network.                                                             |
| `logGate` blocks logging                                            | Unchanged from Phase 1, including the announcement. `LogActionBar` owns it.                                                            |

## Testing

Written test-first, per the project's TDD requirement.

**Pure functions (Vitest, no React).** `bandFor` at every boundary — each threshold tested
at the value, just below, and just above, for both food and drink bases; unknown and zero
distinguished. `pickStandouts` across: two concerns and no benefit; one benefit and no
concern; neither; both; and the fibre-guarantee path. Two cases are mandatory and easy to
omit:

- **`all bands unknown, all values present`** — the dominant saved-item state that Decision 8
  manufactures, and the one rule 5 exists for. Assert the exact two rows.
- **Tie-breaks** — two concerns both HIGH → sugar wins; two benefits both EXCELLENT → fibre
  wins.

Every `pickStandouts` case asserts `length === 2` and that the two rows are distinct.

**Determinism is tested by permutation, not repetition.** "Call it twice and compare" is
vacuous — a pure synchronous function over a plain object cannot differ between calls for any
plausible implementation, so the assertion can never fail. The real risk is input **key
order** dependence (`Object.entries` over an equivalently-valued but differently-constructed
object). Supply the same logical bands in a different insertion order and assert an identical
result.

**`resolveBasis` gets its own suite.** Pin its exact signature in Architecture before writing
them — its inputs are the per-100 payload (when present), the serving _string_, and the
scale signal; `servingSizeGrams` is hook state, not a parameter. Required cases: per-100
payload present with `isBeverage: true` → drink scale; serving text `"1 can (355 mL)"` →
drink scale at 355; `"(198g/7oz)"` → food scale at 198; **serving string absent or
unparseable → `unknown`, never a 100 g default**; zero or negative quantity → `unknown`;
quantity resolved but no scale signal → `unknown`.

Include the two worked examples from "The basis problem" as named regression fixtures —
Amy's chili (680 mg / 236 g must band MEDIUM, not HIGH) and Cherry Coke (39 g / 355 ml must
band MEDIUM on the drink scale, not HIGH).

**Those fixtures do NOT protect against the defect they describe, and the spec must not
pretend otherwise.** They pass a basis in as a parameter, so a hand-built
`{ scale: "food", per100: 288 }` cannot fail when someone later wires `effectivePer100g` in
at the _call site_ — pure-function tests never execute the call site
(`docs/solutions/conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md`).
The wiring needs its own check:

**Wiring test (Slice 2c).** Render the saved-item path — `itemId` set, `nutrition` holding
per-serving values, `servingSizeGrams` null — and assert the sugar row renders **unbanded**:
no indicator, no tag. Assert on the rendered indicator and value, not the row label, since a
label-only assertion passes in every row state
(`docs/solutions/conventions/assert-source-not-label-when-fallback-shares-it-2026-07-30.md`).

**Server parity (Slice 2a) — the existing tests are NOT a sufficient gate.**
`universal-flags.test.ts` pins food sugar only at 12 (no flag) and above 22.5 (flag), so any
moved value in roughly (12, 30) passes unchanged, and **4 of the 9 shipped numbers have zero
emission coverage**: `FSA_DRINK.saturatedFat` (2.5), `FSA_DRINK.sodium` (300),
`FSA_PORTION.saturatedFat` (6), `FSA_PORTION.sodium` (720). A transposition in any of them is
invisible to "existing tests pass". Slice 2a therefore adds:

- A **literal pin** on all three objects — `expect(FSA_FOOD).toEqual({ sugar: { low: 5, high: 22.5 }, … })`
  — so a changed number fails on the number, not on a downstream behaviour that may not
  cover it.
- Emission cases for the four uncovered constants.
- A guard asserting **no `FSA_` identifier exists under `server/`** (feasible only because
  `universal-flags.ts` imports from shared directly rather than through a re-export).

**Component tests** use `renderComponent` from `test/utils/render-component`, per the
project harness. `NutritionPanel` must be asserted on all four row states — banded,
unbanded, zero, and not-recorded — with distinct assertions proving an unbanded row is not
rendered as a green LOW and a zero row is not rendered as unknown. Assert against the
rendered value and indicator, not the row label alone: a label-only assertion passes on
every state
(`docs/solutions/conventions/assert-source-not-label-when-fallback-shares-it-2026-07-30.md`).

**Known harness limits — state them, don't paper over them.** jsdom cannot observe
`accessible` subtree collapse in either direction, so no test can prove the photo-tile group
still announces once
(`docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`).
That check is device-only. Colour contrast for the new benefit-green token must be asserted
in the existing `badge-contrast` test rather than assumed.

**Announcement tests assert call count**, not just the announced string — a string-only
assertion passes when both the `NoticeStack` announcer and the acknowledge announce fire in
the same commit, which is the exact collision being guarded.

**Register `shared/lib/nutrition-bands.ts` as a mutation target.** Neither
`nutrition-flag-rules.ts` nor `universal-flags.ts` is in `stryker.targets.mjs` today, so this
logic carries no mutation gate. The likeliest defect in the new code is an
inclusive/exclusive mix-up (`≤ 5.0` vs `> 5.0`, against the server's existing strict `>`),
which coarse boundary fixtures cannot see — and this module is the right profile for it
(comparison/branching logic, not regex). Baseline with `npm run mutation:explore` before
setting a threshold.

**Device pass required before merge of 2c**, on both themes — and it is a _human_ gate, which
is why 2c's todo is `priority: high` and never auto-merges:

- Each panel row announces once, with the unit spoken as a word and the band included.
- The photo tiles still announce once each (unchanged from #742).
- The sticky bar does not occlude the last row, at **all three** `LogActionBar` heights
  (normal, gated, acknowledge) — not just the default.
- The bar's position in the VoiceOver focus order matches what Accessibility specifies.
- Nutri-Score is announced once, not twice.

## Risks

**A wrong band is worse than no band.** The highest-severity risk here, and the reason for
the `unknown` basis state. A red dot derived from a fabricated denominator is a confident
false claim about someone's food, on a screen they are using to make a decision. Mitigated
by making basis an explicit input that cannot be defaulted, by the named regression fixtures
above, and by degrading to unbanded rather than guessing. The cost — some saved items show
an unbanded panel — is accepted deliberately.

**The traffic-light panel implies medical judgement.** Mitigated by using published
regulatory thresholds (FSA front-of-pack, EU 1924/2006) rather than invented ones, and by
keeping the existing "Informational only — not medical advice" disclaimer — now rendered
once instead of twice.

**Moving `FSA_*` constants could change flag emission.** This is NOT a pure move — the band
triple changes every call site in `universal-flags.ts`. Mitigated by the literal constant
pins, the four added emission cases, and the no-`FSA_`-under-`server/` guard, all specified
in Testing. The existing emission suite alone is explicitly **not** the gate: it leaves four
shipped constants entirely uncovered and pins food sugar only outside a wide interval.

**A sticky bar can occlude content.** Mitigated by adding its height to the scroll view's
bottom inset, and by the device pass above.

**Extraction risks flag-display desync.** Mitigated by relocating flag logic without forking
it and keeping the announced-count parity tests passing — the parent spec's own mitigation,
still binding.

**Green bands could read as endorsement.** "Low in saturated fat" on a confection is true
and unhelpful. Mitigated because the summary card promotes by _standout_, not by count — a
product with nothing good to say shows no green line, only the grey fibre row.

## Deferred

- **Recipe suggestions from a scan (Phase 3).** `GET /api/recipes/search?ingredients=…`
  already exists and powers the pantry feature (`server/services/recipe-search.ts:181-227`),
  so the client call is nearly free. The hard part is the term: `scanned_items.productName`
  is a brand string ("Cherry Coke"), not an ingredient, and there is no normalized food name
  or category to join on. Shipping a strip that is empty on most scans repeats the dead-CTA
  failure. Needs its own design pass for term derivation.
- **`scanned_items` lacks saturated fat / trans fat / cholesterol / caffeine columns.**
  Adding them would let the saved-item view show a complete panel. Out of scope — it is a
  production migration, and the parent decision to keep this work client-side stands.
- **Nutri-Score is unavailable on the saved-item path** (no column, no live OFF read), so
  the summary card's grade ring is scan-path only. The card renders without it.
- **Repairing `effectivePer100g`'s `|| 100` fallback** —
  `todos/P2-2026-07-31-effective-per100g-fabricates-basis-on-saved-item-path.md`, filed
  from this design session. This spec _routes around_ the defect (`bandFor` never consumes
  `effectivePer100g`) but does not fix it. Fixing it would let saved items show bands
  instead of degrading to unbanded, which is the payoff.
  **Not** the same as `todos/P3-2026-07-30-secondary-normalization-fabricates-100g-basis.md`
  — that one is `server/services/barcode-lookup.ts:219`, a cross-validation secondary,
  and is independent. Both are instances of one defect shape; PR #740 fixed a third.
- **Restoring bands to unparseable saved items.** A saved item whose `servingSize` text does
  not parse shows an unbanded panel. Adding a numeric gram column to `scanned_items` would
  fix it permanently, but that is a production migration — see the next item.

## Open items

**Decision 8** (unbanded rows when the basis cannot be resolved) was added after the design
session, in response to the basis defect found during spec review, and is the only decision
here the user has not seen rendered. It changes what a saved item looks like — and, after the
`isBeverage` finding, what an offline-fallback scan looks like too. Stated plainly rather
than discovered on device.

Two decisions taken during the spec-review revision, both user-approved in the "apply them"
instruction, recorded here because they moved a stated boundary:

- **The barcode response gains `isBeverage`**, accepting a server-surface touch that the
  original non-goals excluded. The alternative was every product without category tags
  banding unbanded, which would have gutted the feature on the offline path.
- **2a and 2c carry `priority: high`** so auto-merge is never armed, because 2c's device pass
  is a human gate that CI cannot represent.

Two items are deliberately left for implementation to settle, and both are named in place
rather than left implicit: whether the unit-aware parser is a widened
`parseLabelServingGrams` or a sibling `parseServingBasis` (Architecture states the preference
and the constraint), and whether concern-LOW and benefit-GOOD share a green token
(Tokens states the argument against).

---

**Note on version control:** `docs/superpowers/` is gitignored in this repo
(`.gitignore:100`), so this spec is local-only and is not committed. It can be lost by a
clean checkout. The durable record of these decisions is this file plus the memory topic
`project_barcode_scan_flow_2_rework`.
