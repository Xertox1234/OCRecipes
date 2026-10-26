/**
 * Whole-word matching of a food query against a source's food names, shared
 * by the CNF and USDA matchers.
 */

/**
 * Split text into lowercase whole words (letters, digits, "%"), dropping
 * one-letter words. Matching is by whole word: a substring test let "raw" match
 * "strawberry", "butter" match "butterfish" and "pap" match "paprika". CNF's
 * Canadian spelling "yogourt" is folded to "yogurt" so either spelling matches.
 */
export function matchWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/yogourt/g, "yogurt")
    .split(/[^\p{L}\p{N}%]+/u)
    .filter((w) => w.length > 1 || /\d/.test(w));
}

/**
 * Serving units and sizes. Photo analysis ("<quantity> <name>") and cooking
 * sessions ("<quantity> <unit> <name>") prefix the query with these, and CNF
 * names never contain them, so that prefix must not count against the
 * every-word rule.
 */
const QUANTITY_UNITS = new Set([
  "cup",
  "cups",
  "tbsp",
  "tablespoon",
  "tablespoons",
  "tsp",
  "teaspoon",
  "teaspoons",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "gram",
  "grams",
  "kg",
  "mg",
  "ml",
  "liter",
  "liters",
  "litre",
  "litres",
  "slice",
  "slices",
  "piece",
  "pieces",
  "serving",
  "servings",
  "can",
  "cans",
  "bottle",
  "bottles",
  "glass",
  "glasses",
  "bowl",
  "bowls",
  "handful",
  "handfuls",
  "small",
  "medium",
  "large",
  "pinch",
  "pinches",
  "dash",
  "dashes",
  "stalk",
  "stalks",
  "sprig",
  "sprigs",
  "bunch",
  "bunches",
  "head",
  "heads",
  "ear",
  "ears",
  "wedge",
  "wedges",
  "sheet",
  "sheets",
  "stick",
  "sticks",
  "container",
  "containers",
  "envelope",
  "envelopes",
]);

/**
 * A bare number or number+unit token ("2", "12oz", "200g"), never "2%".
 * No decimal branch: `matchWords` already splits "1.5"/"1,5" into "1" and
 * "5" on the non-letter/digit separator, so a word reaching this function
 * never contains "." or ",".
 */
function isNumberWord(word: string): boolean {
  const m = /^\d+([a-z]*)$/.exec(word);
  return (
    m !== null && (m[1] === "" || m[1] === "g" || QUANTITY_UNITS.has(m[1]))
  );
}

/**
 * Drop the leading quantity run ("1 cup", "2 large", "12oz", "1/2 cup") the
 * callers prepend. Only a run that STARTS with a number is dropped, and only up
 * to the first other word, so a unit word inside a food's own name stays:
 * "small white beans", "reese's pieces", "cup noodles". Residuals: "1 cup
 * noodles" loses "cup" (a joined string can't tell a unit from a name word),
 * and a quantity with no number ("a handful of almonds") is not stripped, so
 * it misses CNF and falls through to USDA.
 */
export function withoutLeadingQuantity(words: string[]): string[] {
  if (words.length === 0 || !isNumberWord(words[0])) return words;
  let i = 0;
  while (
    i < words.length &&
    (isNumberWord(words[i]) || QUANTITY_UNITS.has(words[i]))
  ) {
    i++;
  }
  return words.slice(i);
}

/** 1 for the exact word, 0.8 for its singular/plural, 0 otherwise. */
export function wordMatch(words: Set<string>, word: string): number {
  if (words.has(word)) return 1;
  const variants = [word + "s", word + "es"];
  if (word.endsWith("s")) variants.push(word.slice(0, -1));
  if (word.endsWith("es")) variants.push(word.slice(0, -2));
  if (word.endsWith("ies")) variants.push(word.slice(0, -3) + "y");
  if (word.endsWith("y")) variants.push(word.slice(0, -1) + "ies");
  return variants.some((v) => words.has(v)) ? 0.8 : 0;
}
