# Smart Scan — Phase 1 (Allergen Safety) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user scans a barcode, flag the product against the user's declared allergies — as calm, non-blocking badges on all three barcode surfaces — with a fail-dangerous "couldn't verify" state whenever allergen data is missing.

**Architecture:** The barcode route already fetches Open Food Facts (OFF) first. Surface OFF's `allergens_tags` + `ingredients_text` on the existing `BarcodeLookupResult` (read live, never persisted). Compute per-user allergen flags server-side in a pure module that reuses the existing allergen engine, attach them to the barcode response, and render them on the scan-lock chip, the Nutrition Detail screen, and the `returnAfterLog` confirm card.

**Tech Stack:** TypeScript (strict), Express, Zod, React Native/Expo, Vitest. Shared code in `shared/`, path aliases `@/` → `./client`, `@shared/` → `./shared`.

## Global Constraints

- **Badges only, never interrupt.** No flag may block, gate, or add an acknowledge step to the scan flow. A severe allergen is made maximally _salient_ (danger color, top position, haptic + a11y announcement), never _modal_.
- **Allergen flags fail _dangerous_.** If the user has any declared allergy and allergen data is unavailable, emit an explicit "couldn't verify" flag. Absence of data must NEVER render as silence or as a "safe" signal.
- **OFF content is read live, never persisted.** Do NOT write `ingredients_text` / `allergens_tags` to `barcodeNutrition` or any table feeding the Public API (ODbL decision).
- **Reuse the allergen engine.** Use `shared/constants/allergens.ts` (`detectAllergens`, `parseUserAllergies`); do not build a second matcher. Do NOT modify its _detection_ behavior — the gluten-grain extension is Phase 2.
- **Strict TDD.** Failing test first, minimal implementation, green, commit.
- **LSP-first** before editing any shared symbol (`docs/rules/lsp.md`).
- **Cross-platform:** iOS AND Android for every client change.
- **Out of scope (later phases):** condition→nutrient rules, FSA thresholds, `insulin_resistance`/`prediabetes`, gluten-grain engine extension, premium tiering, NOVA/ultra-processed, photo scans, batch scan.

---

## File Structure

**Create:**

- `shared/types/scan-flags.ts` — `ScanFlag` types + `pickTopSafetyFlag` (shared server+client).
- `shared/types/__tests__/scan-flags.test.ts`
- `server/services/off-allergen-tags.ts` — OFF `allergens_tags` → `AllergenId` taxonomy map.
- `server/services/__tests__/off-allergen-tags.test.ts`
- `server/services/scan-flags.ts` — `evaluateScanFlags` + `buildScanResponseFlags` + `PROFILE_UNAVAILABLE_FLAG`.
- `server/services/__tests__/scan-flags.test.ts`
- `server/services/__tests__/barcode-off-allergens.test.ts` — tests `extractOffAllergenData`.
- `client/components/ScanFlagBadge.tsx` — themed presentational badge for one `ScanFlag`.
- `client/components/__tests__/ScanFlagBadge.test.tsx`

**Modify:**

- `shared/constants/allergens.ts` — promote `normalizeAllergenId` to a public export (non-behavioral).
- `server/services/barcode-lookup.ts` — add `extractOffAllergenData`; add 3 fields to `BarcodeLookupResult`; populate on all return paths.
- `server/routes/nutrition.ts:89-120` — fail-dangerous profile fetch + attach `flags`.
- `client/camera/types/scan-phase.ts` — add `safetyFlag?` to `ProductSummary`.
- `client/screens/ScanScreen.tsx` — map flags in `fetchProductInfo`; thread flags on the `returnAfterLog` path.
- `client/camera/components/ProductChip.tsx` — render the scan-lock safety badge.
- `client/screens/ScanScreenConfirmOverlay-utils.ts` — add `safetyFlag` to `ConfirmCardState` + `buildLoadedConfirmCard`.
- `client/hooks/useNutritionLookup.ts` — carry `flags` from the server response.
- `client/screens/NutritionDetailScreen.tsx` — render a "For you" flag section.

---

## Task 1: Shared `ScanFlag` type + `pickTopSafetyFlag`

**Files:**

- Create: `shared/types/scan-flags.ts`
- Test: `shared/types/__tests__/scan-flags.test.ts`

**Interfaces:**

- Produces: `ScanFlag`, `ScanFlagKind`, `ScanFlagSeverity`, `ScanFlagTier`, `pickTopSafetyFlag(flags: ScanFlag[]): ScanFlag | undefined`.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/types/__tests__/scan-flags.test.ts
import { describe, it, expect } from "vitest";
import { pickTopSafetyFlag, type ScanFlag } from "@shared/types/scan-flags";

const flag = (over: Partial<ScanFlag>): ScanFlag => ({
  id: "x",
  kind: "allergen",
  severity: "info",
  tier: "safety",
  title: "t",
  ...over,
});

