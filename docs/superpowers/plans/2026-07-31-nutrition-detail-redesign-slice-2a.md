# Nutrition Detail Redesign — Slice 2a (Bands & Basis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure band/basis layer that a redesigned Nutrition Detail screen will render — FSA traffic-light bands, EU benefit claims, and a basis resolver that refuses to guess — without changing a single pixel.

**Architecture:** Thresholds and pure functions move to `shared/` so the Express server and the React Native client compute bands from one source. The server's existing flag emission is repointed at the shared constants (a call-site shape change, not a behaviour change). The barcode response gains one derived scalar, `isBeverage`, because the raw category tags it is derived from are ODbL-licensed and must never reach the client.

**Tech Stack:** TypeScript (strict), Vitest, Express, Drizzle. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-nutrition-detail-redesign-design.md` — the binding contract. It has been through `/spec-review`; all findings are applied. Read its "The basis problem", "Thresholds — exact values", "The standout rule" and "Safety invariants" sections before starting.

## Global Constraints

- **A band is never computed from an unverified denominator.** An unresolvable basis yields `unknown`, which renders unbanded. This outranks completeness of the panel.
- **Nutrient flags fail toward under-warning.** Where a choice exists, prefer showing less over inventing a red.
- **Three states stay distinct**: a zero value, a value with no applicable standard, and no value at all. Never collapse any two.
- **OFF content is read live and never persisted, and raw OFF fields never reach the client.** `isBeverage` is a derived classification, not OFF content. This must not become a precedent for forwarding the tags themselves.
- **No existing flag changes its emission condition.** The shape of the constants changes; what the server emits does not.
- **After this slice, zero `FSA_` identifiers exist under `server/`.** No re-exports.
- **`client/camera/` is off-limits.** So is the three-valued `ocrText` contract.
- Sodium is stored in **mg**, pre-converted from FSA salt figures at salt (g) × 400. Do not re-derive salt or re-convert sodium anywhere. Sodium LOW is 120 mg on **both** bases — that asymmetry is correct FSA.
- `FSA_PORTION` is **red-only** and has **no `fat` key**. The per-portion override does not apply to total fat.
- Strict TDD: failing test first. CI is the source of truth for the full gate.
- This todo carries `priority: high` so `scripts/todo-automerge-guard.sh` never arms auto-merge.

---

## File Structure

| File                                                 | Responsibility                                                                                             | Task    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------- |
| `shared/constants/nutrition-bands.ts`                | **Create.** All threshold numbers, plus `isBeverageCategory` / `BEVERAGE_PARENT`. Data only, one function. | 1       |
| `shared/constants/__tests__/nutrition-bands.test.ts` | **Create.** Literal pins on every constant.                                                                | 1       |
| `server/services/nutrition-flag-rules.ts`            | **Modify.** Loses `FSA_*`, `isBeverageCategory`, `BEVERAGE_PARENT`. Keeps caffeine/sweetener rules.        | 2       |
| `server/services/universal-flags.ts`                 | **Modify.** Imports from shared; three `per100.X` reads gain `.high`.                                      | 2       |
| `server/services/__tests__/universal-flags.test.ts`  | **Modify.** Four missing emission cases.                                                                   | 2       |
| `shared/lib/label-serving.ts`                        | **Modify.** Gains `parseServingBasis` (unit-aware sibling). `parseLabelServingGrams` untouched.            | 3       |
| `server/routes/nutrition.ts`                         | **Modify.** Response gains `isBeverage: boolean`.                                                          | 4       |
| `shared/lib/nutrition-bands.ts`                      | **Create.** `bandFor`, `resolveBasis`, `pickStandouts`. Pure.                                              | 5, 6, 7 |
| `shared/lib/__tests__/nutrition-bands.test.ts`       | **Create.** Boundary, basis and standout suites.                                                           | 5, 6, 7 |
| `client/hooks/useNutritionLookup.ts`                 | **Modify.** Reads `isBeverage` through a boundary check; exposes it.                                       | 8       |
| `stryker.targets.mjs`                                | **Modify.** Register `shared/lib/nutrition-bands.ts`.                                                      | 7       |

**Why `shared/lib/` and `shared/constants/`:** these mirror the existing split — `shared/constants/allergens.ts` holds data, `shared/lib/label-serving.ts` holds pure functions. Nothing new is invented.

---

### Task 1: Shared threshold constants

**Files:**

- Create: `shared/constants/nutrition-bands.ts`
- Test: `shared/constants/__tests__/nutrition-bands.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `FSA_FOOD`, `FSA_DRINK` (band triples), `FSA_PORTION` (flat, red-only), `FIBRE_CLAIM`, `PROTEIN_ENERGY_CLAIM`, `BEVERAGE_PARENT`, `isBeverageCategory(tags: string[]): boolean`.

Nothing imports this yet — that is Task 2. This task exists separately so the numbers land under their own literal pins before any call site depends on them.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/constants/__tests__/nutrition-bands.test.ts
import { describe, it, expect } from "vitest";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  FIBRE_CLAIM,
  PROTEIN_ENERGY_CLAIM,
  BEVERAGE_PARENT,
  isBeverageCategory,
} from "../nutrition-bands";

// These are LITERAL pins, deliberately. A downstream behaviour test cannot
// catch a transposed threshold that stays inside its own band's interval —
// the existing universal-flags suite pins food sugar only outside (12, 30).
describe("FSA concern thresholds", () => {
  it("pins the per-100g food bands", () => {
    expect(FSA_FOOD).toEqual({
      sugar: { low: 5.0, high: 22.5 },
      saturatedFat: { low: 1.5, high: 5.0 },
      fat: { low: 3.0, high: 17.5 },
      sodium: { low: 120, high: 600 },
    });
  });

  it("pins the per-100ml drink bands", () => {
    expect(FSA_DRINK).toEqual({
      sugar: { low: 2.5, high: 11.25 },
      saturatedFat: { low: 0.75, high: 2.5 },
      fat: { low: 1.5, high: 8.75 },
      sodium: { low: 120, high: 300 },
    });
  });

  it("keeps sodium LOW identical on both bases", () => {
    // FSA salt LOW is 0.3 g/100 for food AND drink; only HIGH differs
    // (1.5 g vs 0.75 g). Not a copy-paste slip — do not "fix" it.
    expect(FSA_DRINK.sodium.low).toBe(FSA_FOOD.sodium.low);
    expect(FSA_DRINK.sodium.high).not.toBe(FSA_FOOD.sodium.high);
  });

  it("keeps FSA_PORTION red-only and fat-free", () => {
    expect(FSA_PORTION).toEqual({ sugar: 27, saturatedFat: 6, sodium: 720 });
    expect("fat" in FSA_PORTION).toBe(false);
  });

  it("preserves the shipped HIGH values exactly", () => {
    // These three moved from server/services/nutrition-flag-rules.ts and
    // must not drift — they decide live flag emission.
    expect(FSA_FOOD.sugar.high).toBe(22.5);
    expect(FSA_FOOD.saturatedFat.high).toBe(5.0);
    expect(FSA_FOOD.sodium.high).toBe(600);
    expect(FSA_DRINK.sugar.high).toBe(11.25);
    expect(FSA_DRINK.saturatedFat.high).toBe(2.5);
    expect(FSA_DRINK.sodium.high).toBe(300);
  });
});

describe("benefit claim thresholds", () => {
  it("pins EU 1924/2006 fibre thresholds per 100g", () => {
    expect(FIBRE_CLAIM).toEqual({ good: 3, excellent: 6 });
  });

  it("pins protein claims as a fraction of energy", () => {
    expect(PROTEIN_ENERGY_CLAIM).toEqual({ good: 0.12, excellent: 0.2 });
  });
});

