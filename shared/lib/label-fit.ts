/**
 * Whether a nutrition label read on the phone plausibly belongs to the
 * product a barcode found. Shared so the Coach's scanner (which offers a
 * front-of-pack photo when it does not) and the server (which then leaves
 * the product's name off the card) decide the same way.
 */
import { parseLabelServingGrams } from "./label-serving";

// How far the label's calories per 100 g may sit from the product's before
// the label is taken to be another pack's: a ratio band, plus a floor in
// kcal so near-zero foods (diet drinks, broth) are not flagged on rounding.
const FIT_RATIO_MIN = 0.7;
const FIT_RATIO_MAX = 1.4;
const FIT_KCAL_100G_FLOOR = 25;

/**
 * Compared per 100 g, since the label's serving and the database's need not
 * match. True when either side gives nothing to compare.
 */
export function labelFitsProduct(
  label: { calories: number; servingSize: string },
  per100gCalories: number | undefined,
): boolean {
  const grams = parseLabelServingGrams(label.servingSize);
  if (!grams || per100gCalories === undefined) return true;
  const labelPer100 = (label.calories / grams) * 100;
  if (Math.abs(labelPer100 - per100gCalories) <= FIT_KCAL_100G_FLOOR) {
    return true;
  }
  if (per100gCalories <= 0) return false;
  const ratio = labelPer100 / per100gCalories;
  return ratio >= FIT_RATIO_MIN && ratio <= FIT_RATIO_MAX;
}
