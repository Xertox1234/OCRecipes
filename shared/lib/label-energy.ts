/**
 * Whether a nutrition label's calories are ones its own protein, carbs and
 * fat could make. A reader, on the phone or a vision model, can misread one
 * figure: "230" as "10" (owner report 2026-11-26), a dropped or extra digit,
 * or kilojoules taken for calories. This catches those before the numbers
 * reach a food card, which cannot fix its calories. Used by the phone's own
 * label read (Coach roadmap V5), the server's label photo read and the
 * phone-read endpoint, so all three refuse the same numbers.
 *
 * It checks a range, not one figure, because real labels drift a long way
 * from 4/4/9: fibre and sugar alcohols make less than 4 kcal a gram of carbs,
 * and alcohol makes 7 kcal a gram that no macro line covers (nutrition
 * review 2026-11-26).
 */

export interface LabelMacros {
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** Dietary fibre, when it was read; part of the carbs on US labels. */
  fibre?: number | null;
}

/** The calories the macros that were read make at 4/4/9. */
export function macroCalories(m: LabelMacros): number {
  return 4 * (m.protein ?? 0) + 4 * (m.carbs ?? 0) + 9 * (m.fat ?? 0);
}

/**
 * The fewest calories the macros could make: carbs at 2 kcal a gram (sugar
 * alcohols), fibre at none, and every carb as fibre when fibre was not read.
 * An unread macro counts as 0, so this stays a floor.
 */
function fewestCalories(m: LabelMacros): number {
  const carbs = m.carbs ?? 0;
  const lowCarbs =
    m.fibre === null || m.fibre === undefined
      ? 0
      : 2 * Math.max(0, carbs - m.fibre);
  return 4 * (m.protein ?? 0) + 9 * (m.fat ?? 0) + lowCarbs;
}

/** A drink's alcohol: a can of beer or a glass of wine, about 100–150 kcal. */
const ALCOHOL_ALLOWANCE = 250;

/**
 * Calories are refused when they sit well below the fewest the macros could
 * make, or, with every macro read, well above the most they could make plus
 * a drink's alcohol. An unread macro can only add calories, so there is then
 * no ceiling to check.
 */
export function labelEnergyAgrees(
  kcal: number,
  m: LabelMacros,
  /**
   * Leave room for a drink's alcohol above the macros. The phone's own read
   * passes false: a refusal there only sends the photo to the server, which
   * allows it, so the phone can stay strict about a misread macro.
   */
  { alcohol = true }: { alcohol?: boolean } = {},
): boolean {
  if (kcal < 0.75 * fewestCalories(m) - 30) return false;
  if (m.protein === null || m.carbs === null || m.fat === null) return true;
  const ceiling = 1.25 * macroCalories(m) + 30;
  return kcal <= ceiling + (alcohol ? ALCOHOL_ALLOWANCE : 0);
}

const KJ_PER_KCAL = 4.184;

/**
 * Whether the calories read look like the label's kilojoules instead (an EU
 * or Australian panel prints both): about 4.2 times what the macros make.
 */
export function looksLikeKilojoules(kcal: number, m: LabelMacros): boolean {
  const fromMacros = macroCalories(m);
  if (fromMacros <= 0) return false;
  return Math.abs(kcal / fromMacros - KJ_PER_KCAL) <= 0.15 * KJ_PER_KCAL;
}
