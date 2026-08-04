/**
 * Selects the values a band may be computed from, and derives the panel's rows
 * and the summary card's `NutrientBands` from that ONE selection.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * NEVER band from `nutrition`. `nutrition` is display state, and the serving
 * controls move it through TWO channels, not one:
 *   - VALUES: `recalculateNutrition` writes
 *         nutrition.sugar = per100g.sugar x (servingSizeGrams / 100) x quantity
 *     At quantity 2 the computed per-100 doubles, and picking the 100 g chip
 *     against a 30 g label serving inflates it 3.3x. Both OVER-warn, which is
 *     the direction nutrient flags must never fail in.
 *   - SCALE: on its gram branch `recalculateNutrition` ALSO overwrites
 *         nutrition.servingSize = `${grams}g`
 *     (useNutritionLookup.ts:301) — so a caller that reads only the serving
 *     STRING, not the values, can still get burned: `resolveBasis` infers
 *     food-vs-drink from the string's unit whenever `isBeverage` is null, so
 *     a rewritten "355g" flips a drink's scale to food (thresholds ~2x
 *     looser) even though its VALUES never moved. An earlier version of this
 *     module fed `nutrition.servingSize` into `resolveBasis` on the scan
 *     path on the false premise that the serving controls never rewrite it —
 *     they do, via exactly this field.
 *
 * `validatedData.per100g` (values) and `validatedData.servingInfo.displayLabel`
 * (the ORIGINAL serving string) are the un-scaled lookup payload and are both
 * invariant to the serving controls — `recalculateNutrition` never calls
 * `setValidatedData` — so together they are the only safe scan-path source.
 *
 * ── WHY THE SAVED-ITEM PATH IS DIFFERENT ──────────────────────────────────
 * There `validatedData` is null (the `existingItem` effect calls only
 * `setNutrition`), and `showServingControls` is gated on `!itemId`, so nothing
 * can scale `nutrition` — it IS the per-serving source. That safety is a
 * property of this branch, asserted by tests here, rather than an accident of
 * which components happen to render.
 *
 * ── WHAT THIS COSTS ───────────────────────────────────────────────────────
 * A serving-invariant band cannot apply the FSA per-portion HIGH override:
 * that needs the actual portion weight, which by definition moves with the
 * user's serving choice. So no `portionGrams` is passed to `concernBand`.
 * Skipping it can only fail toward under-warning, which is the established
 * direction. The server still applies the override when emitting `nutrient:*`
 * flags, but slice 2c stops rendering those, so the two never disagree on
 * screen.
 */
import {
  resolveBasis,
  concernBand,
  benefitBand,
  type Basis,
  type NutrientBands,
} from "@shared/lib/nutrition-bands";
import type { NutritionData } from "@/hooks/useNutritionLookup";
import type {
  ValidatedNutrition,
  NutritionPer100g,
} from "@/lib/serving-size-utils";
import {
  NUTRIENT_ROWS,
  type NutrientRow,
  type BandDescriptor,
} from "./NutritionPanel-utils";

export interface BandSourceInput {
  /** `undefined` = scan path, a number = saved-item path. */
  itemId: number | undefined;
  validatedData: ValidatedNutrition | null;
  nutrition: NutritionData | null;
  isBeverage: boolean | null;
}

export interface BandSource {
  /** Values on ONE consistent, un-scaled basis. Empty when unresolvable. */
  values: NutritionPer100g;
  basis: Basis;
}

