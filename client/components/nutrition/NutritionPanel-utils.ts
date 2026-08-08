/**
 * Presentation vocabulary for NutritionPanel's rows — pure, no React.
 *
 * Everything a row needs to render and to announce derives from here, so the
 * visible tag and the spoken label cannot drift apart: `composeNutrientRowLabel`
 * takes the SAME tag string the row displays.
 */
import type {
  ConcernBand,
  BenefitBand,
  ConcernNutrient,
  BenefitNutrient,
} from "@shared/lib/nutrition-bands";
import {
  HIGH_SEVERITY_VISUALS,
  MEDIUM_SEVERITY_VISUALS,
  CONCERN_LOW_VISUALS,
  BENEFIT_VISUALS,
  BENEFIT_NONE_VISUALS,
  type BadgeSeverityVisuals,
} from "@/components/badge-severity-visuals";
import type { NutritionPer100g } from "@/lib/serving-size-utils";

/** Fields every row reads. `NutritionData` and `NutritionPer100g` share all of these. */
type NutrientField = keyof NutritionPer100g;

interface RowBase {
  /** Visible row label. */
  label: string;
  /** Rendered unit, e.g. "g". */
  unit: string;
  /** Spoken unit — a bare "g" is read as "gee" by VoiceOver. */
  spokenUnit: string;
  /**
   * The field to read on the value source. Deliberately separate from `key`:
   * the band layer spells it `fibre` and the data layer spells it `fiber`, and
   * one of the two has to bridge. Typed against `NutritionPer100g` rather than
   * `NutritionData` so a row can never name `productName` or `barcode`.
   */
  sourceKey: NutrientField;
}

/**
 * A discriminated union rather than one flat interface, so a banded row's
 * `key` is compiler-checked against the band layer's own nutrient names. This
 * is what lets `buildPanelRows` call `concernBand(row.key, …)` with no cast —
 * and it means adding a seventh banded row with a name the band layer does not
 * know is a compile error rather than a silently unbanded row.
 */
export type NutrientRow =
  | (RowBase & { key: ConcernNutrient; zone: "banded"; group: "concern" })
  | (RowBase & { key: BenefitNutrient; zone: "banded"; group: "benefit" })
  | (RowBase & { key: NutrientField; zone: "unbanded"; group: "none" });

export type RowZone = NutrientRow["zone"];
export type RowGroup = NutrientRow["group"];

/**
 * Fixed render order. Banded rows first (the zone the panel bands), then the
 * three with no published traffic-light threshold. Order is a display
 * decision and is independent of `pickStandouts`' tie-break order.
 */
export const NUTRIENT_ROWS = {
  sugar: {
    key: "sugar",
    sourceKey: "sugar",
    label: "Sugar",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "concern",
  },
  saturatedFat: {
    key: "saturatedFat",
    sourceKey: "saturatedFat",
    label: "Saturated fat",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "concern",
  },
  fat: {
    key: "fat",
    sourceKey: "fat",
    label: "Total fat",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "concern",
  },
  sodium: {
    key: "sodium",
    sourceKey: "sodium",
    label: "Sodium",
    unit: "mg",
    spokenUnit: "milligrams",
    zone: "banded",
    group: "concern",
  },
  fibre: {
    key: "fibre",
    sourceKey: "fiber",
    label: "Fibre",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "benefit",
  },
  protein: {
    key: "protein",
    sourceKey: "protein",
    label: "Protein",
    unit: "g",
    spokenUnit: "grams",
    zone: "banded",
    group: "benefit",
  },
  transFat: {
    key: "transFat",
    sourceKey: "transFat",
    label: "Trans fat",
    unit: "g",
    spokenUnit: "grams",
    zone: "unbanded",
    group: "none",
  },
  cholesterol: {
    key: "cholesterol",
    sourceKey: "cholesterol",
    label: "Cholesterol",
    unit: "mg",
    spokenUnit: "milligrams",
    zone: "unbanded",
    group: "none",
  },
  caffeine: {
    key: "caffeine",
    sourceKey: "caffeine",
    label: "Caffeine",
    unit: "mg",
    spokenUnit: "milligrams",
    zone: "unbanded",
    group: "none",
  },
} as const satisfies Record<string, NutrientRow>;