describe("isBeverageCategory", () => {
  it("matches on the parent tag", () => {
    expect(isBeverageCategory(["en:beverages", "en:colas"])).toBe(true);
  });

  it("tolerates polluted leaf tags without the parent", () => {
    expect(isBeverageCategory(["en:carbonated-drinks"])).toBe(false);
  });

  it("returns false for an empty tag list", () => {
    expect(isBeverageCategory([])).toBe(false);
  });

  it("exports the parent tag it matches on", () => {
    expect(BEVERAGE_PARENT).toBe("en:beverages");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/constants/__tests__/nutrition-bands.test.ts`
Expected: FAIL — `Failed to resolve import "../nutrition-bands"`

- [ ] **Step 3: Write the implementation**

```typescript
// shared/constants/nutrition-bands.ts
/**
 * Nutrient band thresholds, shared by the server's flag emission and the
 * client's traffic-light panel. ONE set of numbers — a client-side copy is
 * how display and emission desync, which this repo has already been bitten by.
 *
 * SOURCES — check the numbers against these, not against this file:
 * - Concern bands: UK FSA front-of-pack nutrition labelling guidance (the
 *   red/amber/green criteria). LOW and MEDIUM are per 100 g / 100 ml; the
 *   HIGH band additionally uses a per-portion override for portions over
 *   100 g/ml, which is why FSA_PORTION is red-only.
 * - Benefit bands: EU Regulation 1924/2006, Annex (nutrition claims) —
 *   "source of fibre" / "high fibre", "source of protein" / "high protein".
 *
 * SODIUM IS IN MILLIGRAMS, pre-converted from the FSA's salt figures at
 * salt (g) x 400. Do NOT re-derive salt or re-convert sodium downstream
 * (single-conversion rule).
 */

/** A concern nutrient's two band boundaries. MEDIUM is the open interval between them. */
export interface ConcernBandLimits {
  /** At or below this value the nutrient is LOW (green). */
  low: number;
  /** Above this value the nutrient is HIGH (red). */
  high: number;
}

/** Per 100 g. */
export const FSA_FOOD = {
  sugar: { low: 5.0, high: 22.5 },
  saturatedFat: { low: 1.5, high: 5.0 },
  fat: { low: 3.0, high: 17.5 },
  sodium: { low: 120, high: 600 },
} as const satisfies Record<string, ConcernBandLimits>;

/** Per 100 ml. */
export const FSA_DRINK = {
  sugar: { low: 2.5, high: 11.25 },
  saturatedFat: { low: 0.75, high: 2.5 },
  fat: { low: 1.5, high: 8.75 },
  sodium: { low: 120, high: 300 },
} as const satisfies Record<string, ConcernBandLimits>;

/**
 * Per portion, for portions over 100 g/ml. RED-ONLY by FSA design — there is
 * no published green band for portions, and no total-fat figure. Inventing
 * either would make it our number rather than theirs.
 */
export const FSA_PORTION = {
  sugar: 27,
  saturatedFat: 6,
  sodium: 720,
} as const;

/** Grams of fibre per 100 g. */
export const FIBRE_CLAIM = { good: 3, excellent: 6 } as const;

/** Protein energy as a fraction of total energy (protein_g * 4 / kcal). */
export const PROTEIN_ENERGY_CLAIM = { good: 0.12, excellent: 0.2 } as const;

export const BEVERAGE_PARENT = "en:beverages";

/** Beverage iff the en:beverages PARENT is present (tolerates polluted leaf tags). */
export function isBeverageCategory(tags: string[]): boolean {
  return tags.includes(BEVERAGE_PARENT);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/constants/__tests__/nutrition-bands.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add shared/constants/nutrition-bands.ts shared/constants/__tests__/nutrition-bands.test.ts
git commit -m "feat(nutrition): add shared FSA band + benefit-claim thresholds"
```

---

### Task 2: Repoint the server at the shared constants

**Files:**

- Modify: `server/services/nutrition-flag-rules.ts` (delete lines 1-6 and 41-44)
- Modify: `server/services/universal-flags.ts:1-12, 71, 96, 101, 108`
- Modify: `server/services/__tests__/universal-flags.test.ts`
- Test: `server/services/__tests__/no-server-fsa-constants.test.ts` (create)

**Interfaces:**

- Consumes: Task 1's `FSA_FOOD`, `FSA_DRINK`, `FSA_PORTION`, `isBeverageCategory`.
- Produces: nothing new. `evaluateUniversalFlags` keeps its exact signature and behaviour.

**This is the highest-risk task in the slice** — it touches live flag emission. The existing suite is NOT a sufficient gate: it pins food sugar only at 12 and above 22.5, so any moved value in roughly (12, 30) passes, and four shipped constants have zero emission coverage.

- [ ] **Step 1: Write the four missing emission tests**

Add to `server/services/__tests__/universal-flags.test.ts`. Match the file's existing fixture-building style; the inputs below name only the fields each assertion needs.

```typescript
describe("emission coverage for previously-unpinned constants", () => {
  // FSA_DRINK.saturatedFat = 2.5 (per 100ml)
  it("flags a drink over the saturated-fat line", () => {
    const flags = evaluateUniversalFlags({
      per100g: { saturatedFat: 2.6 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:saturated_fat");
  });

  it("does not flag a drink at or below the saturated-fat line", () => {
    const flags = evaluateUniversalFlags({
      per100g: { saturatedFat: 2.5 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).not.toContain("nutrient:saturated_fat");
  });

  // FSA_DRINK.sodium = 300 (mg per 100ml)
  it("flags a drink over the sodium line", () => {
    const flags = evaluateUniversalFlags({
      per100g: { sodium: 301 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:sodium");
  });

  it("does not flag a drink at the sodium line", () => {
    const flags = evaluateUniversalFlags({
      per100g: { sodium: 300 },
      categoriesTags: ["en:beverages"],
    });
    expect(flags.map((f) => f.id)).not.toContain("nutrient:sodium");
  });

  // FSA_PORTION.saturatedFat = 6, only applies when servingGrams > 100
  it("flags saturated fat via the per-portion override", () => {
    const flags = evaluateUniversalFlags({
      per100g: { saturatedFat: 1.0 }, // under the per-100 line
      perServing: { saturatedFat: 6.1 },
      servingGrams: 240,
      categoriesTags: [],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:saturated_fat");
  });

  // FSA_PORTION.sodium = 720
  it("flags sodium via the per-portion override", () => {
    const flags = evaluateUniversalFlags({
      per100g: { sodium: 100 }, // under the per-100 line
      perServing: { sodium: 721 },
      servingGrams: 240,
      categoriesTags: [],
    });
    expect(flags.map((f) => f.id)).toContain("nutrient:sodium");
  });

  it("ignores the per-portion override for servings at or under 100g", () => {
    const flags = evaluateUniversalFlags({
      per100g: { sodium: 100 },
      perServing: { sodium: 721 },
      servingGrams: 100,
      categoriesTags: [],
    });
    expect(flags.map((f) => f.id)).not.toContain("nutrient:sodium");
  });
});
```

- [ ] **Step 2: Run them against the CURRENT code to verify they pass**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts`
Expected: PASS — these describe behaviour that already exists. This is the inverse of normal TDD and it is deliberate: they are a **characterisation** net cast before the refactor, so a behaviour change in Step 4 fails loudly.

- [ ] **Step 3: Commit the net before moving anything**

```bash
git add server/services/__tests__/universal-flags.test.ts
git commit -m "test(nutrition): pin the four uncovered FSA emission thresholds"
```

- [ ] **Step 4: Move the constants and update the call sites**

In `server/services/nutrition-flag-rules.ts`, **delete** the `FSA_FOOD` / `FSA_DRINK` / `FSA_PORTION` declarations (lines 1-6, including the leading comment block, which moves to the shared file) and the `BEVERAGE_PARENT` constant plus `isBeverageCategory` (lines 10, 41-44). Keep everything caffeine- and sweetener-related. **Do not add a re-export** — that would leave `FSA_` identifiers under `server/` and defeat Step 6's guard.

In `server/services/universal-flags.ts`, change the import block at lines 1-12:

```typescript
import type { ScanFlag } from "@shared/types/scan-flags";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  isBeverageCategory,
} from "@shared/constants/nutrition-bands";
import {
  CAFFEINE_HIGH_MG,
  CAFFEINE_CATEGORY_TAGS,
  CAFFEINE_INGREDIENT_RE,
  CAFFEINE_FREE_RE,
  ARTIFICIAL_SWEETENER_ETAGS,
} from "./nutrition-flag-rules";
```

Then three call sites gain `.high`. `FSA_PORTION` stays flat, so its arguments do **not** change:

```typescript
// line 96
nutrientFlag("sugar", s.sugar, sv?.sugar, per100.sugar.high, FSA_PORTION.sugar);
// line 97-103
nutrientFlag(
  "saturated_fat",
  s.saturatedFat,
  sv?.saturatedFat,
  per100.saturatedFat.high,
  FSA_PORTION.saturatedFat,
);
// line 104-110
nutrientFlag(
  "sodium",
  s.sodium,
  sv?.sodium,
  per100.sodium.high,
  FSA_PORTION.sodium,
);
```

`isBeverageCategory(input.categoriesTags)` at line 71 is unchanged apart from its import origin. The `high()` helper at lines 52-67 is unchanged — it still takes scalar lines.

- [ ] **Step 5: Run the full server suite to verify emission is unchanged**

Run: `npx vitest run server/services/__tests__/universal-flags.test.ts`
Expected: PASS — every test, including the seven from Step 1. **Any failure here means the move changed behaviour.** Do not adjust a test to make it pass; fix the code.

- [ ] **Step 6: Write the no-`FSA_`-under-server guard**

```typescript
// server/services/__tests__/no-server-fsa-constants.test.ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("FSA thresholds live in exactly one place", () => {
  it("declares no FSA_ identifier under server/", () => {
    // `git grep -l` exits 1 with no output when there are no matches, which
    // execSync throws on — so tolerate that exit code and read stdout.
    let out = "";
    try {
      out = execSync("git grep -lE '\\bFSA_[A-Z]' -- server/", {
        encoding: "utf8",
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      if (e.status !== 1) throw err;
      out = e.stdout ?? "";
    }
    const files = out.split("\n").filter(Boolean);
    // universal-flags.ts IMPORTS them from @shared — that is the one allowed
    // reference. Nothing under server/ may DECLARE or re-export them.
    expect(files).toEqual(["server/services/universal-flags.ts"]);
  });
});
```

- [ ] **Step 7: Run the guard**

Run: `npx vitest run server/services/__tests__/no-server-fsa-constants.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/services/nutrition-flag-rules.ts server/services/universal-flags.ts server/services/__tests__/no-server-fsa-constants.test.ts
git commit -m "refactor(nutrition): source FSA thresholds from shared, single declaration"
```

---

### Task 3: Unit-aware serving basis parser

**Files:**

- Modify: `shared/lib/label-serving.ts` (append; do not alter `parseLabelServingGrams`)
- Test: `shared/lib/__tests__/label-serving.test.ts` (append to the existing suite)

**Interfaces:**

- Consumes: nothing.
- Produces: `ServingBasis { quantity: number; unit: "g" | "ml" }` and `parseServingBasis(servingSize: string | null | undefined): ServingBasis | null`.

A **sibling**, not a widening. The spec allows either but prefers this: `parseLabelServingGrams` backs `isLabelReady` and `buildLabelConflict`, two load-bearing gates that previously drifted apart, and keeping them off the diff is worth a few duplicated regex lines.

- [ ] **Step 1: Write the failing test**

```typescript
// append to shared/lib/__tests__/label-serving.test.ts
import { parseServingBasis } from "../label-serving";

describe("parseServingBasis", () => {
  it("reads a parenthetical millilitre serving as a drink basis", () => {
    expect(parseServingBasis("1 can (355 mL)")).toEqual({
      quantity: 355,
      unit: "ml",
    });
  });

  it("reads a dual-unit gram serving as a food basis", () => {
    expect(parseServingBasis("(198g/7oz)")).toEqual({
      quantity: 198,
      unit: "g",
    });
  });

  it("reads a bare metric serving", () => {
    expect(parseServingBasis("30g")).toEqual({ quantity: 30, unit: "g" });
    expect(parseServingBasis("250 grams")).toEqual({
      quantity: 250,
      unit: "g",
    });
    expect(parseServingBasis("355 millilitres")).toEqual({
      quantity: 355,
      unit: "ml",
    });
  });

  it("prefers the parenthetical over a leading household measure", () => {
    // "1 cup (240ml)" must be 240ml, not 1 gram.
    expect(parseServingBasis("1 cup (240ml)")).toEqual({
      quantity: 240,
      unit: "ml",
    });
  });

  it("returns null for a household measure with no metric quantity", () => {
    expect(parseServingBasis("1 bottle")).toBeNull();
    expect(parseServingBasis("1 serving")).toBeNull();
  });

  it("returns null for a non-positive quantity", () => {
    // A zero basis would divide to Infinity. This is the case `|| 100`
    // silently swallowed.
    expect(parseServingBasis("0 ml")).toBeNull();
    expect(parseServingBasis("0g")).toBeNull();
  });

  it("returns null for absent input", () => {
    expect(parseServingBasis(null)).toBeNull();
    expect(parseServingBasis(undefined)).toBeNull();
    expect(parseServingBasis("")).toBeNull();
  });

  it("does not read a longer unit word as a metric unit", () => {
    // "1 gal" must not read as 1 gram — the \b guard.
    expect(parseServingBasis("1 gal")).toBeNull();
  });

  it("agrees with parseLabelServingGrams on quantity for every shared form", () => {
    // The two parsers must not drift. Where the gate parser finds a number,
    // this one must find the same number.
    for (const s of ["1 can (355 mL)", "(198g/7oz)", "30g", "1 cup (240ml)"]) {
      expect(parseServingBasis(s)?.quantity).toBe(parseLabelServingGrams(s));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/lib/__tests__/label-serving.test.ts`
Expected: FAIL — `parseServingBasis is not a function`

- [ ] **Step 3: Write the implementation**

Append to `shared/lib/label-serving.ts`:

```typescript
/**
 * Unit-CAPTURING variants of the two patterns above. The scale a band is
 * judged on (food per-100g vs drink per-100ml) differs by roughly 2x, so the
 * unit is not decoration — a drink measured on the food scale silently halves
 * the strictness applied to it.
 *
 * NOTE the inner `(?:re|er)` must stay NON-capturing: the outer parentheses
 * are group 2, and an extra capture would shift the index so the unit read
 * lands on `undefined` while `match[1]` still looks right.
 */
const UNIT_CAP = String.raw`(grams?|g|millilit(?:re|er)s?|ml)`;
const PAREN_BASIS = new RegExp(
  String.raw`\(\s*(\d+(?:\.\d+)?)\s*${UNIT_CAP}\b`,
);
const BARE_BASIS = new RegExp(
  String.raw`(?:^|[\s(])(\d+(?:\.\d+)?)\s*${UNIT_CAP}\b`,
);

/** A serving quantity together with the scale its unit implies. */
export interface ServingBasis {
  quantity: number;
  unit: "g" | "ml";
}

/**
 * Parses a serving string into a quantity AND its unit, for choosing the FSA
 * per-100g vs per-100ml scale.
 *
 * A SIBLING of `parseLabelServingGrams`, not a replacement: that function
 * backs the two label-readiness gates and is deliberately left alone. This one
 * additionally serves DB serving strings (`scanned_items.servingSize`), which
 * the module docblock hands off — that hand-off is now here rather than to a
 * third parser.
 *
 * Returns null rather than a default for anything unparseable or non-positive.
 * A fabricated denominator produces a confidently wrong traffic light, which
 * is worse than no traffic light.
 */
export function parseServingBasis(
  servingSize: string | null | undefined,
): ServingBasis | null {
  if (!servingSize) return null;
  const lower = servingSize.toLowerCase();

  const match = lower.match(PAREN_BASIS) ?? lower.match(BARE_BASIS);
  if (!match) return null;

  const quantity = parseFloat(match[1]);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  return {
    quantity,
    unit: match[2].startsWith("m") ? "ml" : "g",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/lib/__tests__/label-serving.test.ts`
Expected: PASS — the new suite plus every pre-existing test in the file. The pre-existing ones matter: the docblock's "MUST BE AT LEAST AS PERMISSIVE AS BOTH PREDECESSORS" warning applies to this file, and a regression there rejects labels that work today.

- [ ] **Step 5: Extend the module docblock**

At the top of `shared/lib/label-serving.ts`, the docblock says the two existing `parseServingGrams` functions "are left alone for their own callers (DB serving strings, the serving-size controls)". Add one sentence after it:

```
 * `parseServingBasis` (below) additionally covers DB serving strings for the
 * nutrient-band scale, returning the unit as well as the quantity. It does
 * NOT replace either predecessor; the two gates above still call
 * `parseLabelServingGrams`.
```

- [ ] **Step 6: Commit**

```bash
git add shared/lib/label-serving.ts shared/lib/__tests__/label-serving.test.ts
git commit -m "feat(nutrition): add unit-aware parseServingBasis for band scale"
```

---

### Task 4: Derived `isBeverage` on the barcode response

**Files:**

- Modify: `server/routes/nutrition.ts:112-155`
- Test: `server/routes/__tests__/nutrition.test.ts` (append)

**Interfaces:**

- Consumes: Task 1's `isBeverageCategory`.
- Produces: `isBeverage: boolean` on the `GET /api/nutrition/barcode/:code` response body.

**Why the server must do this.** The client cannot derive it: `categoriesTags` is destructured out of the response with the comment _"OFF-licensed (ODbL) content that must never reach the client or be persisted"_, and that constraint protects the sellable Verified Product API. A **derived boolean is not OFF content** — it is our classification about the product, the same category of output as the `flags[]` array the route already returns. Shipping the tags instead would breach the licence; shipping one bit does not.

- [ ] **Step 1: Write the failing test**

```typescript
describe("GET /api/nutrition/barcode/:code — isBeverage", () => {
  it("returns isBeverage true for a product tagged en:beverages", async () => {
    // ...existing fixture setup for a successful barcode lookup, with
    // categoriesTags: ["en:beverages", "en:colas"]
    const res = await request(app)
      .get("/api/nutrition/barcode/06772408")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.isBeverage).toBe(true);
  });

  it("returns isBeverage false for a food", async () => {
    // ...fixture with categoriesTags: ["en:snacks"]
    const res = await request(app)
      .get("/api/nutrition/barcode/12345678")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.isBeverage).toBe(false);
  });

  it("still strips the raw ODbL tag fields", async () => {
    // The whole point of deriving a scalar is that the tags do NOT ship.
    // If this ever passes with categoriesTags present, the licence boundary
    // has been broken, not merely the test.
    const res = await request(app)
      .get("/api/nutrition/barcode/06772408")
      .set("Authorization", `Bearer ${token}`);

    expect(res.body).not.toHaveProperty("categoriesTags");
    expect(res.body).not.toHaveProperty("additivesTags");
    expect(res.body).not.toHaveProperty("ingredientsText");
    expect(res.body).not.toHaveProperty("allergenTags");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/__tests__/nutrition.test.ts`
Expected: FAIL on the first two — `expected undefined to be true`. The third passes already (the strip exists); it is there to stay passing.

- [ ] **Step 3: Write the implementation**

In `server/routes/nutrition.ts`, compute the flag **before** the destructure that trims the tags (they are still in scope there), then include it in the returned object:

```typescript
// Derived BEFORE the ODbL trim below, because categoriesTags is what it
// reads — and a derived boolean is our own classification, not OFF content,
// so it may ship where the tags themselves may not. The client needs it to
// pick the FSA per-100g vs per-100ml scale, which differs by ~2x.
const isBeverage = isBeverageCategory(result.categoriesTags ?? []);

const {
  ingredientsText: _ingredientsText,
  allergenTags: _allergenTags,
  allergenDataAvailable: _allergenDataAvailable,
  additivesTags: _additivesTags,
  categoriesTags: _categoriesTags,
  ...clientResult
} = result;
// ...existing void statements unchanged...

return {
  ...clientResult,
  flags: orderedFlags,
  isBeverage,
  verificationLevel: verification?.verificationLevel ?? "unverified",
  // ...rest unchanged
};
```

Add the import at the top of the file:

```typescript
import { isBeverageCategory } from "@shared/constants/nutrition-bands";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/routes/__tests__/nutrition.test.ts`
Expected: PASS — all three, plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add server/routes/nutrition.ts server/routes/__tests__/nutrition.test.ts
git commit -m "feat(nutrition): expose derived isBeverage on the barcode response"
```

---

### Task 5: `concernBand` and `benefitBand`

> The spec calls this `bandFor`. It lands as **two** functions because the two families have
> genuinely different signatures — benefits need energy for the protein share, concerns need
> a portion weight for the per-portion override — and one function taking the union of both
> would be a discriminated mess at every call site.

**Files:**

- Create: `shared/lib/nutrition-bands.ts`
- Test: `shared/lib/__tests__/nutrition-bands.test.ts`

**Interfaces:**

- Consumes: Task 1's constants.
- Produces:
  - `type ConcernNutrient = "sugar" | "saturatedFat" | "sodium" | "fat"`
  - `type BenefitNutrient = "fibre" | "protein"`
  - `type ConcernBand = "high" | "medium" | "low" | "unknown"`
  - `type BenefitBand = "excellent" | "good" | "none" | "unknown"`
  - `type Basis = { kind: "resolved"; scale: "food" | "drink"; factor: number } | { kind: "unknown" }`
  - `concernBand(nutrient: ConcernNutrient, perServingValue: number | undefined, basis: Basis, portionGrams?: number | null): ConcernBand`
  - `benefitBand(nutrient: BenefitNutrient, perServingValue: number | undefined, basis: Basis, kcalPerServing?: number | undefined): BenefitBand`

`factor` is what a per-serving value is multiplied by to reach per-100. When the source values are already per-100 it is `1`.

- [ ] **Step 1: Write the failing test**

```typescript
// shared/lib/__tests__/nutrition-bands.test.ts
import { describe, it, expect } from "vitest";
import { concernBand, benefitBand, type Basis } from "../nutrition-bands";

const FOOD: Basis = { kind: "resolved", scale: "food", factor: 1 };
const DRINK: Basis = { kind: "resolved", scale: "drink", factor: 1 };
const UNKNOWN: Basis = { kind: "unknown" };

describe("concernBand — food boundaries", () => {
  // Each threshold tested AT the value, just below, and just above.
  it.each([
    ["sugar", 4.9, "low"],
    ["sugar", 5.0, "low"], // "at or below" is LOW
    ["sugar", 5.1, "medium"],
    ["sugar", 22.5, "medium"], // "above" is HIGH, so the line itself is MEDIUM
    ["sugar", 22.6, "high"],
    ["saturatedFat", 1.5, "low"],
    ["saturatedFat", 1.6, "medium"],
    ["saturatedFat", 5.0, "medium"],
    ["saturatedFat", 5.1, "high"],
    ["fat", 3.0, "low"],
    ["fat", 3.1, "medium"],
    ["fat", 17.5, "medium"],
    ["fat", 17.6, "high"],
    ["sodium", 120, "low"],
    ["sodium", 121, "medium"],
    ["sodium", 600, "medium"],
    ["sodium", 601, "high"],
  ] as const)("%s at %d bands %s", (nutrient, value, expected) => {
    expect(concernBand(nutrient, value, FOOD)).toBe(expected);
  });
});

describe("concernBand — drink boundaries", () => {
  it.each([
    ["sugar", 2.5, "low"],
    ["sugar", 2.6, "medium"],
    ["sugar", 11.25, "medium"],
    ["sugar", 11.26, "high"],
    ["saturatedFat", 0.75, "low"],
    ["saturatedFat", 2.5, "medium"],
    ["saturatedFat", 2.6, "high"],
    ["fat", 1.5, "low"],
    ["fat", 8.75, "medium"],
    ["fat", 8.76, "high"],
    ["sodium", 120, "low"],
    ["sodium", 300, "medium"],
    ["sodium", 301, "high"],
  ] as const)("%s at %d bands %s", (nutrient, value, expected) => {
    expect(concernBand(nutrient, value, DRINK)).toBe(expected);
  });
});

describe("concernBand — the three distinct absent states", () => {
  it("bands unknown when the basis is unresolved, even with a value", () => {
    // The dominant saved-item case. A value we cannot place on a scale is
    // NOT low.
    expect(concernBand("sugar", 39, UNKNOWN)).toBe("unknown");
  });

  it("bands unknown when the value is absent", () => {
    expect(concernBand("sugar", undefined, FOOD)).toBe("unknown");
  });

  it("bands zero as LOW, distinctly from unknown", () => {
    expect(concernBand("sugar", 0, FOOD)).toBe("low");
  });
});

describe("concernBand — the factor converts per-serving to per-100", () => {
  it("bands Amy's chili sodium MEDIUM, not HIGH", () => {
    // 680mg in a 236g serving = 288mg/100g -> MEDIUM.
    // Banding the raw 680 would read HIGH. This is the defect the explicit
    // basis exists to prevent.
    const basis: Basis = {
      kind: "resolved",
      scale: "food",
      factor: 100 / 236,
    };
    expect(concernBand("sodium", 680, basis)).toBe("medium");
  });

  it("bands Cherry Coke sugar MEDIUM on the drink scale, not HIGH", () => {
    // 39g in 355ml = 11.0g/100ml, just under the 11.25 drink line.
    const basis: Basis = {
      kind: "resolved",
      scale: "drink",
      factor: 100 / 355,
    };
    expect(concernBand("sugar", 39, basis)).toBe("medium");
  });

  it("bands the same value differently on the two scales", () => {
    // Drink thresholds are roughly half the food ones, so the scale flips
    // bands on its own — this is why resolveBasis refuses to default to food.
    const drink: Basis = { kind: "resolved", scale: "drink", factor: 1 };
    const food: Basis = { kind: "resolved", scale: "food", factor: 1 };
    expect(concernBand("sugar", 20, drink)).toBe("high");
    expect(concernBand("sugar", 20, food)).toBe("medium");
  });
});

describe("concernBand — per-portion HIGH override", () => {
  it("promotes to HIGH when a >100g portion exceeds the portion line", () => {
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    // 6.1g satfat in 240g = 2.54/100g -> MEDIUM by per-100, but the portion
    // itself exceeds FSA_PORTION.saturatedFat (6).
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
  });

  it("only promotes when the portion actually exceeds 100g", () => {
    // Same product, same numbers, portion weight the only difference.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, 240)).toBe("high");
    expect(concernBand("saturatedFat", 6.1, basis, 100)).toBe("medium");
  });

  // NOT TESTED, deliberately: a portion at or under 100g that exceeds the
  // portion line but not the per-100 line. That state is unreachable. Every
  // portion line sits ABOVE its per-100 counterpart (satfat 6 vs 5, sodium
  // 720 vs 600, sugar 27 vs 22.5), and for a portion <= 100g the per-100
  // value is >= the raw value — so exceeding the portion line already
  // implies exceeding the per-100 line. Do not write a test asserting a
  // distinction the thresholds make impossible; it would pass for the
  // wrong reason.

  it("never applies a portion override to total fat", () => {
    // FSA publishes no per-portion figure for total fat; inventing one would
    // make it our number rather than theirs.
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    // 20g fat in 240g = 8.3/100g -> MEDIUM, and stays MEDIUM.
    expect(concernBand("fat", 20, basis, 240)).toBe("medium");
  });

  it("skips the override when the portion weight is unknown", () => {
    const basis: Basis = { kind: "resolved", scale: "food", factor: 100 / 240 };
    expect(concernBand("saturatedFat", 6.1, basis, null)).toBe("medium");
  });
});

describe("benefitBand", () => {
  it.each([
    [2.9, "none"],
    [3.0, "good"],
    [5.9, "good"],
    [6.0, "excellent"],
  ] as const)("fibre at %dg bands %s", (value, expected) => {
    expect(benefitBand("fibre", value, FOOD)).toBe(expected);
  });

  it("bands fibre zero as none, distinctly from unknown", () => {
    expect(benefitBand("fibre", 0, FOOD)).toBe("none");
    expect(benefitBand("fibre", undefined, FOOD)).toBe("unknown");
  });

  it("bands protein by energy share", () => {
    // 11g protein x 4 = 44kcal of 200 = 22% -> excellent
    expect(benefitBand("protein", 11, FOOD, 200)).toBe("excellent");
    // 7g x 4 = 28 of 200 = 14% -> good
    expect(benefitBand("protein", 7, FOOD, 200)).toBe("good");
    // 4g x 4 = 16 of 200 = 8% -> none
    expect(benefitBand("protein", 4, FOOD, 200)).toBe("none");
  });

  it("bands protein unknown when energy is absent or zero", () => {
    // No division by zero, and no pretending 0 kcal means 0% protein.
    expect(benefitBand("protein", 11, FOOD, undefined)).toBe("unknown");
    expect(benefitBand("protein", 11, FOOD, 0)).toBe("unknown");
  });

  it("bands unknown when the basis is unresolved", () => {
    expect(benefitBand("fibre", 12, UNKNOWN)).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/lib/__tests__/nutrition-bands.test.ts`
Expected: FAIL — `Failed to resolve import "../nutrition-bands"`

- [ ] **Step 3: Write the implementation**

```typescript
// shared/lib/nutrition-bands.ts
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  FIBRE_CLAIM,
  PROTEIN_ENERGY_CLAIM,
} from "@shared/constants/nutrition-bands";

export type ConcernNutrient = "sugar" | "saturatedFat" | "sodium" | "fat";
export type BenefitNutrient = "fibre" | "protein";

export type ConcernBand = "high" | "medium" | "low" | "unknown";
export type BenefitBand = "excellent" | "good" | "none" | "unknown";

/**
 * How to place a per-serving value on a per-100 scale.
 *
 * `kind: "unknown"` is the load-bearing case: it means we have a number but
 * no trustworthy denominator or no idea which scale applies, and every band
 * derived from it is `unknown` — which the UI renders unbanded. A red dot
 * derived from an invented denominator is a confident false claim about
 * someone's food.
 */
export type Basis =
  | {
      kind: "resolved";
      scale: "food" | "drink";
      /** Multiply a per-serving value by this to get per-100. 1 when already per-100. */
      factor: number;
    }
  | { kind: "unknown" };

/** Nutrients with a published per-portion RED override. Total fat has none. */
const PORTION_LINES: Partial<Record<ConcernNutrient, number>> = {
  sugar: FSA_PORTION.sugar,
  saturatedFat: FSA_PORTION.saturatedFat,
  sodium: FSA_PORTION.sodium,
};

export function concernBand(
  nutrient: ConcernNutrient,
  perServingValue: number | undefined,
  basis: Basis,
  portionGrams?: number | null,
): ConcernBand {
  if (basis.kind === "unknown") return "unknown";
  if (perServingValue === undefined || !Number.isFinite(perServingValue)) {
    return "unknown";
  }

  const limits = (basis.scale === "drink" ? FSA_DRINK : FSA_FOOD)[nutrient];
  const per100 = perServingValue * basis.factor;

  // The per-portion override can only ever promote TO high, and only for
  // portions over 100 g/ml. Skipping it when the weight is unknown fails
  // toward under-warning, which is the established direction for nutrient
  // flags (allergen flags fail the other way).
  const portionLine = PORTION_LINES[nutrient];
  if (
    portionLine !== undefined &&
    portionGrams != null &&
    portionGrams > 100 &&
    perServingValue > portionLine
  ) {
    return "high";
  }

  if (per100 > limits.high) return "high";
  if (per100 > limits.low) return "medium";
  return "low";
}

export function benefitBand(
  nutrient: BenefitNutrient,
  perServingValue: number | undefined,
  basis: Basis,
  kcalPerServing?: number | undefined,
): BenefitBand {
  if (basis.kind === "unknown") return "unknown";
  if (perServingValue === undefined || !Number.isFinite(perServingValue)) {
    return "unknown";
  }

  if (nutrient === "protein") {
    // Energy share, not an absolute weight — 20g of protein means something
    // different in a 200kcal meal than in a 900kcal one.
    if (
      kcalPerServing === undefined ||
      !Number.isFinite(kcalPerServing) ||
      kcalPerServing <= 0
    ) {
      return "unknown";
    }
    const share = (perServingValue * 4) / kcalPerServing;
    if (share >= PROTEIN_ENERGY_CLAIM.excellent) return "excellent";
    if (share >= PROTEIN_ENERGY_CLAIM.good) return "good";
    return "none";
  }

  const per100 = perServingValue * basis.factor;
  if (per100 >= FIBRE_CLAIM.excellent) return "excellent";
  if (per100 >= FIBRE_CLAIM.good) return "good";
  return "none";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/lib/__tests__/nutrition-bands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/lib/nutrition-bands.ts shared/lib/__tests__/nutrition-bands.test.ts
git commit -m "feat(nutrition): add concernBand/benefitBand with an explicit basis"
```

---

### Task 6: `resolveBasis`

**Files:**

- Modify: `shared/lib/nutrition-bands.ts` (append)
- Test: `shared/lib/__tests__/nutrition-bands.test.ts` (append)

**Interfaces:**

- Consumes: Task 3's `parseServingBasis`, Task 5's `Basis`.
- Produces: `resolveBasis(input: ResolveBasisInput): Basis` where

```typescript
interface ResolveBasisInput {
  valuesArePer100: boolean;
  servingSize: string | null | undefined;
  isBeverage: boolean | null | undefined;
}
```

- [ ] **Step 1: Write the failing test**

```typescript
// append to shared/lib/__tests__/nutrition-bands.test.ts
import { resolveBasis } from "../nutrition-bands";

describe("resolveBasis", () => {
  it("trusts a per-100 payload with an explicit drink flag", () => {
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 can (355 mL)",
        isBeverage: true,
      }),
    ).toEqual({ kind: "resolved", scale: "drink", factor: 1 });
  });

  it("trusts a per-100 payload with an explicit food flag", () => {
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 cup (236g)",
        isBeverage: false,
      }),
    ).toEqual({ kind: "resolved", scale: "food", factor: 1 });
  });

  it("falls back to the serving unit when isBeverage is absent", () => {
    // The direct-OFF client fallback and older bundles have no flag.
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 can (355 mL)",
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "resolved", scale: "drink", factor: 1 });
  });

  it("back-calculates the factor from a parsed serving", () => {
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "1 cup (236g)",
        isBeverage: null,
      }),
    ).toEqual({ kind: "resolved", scale: "food", factor: 100 / 236 });
  });

  it("prefers the explicit flag over the serving unit when both exist", () => {
    // A drink sold by weight ("500g") is still a drink.
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "500g",
        isBeverage: true,
      }),
    ).toEqual({ kind: "resolved", scale: "drink", factor: 100 / 500 });
  });

  it("returns unknown when the serving string carries no metric quantity", () => {
    // THE saved-item case. Never a 100g default.
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "1 bottle",
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("returns unknown when the serving string is absent", () => {
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: null,
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("returns unknown for a zero or negative quantity", () => {
    expect(
      resolveBasis({
        valuesArePer100: false,
        servingSize: "0 ml",
        isBeverage: true,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("returns unknown when a per-100 payload has no usable scale signal", () => {
    // Values are trustworthy but we cannot tell food from drink, and the
    // scales differ by ~2x. Guessing food would halve the strictness on
    // every untagged drink.
    expect(
      resolveBasis({
        valuesArePer100: true,
        servingSize: "1 serving",
        isBeverage: undefined,
      }),
    ).toEqual({ kind: "unknown" });
  });

  it("never defaults to the food scale", () => {
    const results = [
      resolveBasis({
        valuesArePer100: true,
        servingSize: null,
        isBeverage: null,
      }),
      resolveBasis({
        valuesArePer100: false,
        servingSize: "1 pack",
        isBeverage: null,
      }),
    ];
    for (const r of results) expect(r.kind).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/lib/__tests__/nutrition-bands.test.ts`
Expected: FAIL — `resolveBasis is not a function`

- [ ] **Step 3: Write the implementation**

Append to `shared/lib/nutrition-bands.ts`, and add `parseServingBasis` to its imports:

```typescript
// Relative, not aliased: this is a sibling in the same directory, and
// `shared/` is consumed by both the Express build and the Metro bundler —
// a relative sibling import resolves identically under both.
import { parseServingBasis } from "./label-serving";

export interface ResolveBasisInput {
  /** True when the caller's nutrient values are ALREADY per 100 g/ml. */
  valuesArePer100: boolean;
  /** The product's serving string, e.g. "1 can (355 mL)". */
  servingSize: string | null | undefined;
  /**
   * Derived scale flag from the barcode response. Absent on the saved-item
   * path, the direct-OFF fallback, and bundles predating it.
   */
  isBeverage: boolean | null | undefined;
}

/**
 * Decides whether a set of nutrient values can be placed on an FSA scale at
 * all, and if so on which one.
 *
 * Deliberately does NOT read `effectivePer100g` from useNutritionLookup:
 * that value back-calculates with `servingSizeGrams || 100`, and on the
 * saved-item path `servingSizeGrams` is never set, so it returns per-serving
 * numbers labelled per-100g. Consuming it here is exactly what would arm that
 * latent defect. See
 * todos/P2-2026-07-31-effective-per100g-fabricates-basis-on-saved-item-path.md
 */
export function resolveBasis(input: ResolveBasisInput): Basis {
  const parsed = parseServingBasis(input.servingSize);

  // Scale: the explicit flag wins (a drink sold by weight is still a drink);
  // otherwise the serving unit, which mirrors the FSA's own per-100g vs
  // per-100ml split. Never a default — food thresholds are roughly double
  // drink thresholds, so guessing food under-warns on every untagged drink.
  const scale: "food" | "drink" | null =
    input.isBeverage === true
      ? "drink"
      : input.isBeverage === false
        ? "food"
        : parsed
          ? parsed.unit === "ml"
            ? "drink"
            : "food"
          : null;

  if (scale === null) return { kind: "unknown" };

  if (input.valuesArePer100) return { kind: "resolved", scale, factor: 1 };

  if (!parsed) return { kind: "unknown" };
  return { kind: "resolved", scale, factor: 100 / parsed.quantity };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/lib/__tests__/nutrition-bands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/lib/nutrition-bands.ts shared/lib/__tests__/nutrition-bands.test.ts
git commit -m "feat(nutrition): add resolveBasis, refusing to guess a denominator"
```

---

### Task 7: `pickStandouts`

**Files:**

- Modify: `shared/lib/nutrition-bands.ts` (append)
- Modify: `stryker.targets.mjs`
- Test: `shared/lib/__tests__/nutrition-bands.test.ts` (append)

**Interfaces:**

- Consumes: Task 5's band types.
- Produces:

```typescript
interface NutrientBands {
  concerns: Partial<
    Record<ConcernNutrient, { band: ConcernBand; hasValue: boolean }>
  >;
  benefits: Partial<
    Record<BenefitNutrient, { band: BenefitBand; hasValue: boolean }>
  >;
}
type Standout =
  | { group: "concern"; nutrient: ConcernNutrient; band: ConcernBand }
  | { group: "benefit"; nutrient: BenefitNutrient; band: BenefitBand };
function pickStandouts(bands: NutrientBands): Standout[]; // exactly 2 when possible
```

**The rule, restated from the spec.** Rules 1-2 assign bands. Rule 3: slot one is the worst concern at MEDIUM or above; slot two is the best benefit at GOOD or above. Rule 4: if exactly one fills, the other is **always fibre**, whatever its band. Rule 5: if neither fills, promote fibre plus the first concern in fixed order **with a known value, regardless of band**. Rule 6: ties break on fixed order — concerns `[sugar, saturatedFat, sodium, fat]`, benefits `[fibre, protein]`.

**Rules 3 and 4 test the BAND; rule 5 tests VALUE-PRESENCE.** That distinction is deliberate and is the whole point of rule 5 — on a basis-unknown saved item every band is `unknown` while every value is known, and that is the dominant saved-item state, not an edge case.

- [ ] **Step 1: Write the failing test**

```typescript
// append to shared/lib/__tests__/nutrition-bands.test.ts
import {
  pickStandouts,
  type NutrientBands,
  type ConcernBand,
  type BenefitBand,
} from "../nutrition-bands";

/** Terse fixture builder. Typed, so a bad band string fails at compile time. */
const c = <B extends ConcernBand | BenefitBand>(band: B, hasValue = true) => ({
  band,
  hasValue,
});

describe("pickStandouts", () => {
  it("promotes the worst concern and the best benefit", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("high"), sodium: c("medium") },
      benefits: { fibre: c("excellent"), protein: c("good") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high" },
      { group: "benefit", nutrient: "fibre", band: "excellent" },
    ]);
  });

  it("falls back to fibre when no benefit qualifies", () => {
    // Cherry Coke: high sugar, nothing good to say. Fibre still appears,
    // as an explicit grey NONE — its absence IS the finding.
    const bands: NutrientBands = {
      concerns: { sugar: c("high"), sodium: c("low") },
      benefits: { fibre: c("none"), protein: c("none") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "concern", nutrient: "sugar", band: "high" },
      { group: "benefit", nutrient: "fibre", band: "none" },
    ]);
  });

  it("fills the concern slot from fixed order when no concern qualifies", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("low"), sodium: c("low") },
      benefits: { fibre: c("excellent") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "benefit", nutrient: "fibre", band: "excellent" },
      { group: "concern", nutrient: "sugar", band: "low" },
    ]);
  });

  it("promotes fibre plus the first valued concern when ALL bands are unknown", () => {
    // THE dominant saved-item state under Decision 8: values known, basis
    // unresolved, so every band is unknown. Rule 5 is value-presence, not
    // band-knownness — showing nothing here would blank the card on a screen
    // whose premise is surfacing data.
    const bands: NutrientBands = {
      concerns: {
        sugar: c("unknown"),
        saturatedFat: c("unknown"),
        sodium: c("unknown"),
      },
      benefits: { fibre: c("unknown"), protein: c("unknown") },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "benefit", nutrient: "fibre", band: "unknown" },
      { group: "concern", nutrient: "sugar", band: "unknown" },
    ]);
  });

  it("skips a concern with no value when filling by rule 5", () => {
    const bands: NutrientBands = {
      concerns: {
        sugar: c("unknown", false), // not recorded
        sodium: c("unknown", true),
      },
      benefits: { fibre: c("unknown", true) },
    };
    expect(pickStandouts(bands)).toEqual([
      { group: "benefit", nutrient: "fibre", band: "unknown" },
      { group: "concern", nutrient: "sodium", band: "unknown" },
    ]);
  });

  it("breaks concern ties on fixed order — sugar wins", () => {
    const bands: NutrientBands = {
      concerns: { sodium: c("high"), sugar: c("high") },
      benefits: {},
    };
    expect(pickStandouts(bands)[0]).toEqual({
      group: "concern",
      nutrient: "sugar",
      band: "high",
    });
  });

  it("breaks benefit ties on fixed order — fibre wins", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("high") },
      benefits: { protein: c("excellent"), fibre: c("excellent") },
    };
    expect(pickStandouts(bands)[1]).toEqual({
      group: "benefit",
      nutrient: "fibre",
      band: "excellent",
    });
  });

  it("is insensitive to key insertion order", () => {
    // Determinism by PERMUTATION, not repetition. Calling a pure function
    // twice cannot differ; iterating a differently-built object can.
    const a: NutrientBands = {
      concerns: { sugar: c("medium"), sodium: c("high") },
      benefits: { fibre: c("good"), protein: c("excellent") },
    };
    const b: NutrientBands = {
      concerns: { sodium: c("high"), sugar: c("medium") },
      benefits: { protein: c("excellent"), fibre: c("good") },
    };
    expect(pickStandouts(a)).toEqual(pickStandouts(b));
  });

  it("always returns two distinct rows when two nutrients have values", () => {
    const cases: NutrientBands[] = [
      { concerns: { sugar: c("high") }, benefits: { fibre: c("excellent") } },
      { concerns: { sugar: c("low") }, benefits: { fibre: c("none") } },
      { concerns: { sugar: c("unknown") }, benefits: { fibre: c("unknown") } },
    ];
    for (const bands of cases) {
      const out = pickStandouts(bands);
      expect(out).toHaveLength(2);
      expect(out[0]).not.toEqual(out[1]);
    }
  });

  it("returns what it can when fewer than two nutrients have values", () => {
    const bands: NutrientBands = {
      concerns: { sugar: c("unknown", false) },
      benefits: { fibre: c("good", true) },
    };
    const out = pickStandouts(bands);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      group: "benefit",
      nutrient: "fibre",
      band: "good",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/lib/__tests__/nutrition-bands.test.ts`
Expected: FAIL — `pickStandouts is not a function`

- [ ] **Step 3: Write the implementation**

Append to `shared/lib/nutrition-bands.ts`:

```typescript
/** Fixed order. Ties break here, so the same product always shows the same rows. */
const CONCERN_ORDER: readonly ConcernNutrient[] = [
  "sugar",
  "saturatedFat",
  "sodium",
  "fat",
];
const BENEFIT_ORDER: readonly BenefitNutrient[] = ["fibre", "protein"];

const CONCERN_RANK: Record<ConcernBand, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};
const BENEFIT_RANK: Record<BenefitBand, number> = {
  excellent: 3,
  good: 2,
  none: 1,
  unknown: 0,
};

export interface BandedValue<B> {
  band: B;
  /** False when the nutrient has no recorded value at all (distinct from zero). */
  hasValue: boolean;
}

export interface NutrientBands {
  concerns: Partial<Record<ConcernNutrient, BandedValue<ConcernBand>>>;
  benefits: Partial<Record<BenefitNutrient, BandedValue<BenefitBand>>>;
}

export type Standout =
  | { group: "concern"; nutrient: ConcernNutrient; band: ConcernBand }
  | { group: "benefit"; nutrient: BenefitNutrient; band: BenefitBand };

/**
 * Picks the two nutrients worth promoting into the summary card — the worst
 * concern and the best benefit on THIS product.
 *
 * Iterates the fixed ORDER arrays rather than Object.keys, so the result
 * cannot depend on how the input object was built.
 */
export function pickStandouts(bands: NutrientBands): Standout[] {
  // Rule 3, slot one: worst concern at MEDIUM or above.
  let concern: Standout | null = null;
  let bestConcernRank = CONCERN_RANK.medium - 1;
  for (const n of CONCERN_ORDER) {
    const entry = bands.concerns[n];
    if (!entry) continue;
    const rank = CONCERN_RANK[entry.band];
    if (rank >= CONCERN_RANK.medium && rank > bestConcernRank) {
      bestConcernRank = rank;
      concern = { group: "concern", nutrient: n, band: entry.band };
    }
  }

  // Rule 3, slot two: best benefit at GOOD or above.
  let benefit: Standout | null = null;
  let bestBenefitRank = BENEFIT_RANK.good - 1;
  for (const n of BENEFIT_ORDER) {
    const entry = bands.benefits[n];
    if (!entry) continue;
    const rank = BENEFIT_RANK[entry.band];
    if (rank >= BENEFIT_RANK.good && rank > bestBenefitRank) {
      bestBenefitRank = rank;
      benefit = { group: "benefit", nutrient: n, band: entry.band };
    }
  }

  // Rule 4: if exactly one slot filled, the other is ALWAYS fibre — whatever
  // its band, including `none` and `unknown`. This is what guarantees fibre
  // appears on every product (Decision 3).
  if (concern && !benefit) {
    const fibre = bands.benefits.fibre;
    if (fibre) {
      benefit = { group: "benefit", nutrient: "fibre", band: fibre.band };
    }
  }

  // Rule 5: neither filled. Promote fibre plus the first concern in fixed
  // order that has a KNOWN VALUE, regardless of band. Rules 3-4 test the
  // band; this tests value-presence, because on a basis-unknown saved item
  // every band is `unknown` while every value is known — the dominant
  // saved-item state, not an edge case.
  if (!concern && !benefit) {
    const fibre = bands.benefits.fibre;
    if (fibre?.hasValue) {
      benefit = { group: "benefit", nutrient: "fibre", band: fibre.band };
    }
  }
  if (!concern) {
    for (const n of CONCERN_ORDER) {
      const entry = bands.concerns[n];
      if (entry?.hasValue) {
        concern = { group: "concern", nutrient: n, band: entry.band };
        break;
      }
    }
  }

  // Benefit first when it led (rule 3 filled the benefit slot but not the
  // concern one), so the promoted good news reads before the filler.
  const out: Standout[] = [];
  if (benefit && bestConcernRank < CONCERN_RANK.medium) {
    if (benefit) out.push(benefit);
    if (concern) out.push(concern);
  } else {
    if (concern) out.push(concern);
    if (benefit) out.push(benefit);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/lib/__tests__/nutrition-bands.test.ts`
Expected: PASS — the whole file, all three suites.

- [ ] **Step 5: Register the module as a mutation target**

The likeliest defect in this file is an inclusive/exclusive mix-up (`>=` vs `>`), which coarse boundary fixtures cannot see. Add `"shared/lib/nutrition-bands.ts"` to the targets array in `stryker.targets.mjs`, following the existing entries' format.

- [ ] **Step 6: Baseline the mutation score**

Run: `npm run mutation:explore`
Expected: a score report. **Do not set a `breakThreshold` above the achieved score** — record the baseline and leave the threshold at or below it, per the repo's gated-mutation convention.

- [ ] **Step 7: Commit**

```bash
git add shared/lib/nutrition-bands.ts shared/lib/__tests__/nutrition-bands.test.ts stryker.targets.mjs
git commit -m "feat(nutrition): add pickStandouts with fibre guaranteed a slot"
```

---

### Task 8: Surface `isBeverage` on the lookup hook

**Files:**

- Modify: `client/hooks/useNutritionLookup.ts` (the barcode-response handler around `:389-450`, the state block near `:84-92`, and the return object near `:905-930`)
- Test: `client/hooks/__tests__/useNutritionLookup.test.ts` (append)

**Interfaces:**

- Consumes: Task 4's `isBeverage` response field.
- Produces: `isBeverage: boolean | null` on the hook's return value.

Slice 2c consumes this. It is exposed here rather than in 2c so that the entire wire-to-hook path — including the boundary narrowing — lands with the server change that introduces it, and 2c stays purely presentational.

**Do not touch `effectivePer100g`.** Its `servingSizeGrams || 100` fabrication stays exactly as it is; the band path simply never reads it. Repairing it is a separate change, tracked at `todos/P2-2026-07-31-effective-per100g-fabricates-basis-on-saved-item-path.md`.

- [ ] **Step 1: Write the failing test**

```typescript
describe("useNutritionLookup — isBeverage", () => {
  it("exposes isBeverage from a successful barcode response", async () => {
    mockBarcodeResponse({ isBeverage: true /* ...other fields */ });
    const { result } = renderHook(() =>
      useNutritionLookup({ barcode: "06772408" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBe(true);
  });

  it("exposes null when the field is absent", async () => {
    // Older server, or the direct-OFF client fallback. Null means "no
    // signal", which resolveBasis treats as unknown rather than food.
    mockBarcodeResponse({
      /* no isBeverage key */
    });
    const { result } = renderHook(() =>
      useNutritionLookup({ barcode: "06772408" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBeNull();
  });

  it("exposes null when the field is present but not a boolean", async () => {
    // The response is consumed as untyped json(); a wire field must be
    // narrowed at the boundary, not trusted.
    mockBarcodeResponse({ isBeverage: "true" });
    const { result } = renderHook(() =>
      useNutritionLookup({ barcode: "06772408" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBeNull();
  });

  it("exposes null on the saved-item path", async () => {
    mockScannedItemResponse({ id: 42, productName: "Leftover chili" });
    const { result } = renderHook(() => useNutritionLookup({ itemId: 42 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isBeverage).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run client/hooks/__tests__/useNutritionLookup.test.ts`
Expected: FAIL — `expected undefined to be true`

- [ ] **Step 3: Write the implementation**

Add the state declaration beside the existing `flags` / `verificationLevel` state (near `:84`):

```typescript
const [isBeverage, setIsBeverage] = useState<boolean | null>(null);
```

In the successful barcode-response branch, beside the existing `if (data.verificationLevel)` narrowing (near `:524`):

```typescript
// Narrowed explicitly: the response is consumed as untyped `json()`, so a
// new wire field arrives as `any`. Anything that is not a real boolean
// becomes null — "no signal" — which resolveBasis treats as unknown rather
// than silently defaulting to the food scale (which would halve the
// strictness applied to every drink).
setIsBeverage(typeof data.isBeverage === "boolean" ? data.isBeverage : null);
```

Add `isBeverage` to the hook's returned object, beside `verificationLevel`.

The saved-item path needs no change: it never enters this branch, so the state keeps its `null` initialiser — which is the correct "no signal" value.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run client/hooks/__tests__/useNutritionLookup.test.ts`
Expected: PASS — the new suite plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useNutritionLookup.ts client/hooks/__tests__/useNutritionLookup.test.ts
git commit -m "feat(nutrition): surface isBeverage from the lookup hook"
```

---

## Slice completion

- [ ] **Run the full local gate**

Run: `npm run preflight`
Expected: PASS. This is the on-demand full-CI-parity run including coverage; the per-push fast gate is not enough for a slice that changes live flag emission.

- [ ] **Open the PR with `priority: high` on its todo**

Auto-merge must never be armed for this slice — it changes the code deciding whether a user is told their food is high in sugar, and `scripts/todo-automerge-guard.sh` allowlists every path here (`^server/services/`, `^shared/constants/`, `^shared/lib/`, `^client/`). A `high`-priority todo is never auto-merged. Task 4's `server/routes/nutrition.ts` also trips the guard's sensitive override, but do not rely on that alone — it is one line of a much larger diff.

- [ ] **PR body must state the two non-obvious properties** so a reviewer checks them rather than assuming:
  1. Flag **emission conditions are unchanged**; only the constants' shape changed. The seven characterisation tests committed in Task 2 Step 3 — before any code moved — are the evidence.
  2. **No `FSA_` identifier is declared under `server/`.** `server/services/__tests__/no-server-fsa-constants.test.ts` enforces it.

Slices 2b and 2c get their own plans, written after this one lands. They are strictly sequential with it and with each other — 2b and 2c both rewrite `client/screens/NutritionDetailScreen.tsx`, so they must never run in parallel worktrees.