describe("pickTopSafetyFlag", () => {
  it("returns the highest-severity safety flag (danger > warn > info)", () => {
    const flags = [
      flag({ severity: "info" }),
      flag({ severity: "danger" }),
      flag({ severity: "warn" }),
    ];
    expect(pickTopSafetyFlag(flags)?.severity).toBe("danger");
  });

  it("ignores non-safety (insight) flags", () => {
    const flags = [
      flag({ severity: "danger", tier: "insight" }),
      flag({ severity: "info", tier: "safety" }),
    ];
    expect(pickTopSafetyFlag(flags)?.severity).toBe("info");
  });

  it("returns undefined when there are no safety flags", () => {
    expect(pickTopSafetyFlag([])).toBeUndefined();
    expect(pickTopSafetyFlag([flag({ tier: "insight" })])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/types/__tests__/scan-flags.test.ts`
Expected: FAIL — cannot resolve `@shared/types/scan-flags`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// shared/types/scan-flags.ts
import type { AllergenId } from "@shared/constants/allergens";

/** Phase 1 kinds. Later phases add "nutrient" | "processing". */
export type ScanFlagKind = "allergen" | "allergen-unavailable";
export type ScanFlagSeverity = "danger" | "warn" | "info";
/** "insight" is reserved for later (premium) phases; Phase 1 emits only "safety". */
export type ScanFlagTier = "safety" | "insight";

export interface ScanFlag {
  /** Stable id, e.g. "allergen:peanuts" or "allergen-unavailable". */
  id: string;
  kind: ScanFlagKind;
  severity: ScanFlagSeverity;
  tier: ScanFlagTier;
  /** Short headline, e.g. "Contains Peanuts". */
  title: string;
  /** Optional secondary line, e.g. "You listed a severe peanut allergy". */
  detail?: string;
  /** Present on positive allergen matches. */
  allergenId?: AllergenId;
}

const SEVERITY_RANK: Record<ScanFlagSeverity, number> = {
  danger: 3,
  warn: 2,
  info: 1,
};

/** Highest-severity safety flag, for the compact single-badge surfaces. */
export function pickTopSafetyFlag(flags: ScanFlag[]): ScanFlag | undefined {
  let top: ScanFlag | undefined;
  for (const f of flags) {
    if (f.tier !== "safety") continue;
    if (!top || SEVERITY_RANK[f.severity] > SEVERITY_RANK[top.severity])
      top = f;
  }
  return top;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/types/__tests__/scan-flags.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/types/scan-flags.ts shared/types/__tests__/scan-flags.test.ts
git commit -m "feat(scan-flags): add shared ScanFlag type + pickTopSafetyFlag"
```

---

## Task 2: OFF `allergens_tags` → `AllergenId` taxonomy map

**Files:**

- Create: `server/services/off-allergen-tags.ts`
- Test: `server/services/__tests__/off-allergen-tags.test.ts`

**Interfaces:**

- Consumes: `AllergenId` from `@shared/constants/allergens`.
- Produces: `mapOffAllergenTags(tags: readonly string[]): AllergenId[]`.

**Why its own unit:** OFF tags are NOT 1:1 with our 9 IDs — `en:gluten`→`wheat`, `en:crustaceans`/`en:molluscs`→`shellfish`, `en:nuts`→`tree_nuts`. A naïve map silently drops allergens, which is safety-relevant.

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/__tests__/off-allergen-tags.test.ts
import { describe, it, expect } from "vitest";
import { mapOffAllergenTags } from "../off-allergen-tags";

describe("mapOffAllergenTags", () => {
  it("maps non-obvious OFF tags to our IDs", () => {
    expect(mapOffAllergenTags(["en:gluten"])).toEqual(["wheat"]);
    expect(mapOffAllergenTags(["en:crustaceans"])).toEqual(["shellfish"]);
    expect(mapOffAllergenTags(["en:molluscs"])).toEqual(["shellfish"]);
    expect(mapOffAllergenTags(["en:nuts"])).toEqual(["tree_nuts"]);
    expect(mapOffAllergenTags(["en:peanuts"])).toEqual(["peanuts"]);
    expect(mapOffAllergenTags(["en:soybeans"])).toEqual(["soy"]);
    expect(mapOffAllergenTags(["en:sesame-seeds"])).toEqual(["sesame"]);
  });

  it("is case-insensitive and de-duplicates (crustaceans + molluscs → one shellfish)", () => {
    expect(mapOffAllergenTags(["EN:Crustaceans", "en:molluscs"])).toEqual([
      "shellfish",
    ]);
  });

  it("drops tags outside our 9-allergen model rather than guessing", () => {
    expect(mapOffAllergenTags(["en:mustard", "en:celery", "en:lupin"])).toEqual(
      [],
    );
    expect(mapOffAllergenTags(["en:milk", "en:mustard"])).toEqual(["milk"]);
  });

  it("handles empty / non-array input safely", () => {
    expect(mapOffAllergenTags([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/off-allergen-tags.test.ts`
Expected: FAIL — cannot find module `../off-allergen-tags`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/services/off-allergen-tags.ts
import type { AllergenId } from "@shared/constants/allergens";

/**
 * Open Food Facts `allergens_tags` → our canonical AllergenId.
 *
 * NOT 1:1: OFF splits shellfish into crustaceans + molluscs, calls tree nuts
 * "nuts", and tags gluten (not wheat). Tags outside our 9-allergen model
 * (mustard, celery, lupin, sulphites, …) are intentionally absent — they map to
 * nothing rather than to a wrong ID.
 */
const OFF_ALLERGEN_TAG_MAP: Record<string, AllergenId> = {
  "en:peanuts": "peanuts",
  "en:nuts": "tree_nuts",
  "en:tree-nuts": "tree_nuts",
  "en:milk": "milk",
  "en:eggs": "eggs",
  "en:gluten": "wheat",
  "en:soybeans": "soy",
  "en:soy": "soy",
  "en:fish": "fish",
  "en:crustaceans": "shellfish",
  "en:molluscs": "shellfish",
  "en:sesame-seeds": "sesame",
  "en:sesame": "sesame",
};

export function mapOffAllergenTags(tags: readonly string[]): AllergenId[] {
  if (!Array.isArray(tags)) return [];
  const out = new Set<AllergenId>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const id = OFF_ALLERGEN_TAG_MAP[tag.toLowerCase().trim()];
    if (id) out.add(id);
  }
  return [...out];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/off-allergen-tags.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/off-allergen-tags.ts server/services/__tests__/off-allergen-tags.test.ts
git commit -m "feat(scan-flags): map OFF allergen tags to canonical allergen IDs"
```

---

## Task 3: `evaluateScanFlags` + `buildScanResponseFlags` (the safety core)

**Files:**

- Modify: `shared/constants/allergens.ts` (promote `normalizeAllergenId` to a public export)
- Create: `server/services/scan-flags.ts`
- Test: `server/services/__tests__/scan-flags.test.ts`

**Interfaces:**

- Consumes: `mapOffAllergenTags` (Task 2); `ScanFlag` (Task 1); `detectAllergens`, `parseUserAllergies`, `normalizeAllergenId`, `ALLERGEN_INGREDIENT_MAP`, `AllergenId`, `AllergySeverity` from `@shared/constants/allergens`.
- Produces:
  - `interface ScanFlagProductInput { allergenTags: string[]; ingredientsText: string | null; allergenDataAvailable: boolean }`
  - `evaluateScanFlags(product: ScanFlagProductInput, allergies: { name: string; severity: AllergySeverity }[]): ScanFlag[]`
  - `type ProfileOutcome = { ok: true; allergies: { name: string; severity: AllergySeverity }[] } | { ok: false }`
  - `buildScanResponseFlags(product: ScanFlagProductInput, outcome: ProfileOutcome): ScanFlag[]`
  - `PROFILE_UNAVAILABLE_FLAG: ScanFlag`

- [ ] **Step 1: Promote `normalizeAllergenId` to a public export**

LSP-first: this is a shared symbol. Run a find-references on `normalizeAllergenId` before editing (it's currently internal + re-exported via `_testInternals`).

In `shared/constants/allergens.ts`, change the declaration `function normalizeAllergenId(` (~line 597) to `export function normalizeAllergenId(`. Leave the `_testInternals` object as-is. This is non-behavioral.

- [ ] **Step 2: Write the failing test**

```typescript
// server/services/__tests__/scan-flags.test.ts
import { describe, it, expect } from "vitest";
import {
  evaluateScanFlags,
  buildScanResponseFlags,
  PROFILE_UNAVAILABLE_FLAG,
  type ScanFlagProductInput,
} from "../scan-flags";

const withData = (
  over: Partial<ScanFlagProductInput> = {},
): ScanFlagProductInput => ({
  allergenTags: [],
  ingredientsText: null,
  allergenDataAvailable: true,
  ...over,
});
const peanutAllergy = [{ name: "peanuts", severity: "severe" as const }];

describe("evaluateScanFlags — allergen matching", () => {
  it("matches via OFF tag when ingredient text is missing", () => {
    const flags = evaluateScanFlags(
      withData({ allergenTags: ["en:peanuts"] }),
      peanutAllergy,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: "allergen",
      allergenId: "peanuts",
      severity: "danger",
      tier: "safety",
    });
    expect(flags[0].title).toContain("Peanuts");
  });

  it("matches via ingredient text when the OFF tag is missing (disagreement case)", () => {
    const flags = evaluateScanFlags(
      withData({
        allergenTags: [],
        ingredientsText: "sugar, roasted peanuts, salt",
      }),
      peanutAllergy,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0].allergenId).toBe("peanuts");
  });

  it("returns the UNION across signals and de-dups one flag per allergen", () => {
    const flags = evaluateScanFlags(
      withData({
        allergenTags: ["en:peanuts"],
        ingredientsText: "peanuts, milk",
      }),
      [
        { name: "peanuts", severity: "severe" },
        { name: "milk", severity: "mild" },
      ],
    );
    expect(flags.map((f) => f.allergenId).sort()).toEqual(["milk", "peanuts"]);
  });

  it("maps stored severity to flag severity (severe→danger, moderate→warn, mild→info)", () => {
    const sev = (s: "mild" | "moderate" | "severe") =>
      evaluateScanFlags(withData({ allergenTags: ["en:milk"] }), [
        { name: "milk", severity: s },
      ])[0].severity;
    expect(sev("severe")).toBe("danger");
    expect(sev("moderate")).toBe("warn");
    expect(sev("mild")).toBe("info");
  });

  it("emits NOTHING when the user has no allergies", () => {
    expect(
      evaluateScanFlags(withData({ allergenTags: ["en:peanuts"] }), []),
    ).toEqual([]);
  });

  it("FAIL-DANGEROUS: user has allergies but data unavailable → explicit unverified flag, no silence", () => {
    const flags = evaluateScanFlags(
      withData({ allergenDataAvailable: false }),
      peanutAllergy,
    );
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: "allergen-unavailable",
      severity: "warn",
      tier: "safety",
    });
  });

  it("does not flag allergens the user did not declare", () => {
    expect(
      evaluateScanFlags(withData({ allergenTags: ["en:milk"] }), peanutAllergy),
    ).toEqual([]);
  });
});

describe("buildScanResponseFlags — profile outcome", () => {
  it("returns PROFILE_UNAVAILABLE_FLAG when the profile read failed", () => {
    expect(buildScanResponseFlags(withData(), { ok: false })).toEqual([
      PROFILE_UNAVAILABLE_FLAG,
    ]);
  });

  it("delegates to evaluateScanFlags when the profile read succeeded", () => {
    const flags = buildScanResponseFlags(
      withData({ allergenTags: ["en:peanuts"] }),
      {
        ok: true,
        allergies: peanutAllergy,
      },
    );
    expect(flags[0].allergenId).toBe("peanuts");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/scan-flags.test.ts`
Expected: FAIL — cannot find module `../scan-flags`.

- [ ] **Step 4: Write minimal implementation**

```typescript
// server/services/scan-flags.ts
import {
  ALLERGEN_INGREDIENT_MAP,
  detectAllergens,
  normalizeAllergenId,
  type AllergenId,
  type AllergySeverity,
} from "@shared/constants/allergens";
import type { ScanFlag, ScanFlagSeverity } from "@shared/types/scan-flags";
import { mapOffAllergenTags } from "./off-allergen-tags";

export interface ScanFlagProductInput {
  /** Raw OFF allergens_tags, e.g. ["en:milk"]. */
  allergenTags: string[];
  /** Raw OFF ingredients text (any locale), or null. */
  ingredientsText: string | null;
  /** True only when the source actually returned ingredient/allergen data. */
  allergenDataAvailable: boolean;
}

const SEVERITY_TO_FLAG: Record<AllergySeverity, ScanFlagSeverity> = {
  severe: "danger",
  moderate: "warn",
  mild: "info",
};

/** Fail-dangerous flag when we have allergies but no product allergen data. */
const ALLERGEN_UNAVAILABLE_FLAG: ScanFlag = {
  id: "allergen-unavailable",
  kind: "allergen-unavailable",
  severity: "warn",
  tier: "safety",
  title: "Couldn't verify allergens",
  detail:
    "We don't have allergen data for this product — check the package label.",
};

/** Fail-dangerous flag when the user's profile couldn't be read at all. */
export const PROFILE_UNAVAILABLE_FLAG: ScanFlag = {
  id: "profile-unavailable",
  kind: "allergen-unavailable",
  severity: "warn",
  tier: "safety",
  title: "Couldn't check against your profile",
  detail:
    "We couldn't load your allergy profile just now — check the package label.",
};

/** Split OFF ingredient text into rough ingredient names for keyword matching. */
function splitIngredientsText(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/[,()[\];.]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function evaluateScanFlags(
  product: ScanFlagProductInput,
  allergies: { name: string; severity: AllergySeverity }[],
): ScanFlag[] {
  if (allergies.length === 0) return [];

  // Fail-dangerous: allergies declared but nothing to check against.
  if (!product.allergenDataAvailable) return [ALLERGEN_UNAVAILABLE_FLAG];

  // Index the user's declared allergens by canonical id → severity.
  const userSeverity = new Map<AllergenId, AllergySeverity>();
  for (const a of allergies) {
    const id = normalizeAllergenId(a.name);
    if (id) userSeverity.set(id, a.severity);
  }
  if (userSeverity.size === 0) return [];

  const matched = new Set<AllergenId>();

  // Signal (a): OFF declared allergen tags (authoritative — flag at any severity).
  for (const id of mapOffAllergenTags(product.allergenTags)) {
    if (userSeverity.has(id)) matched.add(id);
  }

  // Signal (b): ingredient-text detection (respects the engine's severity tiers).
  for (const m of detectAllergens(
    splitIngredientsText(product.ingredientsText),
    allergies,
  )) {
    matched.add(m.allergenId);
  }

  const flags: ScanFlag[] = [];
  for (const id of matched) {
    const severity = userSeverity.get(id)!;
    const label = ALLERGEN_INGREDIENT_MAP[id].label;
    flags.push({
      id: `allergen:${id}`,
      kind: "allergen",
      severity: SEVERITY_TO_FLAG[severity],
      tier: "safety",
      title: `Contains ${label}`,
      detail: `You listed a ${severity} ${label.toLowerCase()} allergy`,
      allergenId: id,
    });
  }
  return flags;
}

export type ProfileOutcome =
  | { ok: true; allergies: { name: string; severity: AllergySeverity }[] }
  | { ok: false };

export function buildScanResponseFlags(
  product: ScanFlagProductInput,
  outcome: ProfileOutcome,
): ScanFlag[] {
  if (!outcome.ok) return [PROFILE_UNAVAILABLE_FLAG];
  return evaluateScanFlags(product, outcome.allergies);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/services/__tests__/scan-flags.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add shared/constants/allergens.ts server/services/scan-flags.ts server/services/__tests__/scan-flags.test.ts
git commit -m "feat(scan-flags): evaluate per-user allergen flags with fail-dangerous states"
```

---

## Task 4: Surface OFF allergen data on `BarcodeLookupResult`

**Files:**

- Modify: `server/services/barcode-lookup.ts` (types ~22-49; `lookupBarcode` ~288+)
- Test: `server/services/__tests__/barcode-off-allergens.test.ts`

**Interfaces:**

- Produces:
  - `extractOffAllergenData(offProduct: Record<string, any> | null): { ingredientsText?: string; allergenTags: string[]; allergenDataAvailable: boolean }`
  - `BarcodeLookupResult` gains `ingredientsText?: string`, `allergenTags?: string[]`, `allergenDataAvailable: boolean`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/__tests__/barcode-off-allergens.test.ts
import { describe, it, expect } from "vitest";
import { extractOffAllergenData } from "../barcode-lookup";

describe("extractOffAllergenData", () => {
  it("extracts tags + text and marks data available on an OFF hit", () => {
    const r = extractOffAllergenData({
      allergens_tags: ["en:milk"],
      ingredients_text: "sugar, milk",
    });
    expect(r.allergenTags).toEqual(["en:milk"]);
    expect(r.ingredientsText).toBe("sugar, milk");
    expect(r.allergenDataAvailable).toBe(true);
  });

  it("prefers the English ingredients text when present", () => {
    const r = extractOffAllergenData({
      ingredients_text: "sucre, lait",
      ingredients_text_en: "sugar, milk",
    });
    expect(r.ingredientsText).toBe("sugar, milk");
  });

  it("data is UNAVAILABLE when OFF missed entirely (null product)", () => {
    const r = extractOffAllergenData(null);
    expect(r.allergenDataAvailable).toBe(false);
    expect(r.allergenTags).toEqual([]);
  });

  it("data is UNAVAILABLE when the OFF product has neither tags nor text", () => {
    const r = extractOffAllergenData({
      allergens_tags: [],
      ingredients_text: "  ",
    });
    expect(r.allergenDataAvailable).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/services/__tests__/barcode-off-allergens.test.ts`
Expected: FAIL — `extractOffAllergenData` is not exported.

- [ ] **Step 3: Add the fields to the result types**

In `server/services/barcode-lookup.ts`, extend `BarcodeLookupResult` (after `source: string;`, ~line 48):

```typescript
export interface BarcodeLookupResult {
  productName: string;
  brandName?: string;
  imageUrl?: string;
  barcode: string;
  per100g: BarcodePer100g;
  perServing: BarcodePer100g;
  servingInfo: BarcodeServingInfo;
  isServingDataTrusted: boolean;
  source: string;
  // Phase 1 (Smart Scan): OFF-derived allergen data. Read live, NEVER persisted
  // to barcodeNutrition (ODbL). allergenDataAvailable === false is the
  // fail-dangerous signal for the flag evaluator.
  ingredientsText?: string;
  allergenTags?: string[];
  allergenDataAvailable: boolean;
}
```

- [ ] **Step 4: Write the extractor**

Add near the top of `server/services/barcode-lookup.ts` (after the interfaces, before `lookupBarcode`):

```typescript
/**
 * Pull OFF allergen/ingredient content off the raw product. Pure + exported so
 * it can be unit-tested without mocking the OFF fetch. `allergenDataAvailable`
 * is true ONLY when OFF actually returned tags or ingredient text — it is the
 * fail-dangerous signal the flag evaluator keys on.
 */
export function extractOffAllergenData(
  offProduct: Record<string, any> | null,
): {
  ingredientsText?: string;
  allergenTags: string[];
  allergenDataAvailable: boolean;
} {
  const allergenTags: string[] = Array.isArray(offProduct?.allergens_tags)
    ? offProduct!.allergens_tags.filter(
        (t: unknown): t is string => typeof t === "string",
      )
    : [];
  const rawText: unknown =
    offProduct?.ingredients_text_en || offProduct?.ingredients_text;
  const ingredientsText =
    typeof rawText === "string" && rawText.trim().length > 0
      ? rawText
      : undefined;
  const allergenDataAvailable =
    offProduct != null &&
    (allergenTags.length > 0 || ingredientsText !== undefined);
  return { ingredientsText, allergenTags, allergenDataAvailable };
}
```

- [ ] **Step 5: Populate every `BarcodeLookupResult` return path**

In `lookupBarcode`, immediately after `offProduct` is resolved (after the search-term block, ~line 381), add:

```typescript
const offAllergenData = extractOffAllergenData(offProduct);
```

Then add these three fields to **every** object that the function returns as a `BarcodeLookupResult` (the OFF path and the USDA-by-UPC path — search the function for `return {` blocks building the result and for the final `return`):

```typescript
    ingredientsText: offAllergenData.ingredientsText,
    allergenTags: offAllergenData.allergenTags,
    allergenDataAvailable: offAllergenData.allergenDataAvailable,
```

(On the USDA-by-UPC path `offProduct` is null, so `allergenDataAvailable` is correctly `false`.) TypeScript will error on any return path that omits `allergenDataAvailable` (it is required) — use that to find them all.

- [ ] **Step 6: Run tests to verify they pass + type-check the returns**

Run: `npx vitest run server/services/__tests__/barcode-off-allergens.test.ts`
Expected: PASS (4 tests). Also run `npx tsc --noEmit` and confirm no "missing property allergenDataAvailable" errors remain (that means every return path was updated).

- [ ] **Step 7: Commit**

```bash
git add server/services/barcode-lookup.ts server/services/__tests__/barcode-off-allergens.test.ts
git commit -m "feat(scan-flags): surface OFF allergen data on barcode result (not persisted)"
```

---

## Task 5: Wire the barcode route — fail-dangerous profile fetch + attach flags

**Files:**

- Modify: `server/routes/nutrition.ts:89-120`

**Interfaces:**

- Consumes: `buildScanResponseFlags`, `type ProfileOutcome` (Task 3); `parseUserAllergies` (`@shared/constants/allergens`); `storage.getUserProfile` (facade, `server/storage/index.ts:63`); `req.userId` (`AuthenticatedRequest`).
- Produces: the barcode response now includes `flags: ScanFlag[]`.

- [ ] **Step 1: Add imports**

At the top of `server/routes/nutrition.ts`, add:

```typescript
import {
  buildScanResponseFlags,
  type ProfileOutcome,
} from "../services/scan-flags";
import { parseUserAllergies } from "@shared/constants/allergens";
```

- [ ] **Step 2: Replace the `Promise.all` + response block (lines ~101-115)**

```typescript
try {
  const [result, verification, profileOutcome] = await Promise.all([
    lookupBarcode(code),
    storage.getVerification(code),
    // Fail-dangerous, NOT fatal: a profile-read hiccup must never break
    // scanning. On rejection we degrade to a "couldn't check" flag — never
    // silence, never a 500 (Global Constraint: allergen flags fail-dangerous).
    storage.getUserProfile(req.userId).then(
      (profile): ProfileOutcome => ({
        ok: true,
        allergies: parseUserAllergies(profile?.allergies),
      }),
      (err): ProfileOutcome => {
        logger.warn({ err: toError(err) }, "scan-flags: profile read failed");
        return { ok: false };
      },
    ),
  ]);
  if (!result) {
    sendError(res, 404, "Product not found", ErrorCode.NOT_FOUND);
    return;
  }

  const flags = buildScanResponseFlags(
    {
      allergenTags: result.allergenTags ?? [],
      ingredientsText: result.ingredientsText ?? null,
      allergenDataAvailable: result.allergenDataAvailable,
    },
    profileOutcome,
  );

  res.json({
    ...result,
    flags,
    verificationLevel: verification?.verificationLevel ?? "unverified",
    verificationCount: verification?.verificationCount ?? 0,
  });
} catch (error) {
  handleRouteError(res, error, "look up barcode");
}
```

- [ ] **Step 3: Verify the wiring**

Run: `npx tsc --noEmit` — expect no errors.
Then exercise the route end-to-end via the **verify** skill (drive a real scan of a known-allergen barcode with a matching allergy on the test account demo/demo123). Confirm the response body includes a `flags` array and that a barcode with no OFF data yields the `allergen-unavailable` flag for an allergic user. (`req.userId` is guaranteed by `requireAuth`; no route unit test is added — the safety logic is covered by Task 3's pure tests.)

- [ ] **Step 4: Commit**

```bash
git add server/routes/nutrition.ts
git commit -m "feat(scan-flags): attach per-user allergen flags to barcode lookup response"
```

---

## Task 6: `ScanFlagBadge` component

**Files:**

- Create: `client/components/ScanFlagBadge.tsx`
- Test: `client/components/__tests__/ScanFlagBadge.test.tsx`

**Interfaces:**

- Consumes: `ScanFlag` (`@shared/types/scan-flags`).
- Produces: `<ScanFlagBadge flag={flag} />` — a themed pill (icon + title), severity-coded.

**Note on reuse:** `AllergenBadge`/`AllergenWarningBanner` were evaluated but their props key on `AllergySeverity` (mild/moderate/severe), which is not 1:1 with `ScanFlag.severity` (danger/warn/info). A thin `ScanFlagBadge` is the DRY primitive that later phases (nutrient/processing flags) also reuse. Model its styling on `AllergenBadge.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/components/__tests__/ScanFlagBadge.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
// Repo convention: renderComponent wraps RTL-for-web + QueryClient (jsdom).
// Do NOT import @testing-library/react-native — the repo does not use it.
import { renderComponent } from "../../../test/utils/render-component";
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
import type { ScanFlag } from "@shared/types/scan-flags";

const flag = (over: Partial<ScanFlag> = {}): ScanFlag => ({
  id: "allergen:peanuts",
  kind: "allergen",
  severity: "danger",
  tier: "safety",
  title: "Contains Peanuts",
  detail: "You listed a severe peanut allergy",
  ...over,
});

describe("ScanFlagBadge", () => {
  it("renders the flag title", () => {
    const { getByText } = renderComponent(<ScanFlagBadge flag={flag()} />);
    expect(getByText("Contains Peanuts")).toBeTruthy();
  });

  it("renders the warn-severity variant title too", () => {
    const { getByText } = renderComponent(
      <ScanFlagBadge
        flag={flag({ severity: "warn", title: "Couldn't verify allergens" })}
      />,
    );
    expect(getByText("Couldn't verify allergens")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/components/__tests__/ScanFlagBadge.test.tsx`
Expected: FAIL — cannot resolve `@/components/ScanFlagBadge`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// client/components/ScanFlagBadge.tsx
import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  withOpacity,
  MAX_FONT_SCALE_CONSTRAINED,
} from "@/constants/theme";
import type { ScanFlag, ScanFlagSeverity } from "@shared/types/scan-flags";

const ICON: Record<
  ScanFlagSeverity,
  "alert-triangle" | "alert-circle" | "info"
> = {
  danger: "alert-triangle",
  warn: "alert-circle",
  info: "info",
};

/** Severity-coded pill for a single ScanFlag. */
export const ScanFlagBadge = React.memo(function ScanFlagBadge({
  flag,
}: {
  flag: ScanFlag;
}) {
  const { theme } = useTheme();
  const color =
    flag.severity === "danger"
      ? theme.error
      : flag.severity === "warn"
        ? theme.warning
        : theme.info;
  const a11y = flag.detail ? `${flag.title}. ${flag.detail}` : flag.title;

  return (
    <View
      style={[styles.badge, { backgroundColor: withOpacity(color, 0.1) }]}
      accessibilityLabel={a11y}
      accessibilityRole="text"
    >
      <Feather
        name={ICON[flag.severity]}
        size={14}
        color={color}
        accessible={false}
      />
      <ThemedText
        type="caption"
        maxScale={MAX_FONT_SCALE_CONSTRAINED}
        style={{ color, marginLeft: Spacing.xs, fontWeight: "600" }}
      >
        {flag.title}
      </ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    alignSelf: "flex-start",
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/components/__tests__/ScanFlagBadge.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add client/components/ScanFlagBadge.tsx client/components/__tests__/ScanFlagBadge.test.tsx
git commit -m "feat(scan-flags): add ScanFlagBadge presentational component"
```

---

## Task 7: Nutrition Detail "For you" section

**Files:**

- Modify: `client/hooks/useNutritionLookup.ts` (interface ~35-49; server branch ~229-247; return ~500-529)
- Modify: `client/screens/NutritionDetailScreen.tsx` (destructure the hook; render section ~before line 502)

**Interfaces:**

- Consumes: `flags` from the barcode response (Task 5); `ScanFlagBadge` (Task 6); `pickTopSafetyFlag` is not needed here (render all flags).
- Produces: `useNutritionLookup` returns `flags: ScanFlag[]`.

- [ ] **Step 1: Add `flags` state to the hook**

In `client/hooks/useNutritionLookup.ts`:

Add the import:

```typescript
import type { ScanFlag } from "@shared/types/scan-flags";
```

Add state near the other `useState` calls (~line 64):

```typescript
const [flags, setFlags] = useState<ScanFlag[]>([]);
```

In the server-response branch, right after `setNutrition({ ... })` (~line 242), add:

```typescript
setFlags(Array.isArray(data.flags) ? (data.flags as ScanFlag[]) : []);
```

Add `flags` to the returned object (~line 500):

```typescript
    flags,
```

> Note: the direct-OFF fallback path (server unreachable, ~line 289-321) leaves `flags` as `[]`. This is a pre-existing rare degradation (server down), documented in the spec's risks; Phase 1 does not compute client-side flags. Do not add flag logic to that branch.

- [ ] **Step 2: Write the failing test (hook mapping via a small util is overkill — assert through the screen)**

Add to a new screen-utils test if the screen has extractable logic; otherwise cover via a hook test that mocks `fetch`. Minimal hook-level assertion:

```tsx
// client/hooks/__tests__/useNutritionLookup.flags.test.tsx
// Follow the EXISTING useNutritionLookup test setup (renderHook comes from
// @testing-library/react in this repo, wrapped with the QueryClient provider —
// mirror a sibling hook test; do NOT import @testing-library/react-native).
// Mock the barcode fetch to return { productName, per100g, perServing, servingInfo,
// isServingDataTrusted, flags: [{ id:"allergen:peanuts", kind:"allergen",
// severity:"danger", tier:"safety", title:"Contains Peanuts" }] } and assert
// result.current.flags[0].title === "Contains Peanuts".
```

If the existing test harness for this hook is not readily reusable, SKIP the hook unit test and rely on the ScanFlagBadge test (Task 6) + the Task 5 end-to-end verify. Do not block the task on harness plumbing.

- [ ] **Step 3: Render the "For you" section**

In `client/screens/NutritionDetailScreen.tsx`, add `flags` to the `useNutritionLookup(...)` destructure. Add the import:

```tsx
import { ScanFlagBadge } from "@/components/ScanFlagBadge";
```

Insert this block **above the hero calorie/macro `Card`** — immediately after the product image + name/brand/serving header block — so allergen-safety flags sit near the top per the spec, no scroll required. If that header block isn't cleanly identifiable, the fallback anchor is immediately BEFORE the `{isPer100g && !itemId ? (` block (~line 502, directly under the macro card). **Prefer the higher placement** for a safety surface:

```tsx
{
  flags.length > 0 ? (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInUp.delay(450).duration(400)}
      style={styles.additionalNutrients}
    >
      <ThemedText type="h4" style={styles.sectionTitle}>
        For you
      </ThemedText>
      <View style={{ gap: Spacing.sm }}>
        {flags.map((f) => (
          <ScanFlagBadge key={f.id} flag={f} />
        ))}
      </View>
      <ThemedText
        type="caption"
        style={{ color: theme.textSecondary, marginTop: Spacing.xs }}
      >
        Informational only — not medical advice.
      </ThemedText>
    </Animated.View>
  ) : null;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run client/components/__tests__/ScanFlagBadge.test.tsx` (regression) and `npx tsc --noEmit`.
Then use the **verify-ui** skill: deep-link `ocrecipes://nutrition/<known-allergen-barcode>` on the demo account with a matching allergy and confirm the "For you" section renders the badge and the disclaimer.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useNutritionLookup.ts client/screens/NutritionDetailScreen.tsx client/hooks/__tests__/useNutritionLookup.flags.test.tsx
git commit -m "feat(scan-flags): render For You allergen flags on Nutrition Detail"
```

---

## Task 8: Scan-lock badge on `ProductChip`

**Files:**

- Modify: `client/camera/types/scan-phase.ts` (`ProductSummary`, ~line 4-8)
- Modify: `client/screens/ScanScreen.tsx` (`fetchProductInfo`, ~line 293-309)
- Modify: `client/camera/components/ProductChip.tsx` (product row, ~line 177-192)

**Interfaces:**

- Consumes: `ScanFlag` (`@shared/types/scan-flags`), `pickTopSafetyFlag` (Task 1).
- Produces: `ProductSummary` gains `safetyFlag?: ScanFlag`.

- [ ] **Step 1: Extend `ProductSummary`**

In `client/camera/types/scan-phase.ts`:

```typescript
import type { ScanFlag } from "@shared/types/scan-flags";

export interface ProductSummary {
  name: string;
  brand?: string;
  imageUri?: string;
  /** Top safety flag for the scan-lock chip (highest severity), if any. */
  safetyFlag?: ScanFlag;
}
```

- [ ] **Step 2: Populate it in `fetchProductInfo`**

In `client/screens/ScanScreen.tsx`, add the import:

```typescript
import { pickTopSafetyFlag } from "@shared/types/scan-flags";
```

Update the dispatch in `fetchProductInfo` (~line 297-304):

```typescript
dispatch({
  type: "PRODUCT_LOADED",
  product: {
    name: data.productName ?? "Unknown product",
    brand: data.brandName ?? undefined,
    imageUri: data.imageUrl ?? undefined,
    safetyFlag: pickTopSafetyFlag(Array.isArray(data.flags) ? data.flags : []),
  },
});
```

- [ ] **Step 3: Write the failing test (chip render)**

```tsx
// client/camera/components/__tests__/ProductChip.safetyFlag.test.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { renderComponent } from "../../../../test/utils/render-component";
import { ProductChip } from "@/camera/components/ProductChip";
import type { ScanPhase } from "@/camera/types/scan-phase";

// ProductChip uses react-native-reanimated / safe-area / vector-icons — covered
// by the repo's global vitest setup mocks (see other camera component tests). If
// reanimated makes this render flaky, extract the badge text into a
// ProductChip-utils helper and unit-test that instead.

const noop = () => {};
const lockedPhase = (safetyFlag?: any): ScanPhase => ({
  type: "BARCODE_LOCKED",
  barcode: "12345",
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  product: { name: "Trail Mix", safetyFlag },
});

describe("ProductChip safety flag", () => {
  it("renders the top safety flag on the locked chip", () => {
    const { getByText } = renderComponent(
      <ProductChip
        phase={lockedPhase({
          id: "allergen:tree_nuts",
          kind: "allergen",
          severity: "danger",
          tier: "safety",
          title: "Contains Tree Nuts",
        })}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    // The chip renders "⚠ {title}".
    expect(getByText("⚠ Contains Tree Nuts")).toBeTruthy();
  });

  it("renders no flag row when there is no safety flag", () => {
    const { queryByText } = renderComponent(
      <ProductChip
        phase={lockedPhase(undefined)}
        onConfirm={noop}
        onStepConfirmed={noop}
        onEditStep2={noop}
        onEditStep3={noop}
        onSmartPhotoConfirm={noop}
        onRetry={noop}
      />,
    );
    expect(queryByText(/Contains/)).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run client/camera/components/__tests__/ProductChip.safetyFlag.test.tsx`
Expected: FAIL — the flag text is not rendered yet.

- [ ] **Step 5: Render the badge in `ProductChip`**

The chip is a dark camera overlay with hardcoded colors, so render a compact inline badge (do NOT reuse the themed `ScanFlagBadge` here — it would clash with the overlay palette). `styles.productRow` is `flexDirection: "row"`, so the badge must **NOT** go inside it (it would render squished to the right of the name). Add it as a **sibling of the product row — the FIRST child of the outer `Animated.View`**, immediately ABOVE the `{/* Product info row */}` block (`styles.chip` is a column, so this becomes a full-width, top-anchored banner):

```tsx
{
  /* Safety flag row (badges only — never blocks the flow) */
}
{
  product?.safetyFlag ? (
    <View
      style={[
        styles.safetyFlag,
        {
          backgroundColor:
            product.safetyFlag.severity === "danger"
              ? "rgba(229,72,77,0.22)"
              : "rgba(240,171,58,0.20)",
        },
      ]}
      accessibilityLiveRegion="assertive"
      accessibilityRole="text"
      accessibilityLabel={
        product.safetyFlag.detail
          ? `${product.safetyFlag.title}. ${product.safetyFlag.detail}`
          : product.safetyFlag.title
      }
    >
      <Text style={styles.safetyFlagText}>⚠ {product.safetyFlag.title}</Text>
    </View>
  ) : null;
}
```

Add styles to the `StyleSheet.create` block:

```tsx
  safetyFlag: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 6,
  },
  safetyFlagText: {
    color: "#FFF", // hardcoded — camera overlay
    fontSize: 13,
    fontWeight: "700",
  },
```

Also add a haptic on a severe flag. In `ScanScreen.tsx`, where `PRODUCT_LOADED` is dispatched, if `safetyFlag?.severity === "danger"`, fire `haptics.notification(Haptics.NotificationFeedbackType.Warning)` (use the existing haptics hook already imported in ScanScreen; if not present, import `useHaptics`). This raises salience WITHOUT blocking (Global Constraint).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run client/camera/components/__tests__/ProductChip.safetyFlag.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add client/camera/types/scan-phase.ts client/screens/ScanScreen.tsx client/camera/components/ProductChip.tsx client/camera/components/__tests__/ProductChip.safetyFlag.test.tsx
git commit -m "feat(scan-flags): show top safety flag on the scan-lock chip"
```

---

## Task 9: `returnAfterLog` confirm-card badge (the log-without-detail path)

**Files:**

- Modify: `client/screens/ScanScreenConfirmOverlay-utils.ts` (`ConfirmCardState`, `buildLoadedConfirmCard`)
- Modify: `client/screens/ScanScreen.tsx` (returnAfterLog fetch ~218-224; confirm overlay JSX ~784-917)

**Interfaces:**

- Consumes: `ScanFlag`, `pickTopSafetyFlag` (Task 1).
- Produces: `ConfirmCardState` gains `safetyFlag?: ScanFlag`.

**Why this task matters:** this path POSTs to `/api/scanned-items` and NEVER opens the detail screen — so without this, a severe-allergen item can be logged with no warning, violating the fail-dangerous invariant.

- [ ] **Step 1: Write the failing test**

```typescript
// client/screens/__tests__/ScanScreenConfirmOverlay-utils.flags.test.ts
import { describe, it, expect } from "vitest";
import { buildLoadedConfirmCard } from "@/screens/ScanScreenConfirmOverlay-utils";

describe("buildLoadedConfirmCard — safety flag", () => {
  it("carries the top safety flag from the response onto the card", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Trail Mix",
      calories: 210,
      flags: [
        {
          id: "allergen:tree_nuts",
          kind: "allergen",
          severity: "danger",
          tier: "safety",
          title: "Contains Tree Nuts",
        },
      ],
    });
    expect(card.safetyFlag?.title).toBe("Contains Tree Nuts");
  });

  it("leaves safetyFlag undefined when there are no flags", () => {
    const card = buildLoadedConfirmCard("12345", {
      productName: "Water",
      calories: 0,
    });
    expect(card.safetyFlag).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "client/screens/__tests__/ScanScreenConfirmOverlay-utils.flags.test.ts"`
Expected: FAIL — `buildLoadedConfirmCard` doesn't accept/return `flags`/`safetyFlag`.

- [ ] **Step 3: Extend the type + builder**

In `client/screens/ScanScreenConfirmOverlay-utils.ts`:

Add the import and extend `ConfirmCardState` and the `buildLoadedConfirmCard` data param:

```typescript
import type { ScanFlag } from "@shared/types/scan-flags";
import { pickTopSafetyFlag } from "@shared/types/scan-flags";
```

Add to `ConfirmCardState`:

```typescript
  safetyFlag?: ScanFlag;
```

Update `buildLoadedConfirmCard` signature + body:

```typescript
export function buildLoadedConfirmCard(
  barcode: string,
  data: { productName?: string; calories?: number; flags?: ScanFlag[] },
): ConfirmCardState {
  return {
    // ...existing fields (barcode, name, calories, isLoading:false, etc.)...
    safetyFlag: pickTopSafetyFlag(Array.isArray(data.flags) ? data.flags : []),
  };
}
```

(Keep every existing field; only add `safetyFlag`.)

- [ ] **Step 4: Thread `flags` through the fetch**

In `client/screens/ScanScreen.tsx`, widen the response type on the returnAfterLog fetch (~line 222):

```typescript
        .then((data: { productName?: string; calories?: number; flags?: ScanFlag[] }) => {
          setConfirmCard(buildLoadedConfirmCard(barcode, data));
        })
```

Add the import if not already present:

```typescript
import type { ScanFlag } from "@shared/types/scan-flags";
```

- [ ] **Step 5: Render the badge in the confirm overlay**

In the confirm-overlay JSX (~line 784-917), locate the "Log It" `TouchableOpacity`. Immediately ABOVE it, add:

```tsx
{
  confirmCard.safetyFlag ? (
    <View
      style={[
        styles.confirmSafetyFlag,
        {
          backgroundColor: withOpacity(
            confirmCard.safetyFlag.severity === "danger"
              ? theme.error
              : theme.warning,
            0.12,
          ),
        },
      ]}
      accessibilityRole="text"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={
        confirmCard.safetyFlag.detail
          ? `${confirmCard.safetyFlag.title}. ${confirmCard.safetyFlag.detail}`
          : confirmCard.safetyFlag.title
      }
    >
      <Feather
        name="alert-triangle"
        size={16}
        color={
          confirmCard.safetyFlag.severity === "danger"
            ? theme.error
            : theme.warning
        }
      />
      <ThemedText
        type="small"
        style={{
          marginLeft: Spacing.sm,
          fontWeight: "700",
          color:
            confirmCard.safetyFlag.severity === "danger"
              ? theme.error
              : theme.warning,
        }}
      >
        {confirmCard.safetyFlag.title}
      </ThemedText>
    </View>
  ) : null;
}
```

Add the matching style to the ScanScreen `StyleSheet` (confirm section):

```tsx
  confirmSafetyFlag: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
```

(Confirm `withOpacity`, `theme`, `Feather`, `ThemedText`, `Spacing`, `BorderRadius` are already imported in ScanScreen; add any that are missing.) The card still logs freely — the badge never disables "Log It" (Global Constraint: badges only).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run "client/screens/__tests__/ScanScreenConfirmOverlay-utils.flags.test.ts"`
Expected: PASS (2 tests). Then `npx tsc --noEmit`.

- [ ] **Step 7: Verify end-to-end**

Use the **verify** skill on the `returnAfterLog` path (scan → the inline confirm card) with a matching allergy: confirm the safety badge shows above "Log It" and that logging still succeeds without any blocking step.

- [ ] **Step 8: Commit**

```bash
git add client/screens/ScanScreenConfirmOverlay-utils.ts client/screens/ScanScreen.tsx "client/screens/__tests__/ScanScreenConfirmOverlay-utils.flags.test.ts"
git commit -m "feat(scan-flags): show safety flag on the returnAfterLog confirm card"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**

- OFF field extraction + `allergenDataAvailable` → Task 4. Not persisted → Task 4 (live extractor, no cache write). ✓
- OFF tag taxonomy (not 1:1) tested unit → Task 2. ✓
- Pure `evaluateScanFlags` reusing the engine, severity-inherited, fail-dangerous unverified → Task 3. ✓
- Route: profile via fail-dangerous (allSettled-equivalent `.then(ok, fail)`), never 500, attach flags → Task 5. ✓
- Three surfaces: chip (Task 8), detail (Task 7), returnAfterLog confirm card (Task 9). ✓
- Severe allergen = salient badge + haptic + a11y announcement, never interrupt → Tasks 8 & 9 (assertive live region, warning haptic). ✓
- Union/disagreement test → Task 3. ✓

**Out-of-scope kept out:** no condition rules, thresholds, new conditions, gluten-grain extension, premium tiering, NOVA, photo/batch. ✓

**Type consistency:** `ScanFlag` (Task 1) is the single shape used by Tasks 3/5/6/7/8/9; `ScanFlagProductInput`/`ProfileOutcome` (Task 3) are consumed only by Task 5; `pickTopSafetyFlag` (Task 1) used by Tasks 8/9; `safetyFlag?` field name identical in `ProductSummary` (Task 8) and `ConfirmCardState` (Task 9). ✓

**Known documented gap:** the client-side direct-OFF fallback (server unreachable) renders no flags — pre-existing rare degradation, noted in Task 7 and the spec risks; not silently introduced.