export type BandDescriptor =
  | { group: "concern"; band: ConcernBand }
  | { group: "benefit"; band: BenefitBand };

/**
 * Lookup tables rather than switches, deliberately. `Record<ConcernBand, …>`
 * makes a new band value a compile error AT THE TABLE; an exhaustive switch
 * with no `default` would instead fall off the end and return `undefined`
 * where `null` is expected — and this repo does not set `noImplicitReturns`,
 * so that is the shape that compiles locally and misbehaves at runtime. A
 * missing dot for a reason nobody can see is exactly the fail-silent outcome
 * safety invariant 3 exists to prevent.
 *
 * `null` means the row is unbanded: no tag AND no indicator dot.
 */
const CONCERN_TAG: Record<ConcernBand, string | null> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  unknown: null,
};

const BENEFIT_TAG: Record<BenefitBand, string | null> = {
  excellent: "EXCELLENT",
  good: "GOOD",
  none: "NONE",
  unknown: null,
};

const CONCERN_VISUALS: Record<ConcernBand, BadgeSeverityVisuals | null> = {
  high: HIGH_SEVERITY_VISUALS,
  medium: MEDIUM_SEVERITY_VISUALS,
  low: CONCERN_LOW_VISUALS,
  unknown: null,
};

const BENEFIT_BAND_VISUALS: Record<BenefitBand, BadgeSeverityVisuals | null> = {
  excellent: BENEFIT_VISUALS,
  good: BENEFIT_VISUALS,
  none: BENEFIT_NONE_VISUALS,
  unknown: null,
};

/** The non-colour channel for WCAG 1.4.1 — load-bearing text, not decoration. */
export function bandTagText(descriptor: BandDescriptor): string | null {
  return descriptor.group === "concern"
    ? CONCERN_TAG[descriptor.band]
    : BENEFIT_TAG[descriptor.band];
}

/** `null` for an unknown band — the row renders no dot and no pill. */
export function bandVisuals(
  descriptor: BandDescriptor,
): BadgeSeverityVisuals | null {
  return descriptor.group === "concern"
    ? CONCERN_VISUALS[descriptor.band]
    : BENEFIT_BAND_VISUALS[descriptor.band];
}

/** Matches the rendered value exactly — one decimal, no trailing ".0". */
function formatValue(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Spoken form of a band tag. "MED" is the only abbreviated tag — VoiceOver
 * would read it as "med", the same defect `spokenUnit` exists to prevent for
 * units. The rest are already full words and lowercase cleanly.
 */
const TAG_SPOKEN_WORD: Record<string, string> = {
  HIGH: "high",
  MED: "medium",
  LOW: "low",
  EXCELLENT: "excellent",
  GOOD: "good",
  NONE: "none",
};

function spokenTagWord(tag: string): string {
  return TAG_SPOKEN_WORD[tag] ?? tag.toLowerCase();
}

export interface RowLabelInput {
  row: NutrientRow;
  /** The DISPLAYED value. `undefined` means not recorded — never a zero. */
  value: number | undefined;
  /** The SAME tag string the row renders, so the two cannot drift. */
  tag: string | null;
}

/**
 * The row's `accessibilityLabel`. Each panel row is one `accessible` group, so
 * this is the whole of what a screen reader says about the row — the indicator
 * dot is `accessible={false}` and contributes nothing.
 */
export function composeNutrientRowLabel({
  row,
  value,
  tag,
}: RowLabelInput): string {
  if (value === undefined) return `${row.label}, not recorded`;
  const base = `${row.label}, ${formatValue(value)} ${row.spokenUnit}`;
  return tag === null ? base : `${base}, ${spokenTagWord(tag)}`;
}
