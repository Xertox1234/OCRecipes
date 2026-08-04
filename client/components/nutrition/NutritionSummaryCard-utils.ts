/**
 * Display copy for the summary card's two promoted standout rows. Pure.
 *
 * The `unknown` band splits on `hasValue`, and that split is the whole reason
 * `Standout` carries the flag: rule 4 promotes fibre regardless of band, so a
 * promoted fibre row for a product with NO recorded fibre and one for a
 * product whose fibre we simply cannot place on a scale both arrive with
 * `band: "unknown"`. Collapsing them would tell a user a product has no fibre
 * when we never received the number.
 */
import type { Standout } from "@shared/lib/nutrition-bands";

const NUTRIENT_WORD: Record<string, string> = {
  sugar: "sugar",
  saturatedFat: "saturated fat",
  sodium: "sodium",
  fat: "fat",
  fibre: "fibre",
  protein: "protein",
};

export function standoutCopy(standout: Standout): string {
  const word = NUTRIENT_WORD[standout.nutrient];

  if (standout.group === "concern") {
    switch (standout.band) {
      case "high":
        return `High in ${word}`;
      case "medium":
        return `Moderate ${word}`;
      case "low":
        return `Low in ${word}`;
      case "unknown":
        return standout.hasValue
          ? capitalise(word)
          : `${capitalise(word)} not recorded`;
    }
  }

  switch (standout.band) {
    case "excellent":
      return `Excellent source of ${word}`;
    case "good":
      return `Good source of ${word}`;
    case "none":
      return `No ${word}`;
    case "unknown":
      return standout.hasValue
        ? capitalise(word)
        : `${capitalise(word)} not recorded`;
  }
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
