# Smart Scan — "Trust the Label" OCR Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a barcode scan also captured a nutrition-label photo, let the user override a materially-wrong database entry with the scanned label — defaulting to the label — and recompute the nutrition flags on the chosen data.

**Architecture:** The client parses the STEP2 label OCR (existing `parseNutritionFromOCR`, extended for Canadian/bilingual labels) and, when it reads enough, POSTs the parsed macros alongside the barcode. The server does the barcode DB lookup as today, and — when a `labelNutrition` body is present — also builds a **label-corrected result** (label macros + the DB's OFF-only enrichment, as a trusted per-serving entry) with its own recomputed flags, returning both. The client shows a conflict prompt and toggles between two ready-made results; it holds no nutrition logic.

**Tech Stack:** TypeScript, Express, Vitest, React Native/Expo, zod. Server services in `server/services/`, routes in `server/routes/`, client hook/screens in `client/`.

**Spec:** `docs/superpowers/specs/2026-07-22-scan-label-trust-override-design.md` (local-only; `docs/superpowers/` is gitignored).

## Global Constraints

_(Every task's requirements implicitly include these — copied from the spec.)_

- **Free & universal** — no premium gating; all flags stay `tier: "nutrition"`, NEVER `"insight"` (the universal-flags v1 landmine).
- **ODbL** — OFF-derived content is read live, NEVER persisted to `barcodeNutrition`; `additivesTags`/`categoriesTags` are stripped from EVERY client response (GET and the new POST); flag titles stay static literals.
- **Health-facing** — human-in-the-loop on conflict; default the selection to the label; NO silent override; on any doubt fail toward "show the DB result and let the user decide," never toward fabricated data.
- **Trusted-per-serving is load-bearing** — the label-corrected result MUST be a trusted per-serving entry with `servingGrams > 100` for a cola, or the recomputed "High in Sugar" flag will not fire (per-portion path only).
- **Presence gate, not the confidence ratio** — offer the label only when calories + ≥1 compared macro were read; the parser's `confidence` ratio under-scores sparse beverage labels.
- **Cross-platform** — iOS AND Android parity for the prompt and its accessibility.
- **TDD** — write the failing test first each task; targeted `npx vitest run <file>` per step; whole-suite/type/lint is CI's job. Add `npx tsc --noEmit` as the type-check evidence (Vitest strips types).
- **Tests co-located** in `__tests__/` beside the code (project convention).

## File Structure

| File                                                      | Responsibility                                               | Change                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `client/lib/nutrition-ocr-parser.ts`                      | OCR text → `LocalNutritionData`                              | **Modify** — add Canadian/bilingual serving + field patterns              |
| `client/lib/__tests__/nutrition-ocr-parser.test.ts`       | parser tests                                                 | **Modify** — Canadian fixtures                                            |
| `server/services/label-override.ts`                       | pure compare + merge → label-corrected `BarcodeLookupResult` | **Create**                                                                |
| `server/services/__tests__/label-override.test.ts`        | compare/merge tests                                          | **Create**                                                                |
| `server/services/barcode-lookup.ts`                       | barcode pipeline                                             | **Modify** — `export` `parseServingGrams`                                 |
| `server/routes/nutrition.ts`                              | barcode route                                                | **Modify** — extract flag-build helper; add POST with two-result response |
| `server/routes/__tests__/nutrition.test.ts`               | route tests                                                  | **Modify** — POST/conflict cases                                          |
| `client/navigation/RootStackNavigator.tsx`                | route params                                                 | **Modify** — add `ocrText?` to `NutritionDetail`                          |
| `client/screens/ScanScreen.tsx`                           | scan flow                                                    | **Modify** — forward `ocrText` on session-complete                        |
| `client/hooks/useNutritionLookup.ts`                      | lookup + state                                               | **Modify** — parse label, POST on presence, expose conflict               |
| `client/hooks/__tests__/useNutritionLookup.test.ts`       | hook tests                                                   | **Create/Modify** — POST + conflict + toggle                              |
| `client/components/ScanConflictPrompt.tsx`                | conflict chooser UI                                          | **Create**                                                                |
| `client/components/__tests__/ScanConflictPrompt.test.tsx` | UI tests                                                     | **Create**                                                                |
| `client/screens/NutritionDetailScreen.tsx`                | detail screen                                                | **Modify** — render prompt, wire choose                                   |

---

## Task 1: Canadian/bilingual OCR label parsing

**Files:**

- Modify: `client/lib/nutrition-ocr-parser.ts` (`SERVING_SIZE_PATTERN`, `FIELD_PATTERNS`)
- Test: `client/lib/__tests__/nutrition-ocr-parser.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `parseNutritionFromOCR(text: string): LocalNutritionData` — unchanged signature; now also parses Canadian/bilingual labels (serving "Per 355 mL"; fields "Fat / Lipides", "Sugars / Sucres", etc.). `LocalNutritionData` fields used downstream: `calories`, `totalFat`, `totalSugars`, `saturatedFat`, `sodium`, `servingSize`, `confidence`.

- [ ] **Step 1: Write failing tests** — append to `client/lib/__tests__/nutrition-ocr-parser.test.ts`:

```ts
describe("Canadian / bilingual labels", () => {
  it('extracts "Per 355 mL" serving', () => {
    const r = parseNutritionFromOCR(
      "Nutrition Facts\nPer 355 mL\nCalories 150",
    );
    expect(r.servingSize).toBe("355 mL");
    expect(r.calories).toBe(150);
  });

  it('extracts bilingual "Sugars / Sucres" and "Fat / Lipides"', () => {
    const r = parseNutritionFromOCR(
      "Per 355 mL\nCalories 150\nFat / Lipides 0 g\nSugars / Sucres 39 g",
    );
    expect(r.totalFat).toBe(0);
    expect(r.totalSugars).toBe(39);
  });

  it("handles accented French field names", () => {
    const r = parseNutritionFromOCR(
      "pour 250 mL\nProtéines 3 g\nGlucides 26 g",
    );
    expect(r.protein).toBe(3);
    expect(r.totalCarbs).toBe(26);
  });

  it('falls back to "Per" only when the capture carries a g/ml token', () => {
    // a stray "per serving" line without a unit must NOT become the serving size
    const r = parseNutritionFromOCR("Amount per serving\nServing Size 30 g");
    expect(r.servingSize).toBe("30 g");
  });

  it("keeps US-format labels working (no regression)", () => {
    const r = parseNutritionFromOCR(
      "Serving Size 1 cup (240g)\nCalories 100\nTotal Fat 2g\nTotal Sugars 12g",
    );
    expect(r.servingSize).toBe("1 cup (240g)");
    expect(r.totalSugars).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run client/lib/__tests__/nutrition-ocr-parser.test.ts`
Expected: the four Canadian cases FAIL (serving null / fields null); the US regression case PASSES.

- [ ] **Step 3: Extend the serving pattern.** In `client/lib/nutrition-ocr-parser.ts` replace:

```ts
const SERVING_SIZE_PATTERN = /serving\s+size\s+(.+)/i;
```

with a preferred "serving size" match plus a `per/pour/portion` fallback that only wins when the captured text contains a g/ml token:

```ts
const SERVING_SIZE_PATTERN = /serving\s+size\s+(.+)/i;
// Canadian/bilingual labels head the column with "Per 355 mL" / "pour 250 mL" /
// "Portion". Only accept this form when the capture carries a g/ml token, so a
// stray "Amount per serving" line can't hijack the serving size.
const SERVING_PER_PATTERN =
  /(?:^|\n)\s*(?:per|pour|portion)\s+([^\n]*\d[^\n]*(?:g|ml)[^\n]*)/i;
```

Then update the serving extraction block in `parseNutritionFromOCR`:

```ts
// Extract serving size (free-form text, not numeric). Prefer the US
// "Serving Size" label; fall back to the Canadian "Per X mL" form only when
// that capture contains a g/ml token (see SERVING_PER_PATTERN).
const servingMatch =
  text.match(SERVING_SIZE_PATTERN) ?? text.match(SERVING_PER_PATTERN);
if (servingMatch) {
  result.servingSize = servingMatch[1].trim().slice(0, 100);
}
```

- [ ] **Step 4: Broaden the field patterns** for Canadian/bilingual forms. Replace the affected entries in `FIELD_PATTERNS`:

```ts
const FIELD_PATTERNS: FieldPattern[] = [
  { key: "calories", pattern: /calories\s+(?!from\b)<?(\S+)/i },
  // "Total Fat" (US) OR "Fat" / "Lipides" (Canadian/bilingual "Fat / Lipides")
  {
    key: "totalFat",
    pattern: /(?:total\s+fat|fat|lipides)\b[\s/a-zéè]*?<?(\d[\d.]*)\s*g/i,
  },
  {
    key: "saturatedFat",
    pattern:
      /(?:saturated\s+fat|saturated|satur[ée]s?|satur[ée]s\s*\/\s*saturated)\b[\s/a-zéè]*?<?(\d[\d.]*)\s*g/i,
  },
  {
    key: "transFat",
    pattern: /trans\s*(?:fat|\/\s*trans)?\b[\s/a-zéè]*?<?(\d[\d.]*)\s*g/i,
  },
  {
    key: "cholesterol",
    pattern: /cholesterol\b[\s/a-zéè]*?<?(\d[\d.]*)\s*mg/i,
  },
  { key: "sodium", pattern: /sodium\b[\s/a-zéè]*?<?(\d[\d.]*)\s*mg/i },
  {
    key: "totalCarbs",
    pattern:
      /(?:total\s+carb(?:ohydrate|s|\.?)?|carbohydrate|glucides)\b[\s/a-zéè]*?<?(\d[\d.]*)\s*g/i,
  },
  {
    key: "dietaryFiber",
    pattern:
      /(?:dietary\s+fiber|fib(?:re|er)s?|fibres?)\b[\s/a-zéè]*?<?(\d[\d.]*)\s*g/i,
  },
  // "Total Sugars" (US) OR "Sugars" / "Sucres" (Canadian/bilingual)
  {
    key: "totalSugars",
    pattern:
      /(?:total\s+sugars?|sugars?|sucres?)\b[\s/a-zéè]*?<?(\d[\d.]*)\s*g/i,
  },
  {
    key: "protein",
    pattern: /(?:protein|prot[ée]ines?)\b[\s/a-zéè]*?<?(\d[\d.]*)\s*g/i,
  },
];
```

Note: capturing `(\d[\d.]*)` before the unit (instead of `\S+?`) lets the bilingual `[\s/a-zéè]*?` bridge skip the "/ Lipides" half and land on the number; the existing `fixOCRDigits`/`extractNumber` still apply.

- [ ] **Step 5: Run to verify pass + no regression**

Run: `npx vitest run client/lib/__tests__/nutrition-ocr-parser.test.ts`
Expected: PASS (all Canadian + US cases).
Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add client/lib/nutrition-ocr-parser.ts client/lib/__tests__/nutrition-ocr-parser.test.ts
git commit -m "feat(scan): parse Canadian/bilingual nutrition labels (Per mL, Sucres/Sugars)"
```

---

## Task 2: `buildLabelConflict` — pure compare + merge

**Files:**

- Create: `server/services/label-override.ts`
- Create: `server/services/__tests__/label-override.test.ts`
- Modify: `server/services/barcode-lookup.ts` — change `function parseServingGrams` to `export function parseServingGrams`

**Interfaces:**

- Consumes: `BarcodeLookupResult`, `BarcodePer100g`, `scaleNutrients`, `parseServingGrams` from `./barcode-lookup`.
- Produces:

  ```ts
  export interface LabelNutritionInput {
    calories: number | null;
    totalSugars: number | null;
    totalFat: number | null;
    saturatedFat: number | null;
    servingSize: string | null;
  }
  export type ConflictField = "calories" | "sugar" | "fat";
  export interface LabelConflict {
    conflict: boolean;
    fields: ConflictField[];
    labelResult?: BarcodeLookupResult; // present iff conflict === true
  }
  export function buildLabelConflict(
    dbResult: BarcodeLookupResult,
    label: LabelNutritionInput,
  ): LabelConflict;
  ```

  Merge rule for `labelResult`: `per100g = { ...dbResult.per100g, <label-read fields normalized to per-100g> }`; `perServing = scaleNutrients(mergedPer100g, labelGrams/100)`; `servingInfo.grams = labelGrams`, `isServingDataTrusted = true`; all OFF enrichment (`novaGroup`/`nutriScore`/`categoriesTags`/`additivesTags`/`caffeine`) copied from `dbResult`.

- [ ] **Step 1: Write failing tests** — `server/services/__tests__/label-override.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildLabelConflict,
  type LabelNutritionInput,
} from "../label-override";
import type { BarcodeLookupResult } from "../barcode-lookup";

// DB result shaped like OFF's wrong Cherry Coke entry (per-100 ml).
function cherryCokeDb(): BarcodeLookupResult {
  return {
    productName: "Cherry Coke",
    barcode: "06772408",
    per100g: { calories: 11.11, sugar: 3.09, fat: 0, caffeine: undefined },
    perServing: { calories: 39, sugar: 11, fat: 0 },
    servingInfo: { displayLabel: "355 ml", grams: 355, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts+self-consistent",
    allergenDataAvailable: true,
    novaGroup: 4,
    categoriesTags: ["en:colas", "en:beverages"],
  };
}

const goodLabel: LabelNutritionInput = {
  calories: 150,
  totalSugars: 39,
  totalFat: 0,
  saturatedFat: null,
  servingSize: "355 mL",
};

it("flags a conflict on calories AND sugar for the Cherry Coke case", () => {
  const r = buildLabelConflict(cherryCokeDb(), goodLabel);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(expect.arrayContaining(["calories", "sugar"]));
});

it("label result is a TRUSTED per-serving entry with servingGrams from the label", () => {
  const { labelResult } = buildLabelConflict(cherryCokeDb(), goodLabel);
  expect(labelResult).toBeDefined();
  expect(labelResult!.isServingDataTrusted).toBe(true);
  expect(labelResult!.servingInfo.grams).toBe(355);
  // per-serving sugar comes back to ~39 (label value), per-100 ml ~11
  expect(labelResult!.perServing.sugar).toBeCloseTo(39, 0);
  expect(labelResult!.per100g.sugar).toBeCloseTo(11, 0);
});

it("keeps OFF-only enrichment from the DB on the label result", () => {
  const { labelResult } = buildLabelConflict(cherryCokeDb(), goodLabel);
  expect(labelResult!.novaGroup).toBe(4);
  expect(labelResult!.categoriesTags).toEqual(["en:colas", "en:beverages"]);
});

it("no conflict when the label agrees within 25%", () => {
  const db = cherryCokeDb();
  db.per100g = { calories: 42, sugar: 11, fat: 0 };
  db.perServing = { calories: 149, sugar: 39, fat: 0 };
  expect(buildLabelConflict(db, goodLabel).conflict).toBe(false);
});

it("no conflict (not comparable) when the label serving is unparseable", () => {
  const r = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    servingSize: "1 bottle",
  });
  expect(r.conflict).toBe(false);
  expect(r.labelResult).toBeUndefined();
});

it("presence gate: no conflict when calories or all macros are unread", () => {
  const noCals = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    calories: null,
  });
  expect(noCals.conflict).toBe(false);
  const noMacros = buildLabelConflict(cherryCokeDb(), {
    calories: 150,
    totalSugars: null,
    totalFat: null,
    saturatedFat: null,
    servingSize: "355 mL",
  });
  expect(noMacros.conflict).toBe(false);
});

it("compares only fields the OCR read (sugar-only disagreement still conflicts)", () => {
  const label: LabelNutritionInput = {
    calories: 12,
    totalSugars: 39,
    totalFat: null,
    saturatedFat: null,
    servingSize: "355 mL",
  }; // calories agree (~11 vs 12 per-100), sugar disagrees
  const r = buildLabelConflict(cherryCokeDb(), label);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["sugar"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/services/__tests__/label-override.test.ts`
Expected: FAIL — `buildLabelConflict` is not defined.

- [ ] **Step 3: Export `parseServingGrams`.** In `server/services/barcode-lookup.ts` line ~182 change `function parseServingGrams(` to `export function parseServingGrams(`.

- [ ] **Step 4: Implement `server/services/label-override.ts`:**

```ts
import type { BarcodeLookupResult, BarcodePer100g } from "./barcode-lookup";
import { parseServingGrams, scaleNutrients } from "./barcode-lookup";

export interface LabelNutritionInput {
  calories: number | null;
  totalSugars: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  servingSize: string | null;
}

export type ConflictField = "calories" | "sugar" | "fat";

export interface LabelConflict {
  conflict: boolean;
  fields: ConflictField[];
  labelResult?: BarcodeLookupResult;
}

/** Relative-difference threshold (25%) and an absolute floor to ignore
 *  rounding noise on near-zero values. Tunable. */
const REL_THRESHOLD = 0.25;
const ABS_FLOOR = 2; // kcal or g — below this on BOTH sides, skip the field

function differs(a: number, b: number): boolean {
  if (a <= ABS_FLOOR && b <= ABS_FLOOR) return false;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-6);
  return Math.abs(a - b) / denom > REL_THRESHOLD;
}

/**
 * Compare a scanned label against the DB result and, on a material conflict,
 * build a label-corrected result. Pure — no I/O. The label is per-serving; it
 * is normalized to per-100 using the label's own parsed serving grams.
 */
export function buildLabelConflict(
  dbResult: BarcodeLookupResult,
  label: LabelNutritionInput,
): LabelConflict {
  const none: LabelConflict = { conflict: false, fields: [] };

  // Presence gate: need calories + at least one comparable macro.
  const hasCalories = label.calories != null;
  const hasMacro = label.totalSugars != null || label.totalFat != null;
  if (!hasCalories || !hasMacro) return none;

  // Comparable only if the label serving parses to grams/ml.
  const labelGrams = label.servingSize
    ? parseServingGrams(label.servingSize)
    : null;
  if (labelGrams == null || labelGrams <= 0) return none;
  const factor = 100 / labelGrams;

  // Normalize the label's per-serving reads to per-100.
  const per100: Partial<
    Record<"calories" | "sugar" | "fat" | "saturatedFat", number>
  > = {};
  if (label.calories != null) per100.calories = label.calories * factor;
  if (label.totalSugars != null) per100.sugar = label.totalSugars * factor;
  if (label.totalFat != null) per100.fat = label.totalFat * factor;
  if (label.saturatedFat != null)
    per100.saturatedFat = label.saturatedFat * factor;

  // Compare the read fields against the DB per-100.
  const fields: ConflictField[] = [];
  const cmp: Array<[ConflictField, number | undefined, number | undefined]> = [
    ["calories", per100.calories, dbResult.per100g.calories],
    ["sugar", per100.sugar, dbResult.per100g.sugar],
    ["fat", per100.fat, dbResult.per100g.fat],
  ];
  for (const [name, labelVal, dbVal] of cmp) {
    if (labelVal != null && dbVal != null && differs(labelVal, dbVal))
      fields.push(name);
  }
  if (fields.length === 0) return none;

  // Build the label-corrected result: label macros over the DB per-100, keep
  // all OFF enrichment, mark serving trusted so evaluateUniversalFlags gets the
  // per-portion path.
  const mergedPer100g: BarcodePer100g = { ...dbResult.per100g, ...per100 };
  const labelResult: BarcodeLookupResult = {
    ...dbResult,
    per100g: mergedPer100g,
    perServing: scaleNutrients(mergedPer100g, labelGrams / 100),
    servingInfo: {
      displayLabel: label.servingSize ?? `${labelGrams}g`,
      grams: labelGrams,
      wasCorrected: false,
    },
    isServingDataTrusted: true,
    source: `${dbResult.source}+label`,
  };

  return { conflict: true, fields, labelResult };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run server/services/__tests__/label-override.test.ts`
Expected: PASS (all cases).
Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add server/services/label-override.ts server/services/__tests__/label-override.test.ts server/services/barcode-lookup.ts
git commit -m "feat(scan): pure label-vs-DB conflict + merge (buildLabelConflict)"
```

---

## Task 3: POST barcode route with two-result response

**Files:**

- Modify: `server/routes/nutrition.ts` (extract a flag-build helper; add the POST handler)
- Test: `server/routes/__tests__/nutrition.test.ts`

**Interfaces:**

- Consumes: `buildLabelConflict`, `LabelNutritionInput` (Task 2); `lookupBarcode`, `buildScanResponseFlags`, `evaluateUniversalFlags` (existing).
- Produces: `POST /api/nutrition/barcode/:code` returning today's GET body plus, on conflict:
  `conflict: { fields: ConflictField[]; label: <client result with its own flags[]> }`.

- [ ] **Step 1: Write failing tests** — add to `server/routes/__tests__/nutrition.test.ts` (mirror the existing GET barcode tests' harness — same `lookupBarcode` mock + supertest app):

```ts
describe("POST /api/nutrition/barcode/:code (label override)", () => {
  it("returns a conflict with a label result whose flags include High-in-Sugar", async () => {
    mockLookup.mockResolvedValue(cherryCokeDbResult()); // per-100 11.11 kcal / 3.09 sugar, nova 4, en:colas
    const res = await authedPost("/api/nutrition/barcode/06772408", {
      labelNutrition: {
        calories: 150,
        totalSugars: 39,
        totalFat: 0,
        saturatedFat: null,
        servingSize: "355 mL",
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.conflict.fields).toEqual(
      expect.arrayContaining(["calories", "sugar"]),
    );
    const labelFlagIds = res.body.conflict.label.flags.map(
      (f: { id: string }) => f.id,
    );
    expect(labelFlagIds).toContain("nutrient:sugar"); // High in Sugar now fires
    expect(labelFlagIds).toContain("processing:ultra"); // NOVA-4 retained from DB
    expect(res.body.conflict.label.servingInfo.grams).toBe(355);
  });

  it("strips ODbL fields (categoriesTags/additivesTags) on BOTH branches", async () => {
    mockLookup.mockResolvedValue(cherryCokeDbResult());
    const res = await authedPost("/api/nutrition/barcode/06772408", {
      labelNutrition: {
        calories: 150,
        totalSugars: 39,
        totalFat: 0,
        saturatedFat: null,
        servingSize: "355 mL",
      },
    });
    expect(res.body.categoriesTags).toBeUndefined();
    expect(res.body.conflict.label.categoriesTags).toBeUndefined();
    expect(res.body.conflict.label.additivesTags).toBeUndefined();
  });

  it("no conflict key when the label agrees (today's shape)", async () => {
    mockLookup.mockResolvedValue(correctCokeDbResult()); // per-100 ~42 kcal / ~11 sugar
    const res = await authedPost("/api/nutrition/barcode/06772408", {
      labelNutrition: {
        calories: 150,
        totalSugars: 39,
        totalFat: 0,
        saturatedFat: null,
        servingSize: "355 mL",
      },
    });
    expect(res.body.conflict).toBeUndefined();
  });

  it("rejects a malformed labelNutrition body (zod 400)", async () => {
    const res = await authedPost("/api/nutrition/barcode/06772408", {
      labelNutrition: { calories: "lots" },
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/routes/__tests__/nutrition.test.ts`
Expected: FAIL — POST route 404s / not defined.

- [ ] **Step 3: Extract a shared response builder.** In `server/routes/nutrition.ts`, factor the flag-build + ODbL-strip (currently inline at lines ~133–203) into a module-level helper so GET and POST share it (DRY):

```ts
// Builds the client response body for one BarcodeLookupResult: allergen +
// universal flags, ODbL strip, verification fields. Used by GET and POST.
function buildBarcodeResponseBody(
  result: BarcodeLookupResult,
  profileOutcome: ProfileOutcome,
  verification: Awaited<ReturnType<typeof storage.getVerification>>,
) {
  const flags = buildScanResponseFlags(
    {
      allergenTags: result.allergenTags ?? [],
      ingredientsText: result.ingredientsText ?? null,
      allergenDataAvailable: result.allergenDataAvailable,
    },
    profileOutcome,
  );
  const universalFlags = evaluateUniversalFlags({
    per100g: {
      sugar: result.per100g.sugar,
      saturatedFat: result.per100g.saturatedFat,
      sodium: result.per100g.sodium,
      caffeine: result.per100g.caffeine,
    },
    perServing: result.isServingDataTrusted
      ? {
          sugar: result.perServing.sugar,
          saturatedFat: result.perServing.saturatedFat,
          sodium: result.perServing.sodium,
          caffeine: result.perServing.caffeine,
        }
      : undefined,
    servingGrams: result.servingInfo.grams,
    categoriesTags: result.categoriesTags ?? [],
    novaGroup: result.novaGroup,
    nutriScore: result.nutriScore,
    additivesTags: result.additivesTags ?? [],
    ingredientsText: result.ingredientsText ?? null,
  });
  const orderedFlags = [...flags, ...universalFlags];
  const {
    ingredientsText: _i,
    allergenTags: _a,
    allergenDataAvailable: _ad,
    additivesTags: _at,
    categoriesTags: _ct,
    ...clientResult
  } = result;
  void _i;
  void _a;
  void _ad;
  void _at;
  void _ct;
  return {
    ...clientResult,
    flags: orderedFlags,
    verificationLevel: verification?.verificationLevel ?? "unverified",
    verificationCount: verification?.verificationCount ?? 0,
  };
}
```

Then replace the GET handler's inline body-building (lines ~133–203) with `const body = buildBarcodeResponseBody(result, profileOutcome, verification); res.json(body);` — behavior identical.

- [ ] **Step 4: Add the POST handler** after the GET registration, reusing the same auth + rate limiter and a zod body schema:

```ts
const labelNutritionSchema = z.object({
  labelNutrition: z.object({
    calories: z.number().finite().nullable(),
    totalSugars: z.number().finite().nullable(),
    totalFat: z.number().finite().nullable(),
    saturatedFat: z.number().finite().nullable(),
    servingSize: z.string().max(120).nullable(),
  }),
});

app.post(
  "/api/nutrition/barcode/:code",
  requireAuth,
  nutritionLookupRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    const rawCode = req.params.code;
    const code = typeof rawCode === "string" ? rawCode.trim() : "";
    if (!code || code.length > 50 || !/^\d+$/.test(code)) {
      sendError(res, 400, "Invalid barcode", ErrorCode.VALIDATION_ERROR);
      return;
    }
    const parsed = labelNutritionSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, "Invalid label data", ErrorCode.VALIDATION_ERROR);
      return;
    }
    try {
      const [result, verification, profileOutcome] = await Promise.all([
        lookupBarcode(code),
        storage.getVerification(code),
        storage.getUserProfile(req.userId).then(
          (profile): ProfileOutcome => ({
            ok: true,
            allergies: parseUserAllergies(profile?.allergies),
          }),
          (err): ProfileOutcome => {
            logger.warn(
              { err: toError(err) },
              "scan-flags: profile read failed",
            );
            return { ok: false };
          },
        ),
      ]);
      if (!result) {
        sendError(res, 404, "Product not found", ErrorCode.NOT_FOUND);
        return;
      }

      const body = buildBarcodeResponseBody(
        result,
        profileOutcome,
        verification,
      );
      const { conflict, fields, labelResult } = buildLabelConflict(
        result,
        parsed.data.labelNutrition,
      );
      if (conflict && labelResult) {
        const labelBody = buildBarcodeResponseBody(
          labelResult,
          profileOutcome,
          verification,
        );
        res.json({ ...body, conflict: { fields, label: labelBody } });
        return;
      }
      res.json(body);
    } catch (error) {
      handleRouteError(res, error, "look up barcode");
    }
  },
);
```

Add imports at the top: `import { z } from "zod";` (if not already present) and `import { buildLabelConflict } from "../services/label-override";`.

- [ ] **Step 5: Run to verify pass + type check**

Run: `npx vitest run server/routes/__tests__/nutrition.test.ts`
Expected: PASS (POST cases + existing GET cases unchanged).
Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add server/routes/nutrition.ts server/routes/__tests__/nutrition.test.ts
git commit -m "feat(scan): POST barcode route returns label-corrected result on conflict"
```

---

## Task 4: Thread OCR text through navigation

**Files:**

- Modify: `client/navigation/RootStackNavigator.tsx` (line ~90, `NutritionDetail` params)
- Modify: `client/screens/ScanScreen.tsx` (session-complete effect, line ~215/249)
- Test: `client/camera/reducers/__tests__/scan-phase-reducer.test.ts` already covers the reducer carrying `ocrText`; add a focused ScanScreen navigation assertion where the screen test harness exists, else assert via a small extracted helper (below).

**Interfaces:**

- Produces: `NutritionDetail` route param `ocrText?: string`, forwarded from `SESSION_COMPLETE`.

- [ ] **Step 1: Add the param.** In `client/navigation/RootStackNavigator.tsx`:

```ts
  NutritionDetail: {
    barcode?: string;
    imageUri?: string;
    itemId?: number;
    ocrText?: string; // STEP2 nutrition-label OCR, for label-vs-DB override
  };
```

- [ ] **Step 2: Forward it from ScanScreen.** In `client/screens/ScanScreen.tsx`, the non-`returnAfterLog` session-complete branch (line ~247–252) currently navigates with `{ barcode }`. `scanPhase` at `SESSION_COMPLETE` carries `ocrText` when a nutrition label was captured (see `scan-phase-reducer.ts`). Change to:

```ts
const timer = setTimeout(() => {
  void refreshScanCount();
  navigation.navigate("NutritionDetail", {
    barcode,
    // Present only when a STEP2 nutrition-label photo was captured; the
    // detail screen parses it for label-vs-DB override. `undefined` on a
    // barcode-only scan → unchanged behavior.
    ocrText: "ocrText" in scanPhase ? scanPhase.ocrText : undefined,
  });
}, 700);
```

(`barcode` is already destructured at line ~215; keep using the same `scanPhase`.)

- [ ] **Step 3: Type-check + existing tests**

Run: `npx tsc --noEmit`
Expected: no new errors (the `"ocrText" in scanPhase` narrows the union safely).
Run: `npx vitest run client/camera/reducers/__tests__/scan-phase-reducer.test.ts`
Expected: PASS (unchanged — confirms `ocrText` is present at `SESSION_COMPLETE`).

- [ ] **Step 4: Commit**

```bash
git add client/navigation/RootStackNavigator.tsx client/screens/ScanScreen.tsx
git commit -m "feat(scan): forward nutrition-label OCR text to NutritionDetail"
```

---

## Task 5: `useNutritionLookup` — parse label, POST on presence, expose conflict

**Files:**

- Modify: `client/hooks/useNutritionLookup.ts`
- Test: `client/hooks/__tests__/useNutritionLookup.test.ts` (mirror `client/hooks/__tests__/useQuickLogSession.test.ts` harness — `renderHook` + a `fetch`/`apiRequest` mock)

**Interfaces:**

- Consumes: `parseNutritionFromOCR` (Task 1); POST endpoint + `conflict` shape (Task 3); `ocrText` param (Task 4).
- Produces: hook accepts `ocrText?: string`; returns added fields:

  ```ts
  conflict: { fields: string[]; labelNutrition: NutritionData; labelFlags: ScanFlag[] } | null;
  activeSource: "database" | "label";
  chooseSource: (s: "database" | "label") => void;
  dbNutrition: NutritionData | null; // the "Database" column source for the prompt
  ```

  When `activeSource === "label"`, `nutrition` and `flags` reflect the label result.

- [ ] **Step 1: Write failing tests** — `client/hooks/__tests__/useNutritionLookup.test.ts`:

```ts
// POSTs labelNutrition when the parsed label passes the presence gate
it("POSTs to the barcode endpoint with labelNutrition when the label is readable", async () => {
  const fetchSpy = mockBarcodeFetch({
    /* db body, no conflict */
  });
  renderHook(() =>
    useNutritionLookup({
      barcode: "06772408",
      ocrText: "Per 355 mL\nCalories 150\nSugars / Sucres 39 g",
    }),
  );
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  const call = fetchSpy.mock.calls.at(-1)!;
  expect(call[1]?.method).toBe("POST");
  expect(JSON.parse(call[1]!.body as string).labelNutrition.totalSugars).toBe(
    39,
  );
});

// GET (no body) when there is no label / it fails the presence gate
it("GETs (no POST) when ocrText is absent or unreadable", async () => {
  const fetchSpy = mockBarcodeFetch({
    /* db body */
  });
  renderHook(() =>
    useNutritionLookup({ barcode: "06772408", ocrText: "blurry nothing" }),
  );
  await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  expect(fetchSpy.mock.calls.at(-1)![1]?.method ?? "GET").toBe("GET");
});

// conflict surfaces; toggling swaps the active result
it("exposes conflict and toggles nutrition+flags between DB and label", async () => {
  mockBarcodeFetch({
    productName: "Cherry Coke",
    perServing: { calories: 39 },
    flags: [{ id: "processing:ultra" }],
    conflict: {
      fields: ["sugar"],
      label: {
        productName: "Cherry Coke",
        perServing: { calories: 150 },
        flags: [{ id: "processing:ultra" }, { id: "nutrient:sugar" }],
      },
    },
  });
  const { result } = renderHook(() =>
    useNutritionLookup({
      barcode: "06772408",
      ocrText: "Per 355 mL\nCalories 150\nSugars / Sucres 39 g",
    }),
  );
  await waitFor(() => expect(result.current.conflict).not.toBeNull());
  // defaults to label (health-facing default)
  expect(result.current.activeSource).toBe("label");
  expect(result.current.nutrition?.calories).toBe(150);
  expect(result.current.flags.map((f) => f.id)).toContain("nutrient:sugar");
  act(() => result.current.chooseSource("database"));
  expect(result.current.nutrition?.calories).toBe(39);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run client/hooks/__tests__/useNutritionLookup.test.ts`
Expected: FAIL — `conflict`/`activeSource`/`chooseSource` undefined; POST not sent.

- [ ] **Step 3: Implement.** In `client/hooks/useNutritionLookup.ts`:

(a) accept the new param:

```ts
export function useNutritionLookup(params: {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
  ocrText?: string;
}) {
  const { barcode, imageUri, itemId, ocrText } = params;
```

(b) add state (near the other `useState`s):

```ts
const [conflict, setConflict] = useState<{
  fields: string[];
  labelNutrition: NutritionData;
  labelFlags: ScanFlag[];
} | null>(null);
const [dbSnapshot, setDbSnapshot] = useState<{
  nutrition: NutritionData;
  flags: ScanFlag[];
} | null>(null);
const [activeSource, setActiveSource] = useState<"database" | "label">(
  "database",
);
```

(c) In `fetchBarcodeData`, when `ocrText` is present, parse it and — if it passes the presence gate — issue a POST instead of GET. Replace the `const serverRes = await fetch(url, { headers });` line with:

```ts
const parsedLabel = ocrText ? parseNutritionFromOCR(ocrText) : null;
const labelReady =
  parsedLabel != null &&
  parsedLabel.calories != null &&
  (parsedLabel.totalSugars != null || parsedLabel.totalFat != null) &&
  parsedLabel.servingSize != null;

const serverRes = labelReady
  ? await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        labelNutrition: {
          calories: parsedLabel!.calories,
          totalSugars: parsedLabel!.totalSugars,
          totalFat: parsedLabel!.totalFat,
          saturatedFat: parsedLabel!.saturatedFat,
          servingSize: parsedLabel!.servingSize,
        },
      }),
    })
  : await fetch(url, { headers });
```

(d) In the OK branch, the code currently calls `setNutrition({ productName: data.productName, … })` inline (lines ~250–269). Refactor that inline object into a named `const dbNutrition` so it can be reused for both `setNutrition` and the DB snapshot, then capture the snapshot and handle conflict:

```ts
const dbNutrition: NutritionData = {
  productName: data.productName,
  brandName: data.brandName,
  servingSize: data.servingInfo.displayLabel,
  calories: data.perServing.calories,
  protein: data.perServing.protein,
  carbs: data.perServing.carbs,
  fat: data.perServing.fat,
  fiber: data.perServing.fiber,
  sugar: data.perServing.sugar,
  sodium: data.perServing.sodium,
  saturatedFat: data.perServing.saturatedFat,
  transFat: data.perServing.transFat,
  cholesterol: data.perServing.cholesterol,
  caffeine: data.perServing.caffeine,
  imageUrl: data.imageUrl,
  barcode: code,
  novaGroup: data.novaGroup,
  nutriScore: data.nutriScore,
};
setNutrition(dbNutrition);
setFlags(Array.isArray(data.flags) ? (data.flags as ScanFlag[]) : []);
// Capture the DB result so a later toggle can restore it.
setDbSnapshot({
  nutrition: dbNutrition,
  flags: Array.isArray(data.flags) ? data.flags : [],
});

if (data.conflict?.label) {
  const lbl = data.conflict.label;
  const labelNutrition: NutritionData = {
    productName: lbl.productName,
    brandName: lbl.brandName,
    servingSize: lbl.servingInfo.displayLabel,
    calories: lbl.perServing.calories,
    protein: lbl.perServing.protein,
    carbs: lbl.perServing.carbs,
    fat: lbl.perServing.fat,
    fiber: lbl.perServing.fiber,
    sugar: lbl.perServing.sugar,
    sodium: lbl.perServing.sodium,
    saturatedFat: lbl.perServing.saturatedFat,
    transFat: lbl.perServing.transFat,
    cholesterol: lbl.perServing.cholesterol,
    caffeine: lbl.perServing.caffeine,
    imageUrl: lbl.imageUrl,
    barcode: code,
    novaGroup: lbl.novaGroup,
    nutriScore: lbl.nutriScore,
  };
  const labelFlags: ScanFlag[] = Array.isArray(lbl.flags) ? lbl.flags : [];
  setConflict({
    fields: data.conflict.fields ?? [],
    labelNutrition,
    labelFlags,
  });
  // Health-facing default: trust the label.
  setActiveSource("label");
  setNutrition(labelNutrition);
  setFlags(labelFlags);
}
```

(e) add `chooseSource` and export the new fields:

```ts
const chooseSource = useCallback(
  (s: "database" | "label") => {
    setActiveSource(s);
    if (s === "label" && conflict) {
      setNutrition(conflict.labelNutrition);
      setFlags(conflict.labelFlags);
    } else if (s === "database" && dbSnapshot) {
      setNutrition(dbSnapshot.nutrition);
      setFlags(dbSnapshot.flags);
    }
  },
  [conflict, dbSnapshot],
);
```

Add to the returned object: `conflict`, `activeSource`, `chooseSource`, and `dbNutrition: dbSnapshot?.nutrition ?? null` (the "Database" column source for the prompt). Add `ocrText` to `fetchBarcodeData`'s `useCallback` deps.

Add the import: `import { parseNutritionFromOCR } from "@/lib/nutrition-ocr-parser";`

- [ ] **Step 4: Run to verify pass + type check**

Run: `npx vitest run client/hooks/__tests__/useNutritionLookup.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useNutritionLookup.ts client/hooks/__tests__/useNutritionLookup.test.ts
git commit -m "feat(scan): useNutritionLookup POSTs label, exposes DB/label conflict toggle"
```

---

## Task 6: Conflict prompt UI on the detail screen

**Files:**

- Create: `client/components/ScanConflictPrompt.tsx`
- Create: `client/components/__tests__/ScanConflictPrompt.test.tsx`
- Modify: `client/screens/NutritionDetailScreen.tsx` (consume `conflict`/`activeSource`/`chooseSource`, render the prompt)

**Interfaces:**

- Consumes: `useNutritionLookup`'s `conflict`, `activeSource`, `chooseSource`, `dbNutrition` (Task 5); `useTheme` (`@/theme`, existing).
- Produces: `<ScanConflictPrompt conflictFields={string[]} labelNutrition={NutritionData} dbNutrition={NutritionData} activeSource="database"|"label" onChoose={(s)=>void} />`.

- [ ] **Step 1: Write failing UI tests** — `client/components/__tests__/ScanConflictPrompt.test.tsx` (use `renderComponent` from `test/utils/render-component`, per project convention — NOT `@testing-library/react-native`):

```tsx
import { renderComponent } from "@/test/utils/render-component";
import { fireEvent } from "@testing-library/react-native";
import { ScanConflictPrompt } from "@/components/ScanConflictPrompt";

const db = { productName: "Cherry Coke", calories: 39, sugar: 11 } as any;
const label = { productName: "Cherry Coke", calories: 150, sugar: 39 } as any;

it("renders both values for each conflicting field, label selected by default", () => {
  const { getByText, getByLabelText } = renderComponent(
    <ScanConflictPrompt
      conflictFields={["calories", "sugar"]}
      labelNutrition={label}
      dbNutrition={db}
      activeSource="label"
      onChoose={() => {}}
    />,
  );
  expect(getByText("150")).toBeTruthy(); // label calories
  expect(getByText("39")).toBeTruthy(); // db calories (also label sugar)
  // label option announces selection for screen readers
  expect(getByLabelText(/label.*selected/i)).toBeTruthy();
});

it("calls onChoose('database') when the database option is tapped", () => {
  const onChoose = vi.fn();
  const { getByLabelText } = renderComponent(
    <ScanConflictPrompt
      conflictFields={["calories"]}
      labelNutrition={label}
      dbNutrition={db}
      activeSource="label"
      onChoose={onChoose}
    />,
  );
  fireEvent.press(getByLabelText(/use database/i));
  expect(onChoose).toHaveBeenCalledWith("database");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run client/components/__tests__/ScanConflictPrompt.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `client/components/ScanConflictPrompt.tsx`** (reuse LabelAnalysis card styling idioms — `useTheme`, `withOpacity`; two selectable columns; a11y labels per field and per option):

```tsx
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "@/theme";

const FIELD_LABEL: Record<string, string> = {
  calories: "Calories",
  sugar: "Sugar (g)",
  fat: "Fat (g)",
};
type Source = "database" | "label";
type NutritionLike = Record<string, number | string | undefined>;

export function ScanConflictPrompt(props: {
  conflictFields: string[];
  labelNutrition: NutritionLike;
  dbNutrition: NutritionLike;
  activeSource: Source;
  onChoose: (s: Source) => void;
}) {
  const theme = useTheme();
  const {
    conflictFields,
    labelNutrition,
    dbNutrition,
    activeSource,
    onChoose,
  } = props;

  const Column = ({
    source,
    title,
    data,
  }: {
    source: Source;
    title: string;
    data: NutritionLike;
  }) => {
    const selected = activeSource === source;
    const rows = conflictFields
      .map((f) => `${FIELD_LABEL[f] ?? f} ${data[f] ?? "—"}`)
      .join(", ");
    return (
      <Pressable
        onPress={() => onChoose(source)}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`Use ${title}: ${rows}. ${selected ? "Selected" : "Not selected"}`}
        style={[
          styles.col,
          {
            borderColor: selected ? theme.primary : theme.border,
            backgroundColor: selected
              ? theme.primarySurface
              : theme.backgroundDefault,
          },
        ]}
      >
        <Text style={[styles.colTitle, { color: theme.text }]}>{title}</Text>
        {conflictFields.map((f) => (
          <Text key={f} style={{ color: theme.textSecondary }}>
            {FIELD_LABEL[f] ?? f}:{" "}
            <Text style={{ color: theme.text }}>{String(data[f] ?? "—")}</Text>
          </Text>
        ))}
      </Pressable>
    );
  };

  return (
    <View
      style={[styles.card, { backgroundColor: theme.backgroundElevated }]}
      accessibilityRole="summary"
      accessibilityLabel="The scanned label differs from our database. Choose which to use."
    >
      <Text style={[styles.heading, { color: theme.text }]}>
        The label you scanned differs from our database
      </Text>
      <View style={styles.row}>
        <Column
          source="label"
          title="Label (your photo)"
          data={labelNutrition}
        />
        <Column source="database" title="Database" data={dbNutrition} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, marginBottom: 16, gap: 12 },
  heading: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
  col: { flex: 1, borderWidth: 2, borderRadius: 10, padding: 12, gap: 4 },
  colTitle: { fontWeight: "600", marginBottom: 4 },
});
```

(If a theme token name here — `primarySurface`, `backgroundElevated`, `border` — differs from the project's `theme.ts`, use the nearest existing token; do NOT add brand hex. Verify against `client/theme/theme.ts`.)

- [ ] **Step 4: Wire it into `NutritionDetailScreen`.** Pull `conflict`, `activeSource`, `chooseSource` from `useNutritionLookup`, and render the prompt above the nutrition content when `conflict` is set:

```tsx
const { /* …existing… */ conflict, activeSource, chooseSource, dbNutrition } =
  useNutritionLookup({
    barcode,
    imageUri,
    itemId,
    ocrText: route.params?.ocrText,
  });
// …in the scroll body, above the macro rows:
{
  conflict && dbNutrition && (
    <ScanConflictPrompt
      conflictFields={conflict.fields}
      labelNutrition={
        conflict.labelNutrition as unknown as Record<
          string,
          number | string | undefined
        >
      }
      dbNutrition={
        dbNutrition as unknown as Record<string, number | string | undefined>
      }
      activeSource={activeSource}
      onChoose={chooseSource}
    />
  );
}
```

Import `ScanConflictPrompt` from `@/components/ScanConflictPrompt` and add `ocrText: route.params?.ocrText` to the hook call. `dbNutrition` comes from Task 5's hook return (the DB snapshot), so the "Database" column always shows the un-toggled database values regardless of `activeSource`.

- [ ] **Step 5: Run to verify pass + type check**

Run: `npx vitest run client/components/__tests__/ScanConflictPrompt.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add client/components/ScanConflictPrompt.tsx client/components/__tests__/ScanConflictPrompt.test.tsx client/screens/NutritionDetailScreen.tsx client/hooks/useNutritionLookup.ts
git commit -m "feat(scan): conflict prompt — choose scanned label over database, default label"
```

---

## Definition of Done

- All six tasks committed; each task's targeted vitest + `tsc --noEmit` green.
- The Cherry Coke path works end-to-end in tests: a Canadian-label OCR string ("Per 355 mL / Calories 150 / Sugars / Sucres 39 g") against the wrong-OFF DB entry → POST returns a conflict → label result carries `servingGrams: 355`, trusted, and `nutrient:sugar` (High in Sugar) while retaining `processing:ultra` + caffeine from the DB → client defaults to the label and can toggle back.
- ODbL: no `categoriesTags`/`additivesTags` on either response branch.
- No premium gating; all flags `tier: "nutrition"`.
- Whole-branch review + `/codify` after execution (per the project workflow).

## Follow-ups (explicitly out of v1)

- Barcode in NO database but label read cleanly → use the label directly (seam left in `useNutritionLookup`'s 404 branch).
- `returnAfterLog` confirm-card parity (surface the conflict there too).
- Sodium/sat-fat comparison + correction (v1 merges them when read but compares only calories/sugar/fat; mg-unit handling for sodium deserves its own test).
- On-device OCR reliability on curved/bilingual cans (device testing, not code).
