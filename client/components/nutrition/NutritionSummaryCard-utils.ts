/**
 * Display copy for the summary card's two promoted standout rows. Pure.
 *
 * The `unknown` band splits on `hasValue`, and that split is the whole reason
 * `Standout` carries the flag: rule 4 promotes fibre regardless of band, so a
 * promoted fibre row for a product with NO recorded fibre and one for a
 * product whose fibre we simply cannot place on a scale both arrive with
 * `band: "unknown"`. Collapsing them would tell a user a product has no fibre
 * when we never received the number.
 *
 * Lookup tables rather than switches, deliberately — same reasoning
 * `NutritionPanel-utils.ts`'s `CONCERN_TAG`/`BENEFIT_TAG` document:
 * `Record<ConcernBand, …>` makes a new band value a compile error AT THE
 * TABLE; an exhaustive switch with no `default` would instead fall off the
 * end and return `undefined` where a string is expected, and this repo does
 * not set `noImplicitReturns`, so that shape compiles locally and misbehaves
 * at runtime. `NUTRIENT_WORD` gets the same treatment for the same reason —
 * typed against the two nutrient unions instead of a bare `string` index, so
 * a new nutrient with no entry is a compile error rather than a silent
 * `"High in undefined"`.
 */
import type {
  Standout,
  ConcernBand,
  BenefitBand,
  ConcernNutrient,
  BenefitNutrient,
} from "@shared/lib/nutrition-bands";

const NUTRIENT_WORD: Record<ConcernNutrient | BenefitNutrient, string> = {
  sugar: "sugar",
  saturatedFat: "saturated fat",
  sodium: "sodium",
  fat: "fat",
  fibre: "fibre",
  protein: "protein",
};

/** `unknown` still branches on `hasValue` — see the module docblock. */
type CopyTemplate = (word: string, hasValue: boolean) => string;

const CONCERN_COPY: Record<ConcernBand, CopyTemplate> = {
  high: (word) => `High in ${word}`,
  medium: (word) => `Moderate ${word}`,
  low: (word) => `Low in ${word}`,
  unknown: (word, hasValue) =>
    hasValue ? capitalise(word) : `${capitalise(word)} not recorded`,
};

const BENEFIT_COPY: Record<BenefitBand, CopyTemplate> = {
  excellent: (word) => `Excellent source of ${word}`,
  good: (word) => `Good source of ${word}`,
  none: (word) => `No ${word}`,
  unknown: (word, hasValue) =>
    hasValue ? capitalise(word) : `${capitalise(word)} not recorded`,
};

export function standoutCopy(standout: Standout): string {
  const word = NUTRIENT_WORD[standout.nutrient];
  return standout.group === "concern"
    ? CONCERN_COPY[standout.band](word, standout.hasValue)
    : BENEFIT_COPY[standout.band](word, standout.hasValue);
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
