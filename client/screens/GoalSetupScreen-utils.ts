import { parseDecimalInput } from "@/lib/number-input";
import {
  cmToInches,
  heightUnitLabel,
  kgToLbs,
  weightUnitLabel,
  type MeasurementUnit,
} from "@shared/lib/units";

export type GoalField =
  | "age"
  | "weight"
  | "height"
  | "calories"
  | "protein"
  | "carbs"
  | "fat";

interface FieldRange {
  label: string;
  min: number;
  max: number;
  /** Unit suffix in the message, e.g. "kg"; empty for unitless fields. */
  suffix: string;
  /** Whole numbers only — the API stores these as integers. */
  integer: boolean;
}

/**
 * The range a field accepts, in the unit the person types. Weight and height
 * are bounded in metric (kg / cm) and converted for imperial, rounded to whole
 * numbers so the message and the check agree on the same edges.
 */
function fieldRange(field: GoalField, unit: MeasurementUnit): FieldRange {
  const imperial = unit === "imperial";
  switch (field) {
    case "age":
      return { label: "Age", min: 13, max: 120, suffix: "", integer: true };
    case "weight":
      return imperial
        ? {
            label: "Weight",
            min: Math.round(kgToLbs(25)),
            max: Math.round(kgToLbs(350)),
            suffix: weightUnitLabel(unit),
            integer: false,
          }
        : {
            label: "Weight",
            min: 25,
            max: 350,
            suffix: weightUnitLabel(unit),
            integer: false,
          };
    case "height":
      // The screen collects imperial height in inches, so the bounds are too.
      return imperial
        ? {
            label: "Height",
            min: Math.round(cmToInches(100)),
            max: Math.round(cmToInches(250)),
            suffix: heightUnitLabel(unit),
            integer: false,
          }
        : {
            label: "Height",
            min: 100,
            max: 250,
            suffix: heightUnitLabel(unit),
            integer: false,
          };
    // Ceilings match the server's updateGoalsSchema (server/routes/goals.ts):
    // calories 10000 (its own calculator can propose more than 6000, and the
    // client must never refuse a value the app itself filled in), protein and
    // fat 500 g, carbs 1000 g. The calorie floor stays at 800, above the
    // server's 500.
    case "calories":
      return {
        label: "Calories",
        min: 800,
        max: 10000,
        suffix: "",
        integer: true,
      };
    case "protein":
      return {
        label: "Protein",
        min: 0,
        max: 500,
        suffix: "g",
        integer: true,
      };
    case "carbs":
      return { label: "Carbs", min: 0, max: 1000, suffix: "g", integer: true };
    case "fat":
      return { label: "Fat", min: 0, max: 500, suffix: "g", integer: true };
  }
}

/**
 * Why a Goal Setup number field refuses `value`, or null when it accepts it.
 * Empty text returns null — the "Still needed" line owns missing fields.
 */
export function goalFieldError(
  field: GoalField,
  value: string,
  unit: MeasurementUnit,
): string | null {
  if (value.trim() === "") return null;
  const range = fieldRange(field, unit);
  const n = parseDecimalInput(value);
  const ok =
    n !== null &&
    n >= range.min &&
    n <= range.max &&
    (!range.integer || Number.isInteger(n));
  if (ok) return null;
  const suffix = range.suffix ? ` ${range.suffix}` : "";
  return `${range.label} must be ${range.min}–${range.max}${suffix}`;
}

/**
 * Save's check: like `goalFieldError`, but an empty field is named too —
 * the "Still needed" line only sits under Calculate, so after it a cleared
 * field would otherwise refuse with no word said (form-fields spec §5.1).
 */
export function goalSubmitError(
  field: GoalField,
  value: string,
  unit: MeasurementUnit,
): string | null {
  if (value.trim() === "") {
    return `Enter ${fieldRange(field, unit).label.toLowerCase()}`;
  }
  return goalFieldError(field, value, unit);
}