export function selectBandSource(input: BandSourceInput): BandSource {
  if (input.itemId === undefined) {
    // Scan path. `nutrition` may be serving-scaled at any moment — including
    // its OWN `servingSize` field, which `recalculateNutrition` overwrites to
    // `${grams}g` on the gram branch. So the serving STRING fed to
    // `resolveBasis` must also come from `validatedData`, not from
    // `nutrition.servingSize` — `servingInfo.displayLabel` is the product's
    // original serving text and is never touched by the serving controls.
    if (!input.validatedData) return { values: {}, basis: { kind: "unknown" } };
    return {
      values: input.validatedData.per100g,
      basis: resolveBasis({
        valuesArePer100: true,
        servingSize: input.validatedData.servingInfo.displayLabel,
        isBeverage: input.isBeverage,
      }),
    };
  }

  // Saved-item path. No serving control renders, so `nutrition` — including
  // its `servingSize` field — is the un-scaled per-serving source, and
  // resolveBasis back-calculates from the stored serving string — never from
  // a `|| 100` default.
  if (!input.nutrition) return { values: {}, basis: { kind: "unknown" } };
  return {
    values: input.nutrition,
    basis: resolveBasis({
      valuesArePer100: false,
      servingSize: input.nutrition.servingSize,
      isBeverage: input.isBeverage,
    }),
  };
}

export interface PanelRowData {
  row: NutrientRow;
  /**
   * The SERVING-SCALED value the user reads, from `nutrition` — so the panel
   * agrees with the macro strip above it. `undefined` renders "Not recorded".
   */
  displayValue: number | undefined;
  /** `null` for an unbanded row (trans fat, cholesterol, caffeine). */
  band: BandDescriptor | null;
  /** From the BAND SOURCE's raw value. Never from `band === "unknown"`. */
  hasValue: boolean;
}

export interface PanelData {
  rows: PanelRowData[];
  /** The same derivation, shaped for `pickStandouts`. */
  bands: NutrientBands;
}

/**
 * One derivation, two consumers. The panel's rows' `band` and the summary
 * card's `NutrientBands` (`bands`) come out of the SAME pass over
 * `source.values`, so a row's band can never disagree with the matching
 * standout's band.
 *
 * That guarantee is about `band` <-> `bands`, NOT about `hasValue` <->
 * `displayValue`: `hasValue` reads `source.values` (the BAND source —
 * `validatedData.per100g` on the scan path) while `displayValue` always reads
 * `input.nutrition` (the display state) — two different objects on the scan
 * path. A nutrient present in one and absent from the other can in principle
 * render "Not recorded" (`displayValue` undefined) while still carrying a
 * live band (`hasValue` true). Left open for Tasks 3/4/7, which render both
 * fields.
 */
export function buildPanelRows(input: BandSourceInput): PanelData {
  const source = selectBandSource(input);
  const kcal = source.values.calories;

  const bands: NutrientBands = { concerns: {}, benefits: {} };
  const rows: PanelRowData[] = [];

  for (const row of Object.values(NUTRIENT_ROWS) as NutrientRow[]) {
    // Both reads use `sourceKey`, which is `keyof NutritionPer100g` — and
    // every one of those fields also exists on NutritionData, so the display
    // read needs no cast either.
    const sourceValue = source.values[row.sourceKey];
    const hasValue = typeof sourceValue === "number";
    const displayValue = input.nutrition?.[row.sourceKey];

    if (row.group === "concern") {
      // `row.key` is `ConcernNutrient` by the union's own discriminant — no
      // cast, and a mismatched row name would not compile.
      const band = concernBand(
        row.key,
        hasValue ? sourceValue : undefined,
        source.basis,
        // No portionGrams — see the module docblock. A portion-aware band
        // would move with the user's serving choice.
      );
      bands.concerns[row.key] = { band, hasValue };
      rows.push({
        row,
        displayValue,
        band: { group: "concern", band },
        hasValue,
      });
    } else if (row.group === "benefit") {
      const band = benefitBand(
        row.key,
        hasValue ? sourceValue : undefined,
        source.basis,
        kcal,
      );
      bands.benefits[row.key] = { band, hasValue };
      rows.push({
        row,
        displayValue,
        band: { group: "benefit", band },
        hasValue,
      });
    } else {
      // Unbanded zone: known value, no published standard to judge it against.
      // An unbanded row is NOT a green row — `band: null` renders no dot.
      rows.push({ row, displayValue, band: null, hasValue });
    }
  }

  return { rows, bands };
}
