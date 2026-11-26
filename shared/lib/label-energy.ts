/**
 * Whether a nutrition label's calories agree with its protein, carbs and fat
 * (4 kcal a gram of protein or carbs, 9 of fat). A reader, on the phone or a
 * vision model, can misread one figure ("230" as "10", or a "10 %" column
 * taken for the calories); this catches it before the numbers reach a food
 * card. Used by the phone's own label read (Coach roadmap V5) and the
 * server's label photo read, so both refuse the same numbers.
 */

export interface LabelMacros {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

/** The calories the macros that were read account for. */
export function macroCalories(m: LabelMacros): number {
  return 4 * (m.protein ?? 0) + 4 * (m.carbs ?? 0) + 9 * (m.fat ?? 0);
}

/**
 * The band is wide: fibre, sugar alcohols and the label's own rounding make
 * real panels drift, and small foods get a 30 kcal floor.
 */
function allowedDrift(kcal: number): number {
  return Math.max(30, 0.25 * kcal);
}

/**
 * With every macro read, the calories must sit within the band of what they
 * make. With one unread, only a total the macros read already exceed is
 * caught: the missing one may be what makes up the rest.
 */
export function labelEnergyAgrees(kcal: number, m: LabelMacros): boolean {
  const fromMacros = macroCalories(m);
  const drift = allowedDrift(kcal);
  if (m.protein === null || m.carbs === null || m.fat === null) {
    return fromMacros <= kcal + drift;
  }
  return Math.abs(fromMacros - kcal) <= drift;
}
