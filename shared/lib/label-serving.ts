/**
 * The single serving-size parser for PHOTOGRAPHED LABEL text, shared by the
 * client's readiness gate (`isLabelReady`) and the server's override gate
 * (`buildLabelConflict`).
 *
 * It exists because those two gates previously called two different functions
 * — `client/lib/serving-size-utils.ts` and `server/services/barcode-lookup.ts`
 * — which disagreed on real inputs (`"355"` -> 355 there, `null` here). The
 * client gate also suppresses the "we couldn't use that label" notice, so a
 * label it accepted and the server then refused reached the user as database
 * values with nothing saying the label had been dropped — a refusal returns
 * the same body shape as agreement.
 *
 * Both existing `parseServingGrams` functions are left alone for their own
 * callers (DB serving strings, the serving-size controls). Only the two gates
 * live here, so they cannot drift apart again.
 *
 * MUST BE AT LEAST AS PERMISSIVE AS BOTH PREDECESSORS. This gate decides
 * whether a label is used at all, so narrowing it rejects labels that used to
 * work and tells the user "we couldn't find nutrition values" when the values
 * were read perfectly well. Every form below is one a real predecessor
 * accepted; the regression tests pin them.
 */

/**
 * Metric units as they appear on labels, longest-first so the alternation
 * cannot settle on a prefix (`g` inside `grams`) and then fail the `\b`.
 */
const UNIT = String.raw`(?:grams?|g|millilit(?:re|er)s?|ml)`;

/**
 * The metric figure inside a parenthetical, e.g. "1 can (355 mL)".
 *
 * Deliberately does NOT require the closing parenthesis right after the unit —
 * dual-unit labels ("(198g/7oz)", "(250 mL/8 fl oz)") and OCR spacing
 * ("(355 mL )") both put something between them, and an earlier version of
 * this module dropped all of those.
 */
const PAREN = new RegExp(String.raw`\(\s*(\d+(?:\.\d+)?)\s*${UNIT}\b`);

/**
 * A bare metric serving, e.g. "355 mL", "30g", "250 grams".
 *
 * `(?:^|[\s(])` anchors the number to a token start so a digit inside a longer
 * run cannot be mistaken for a serving — while still admitting one that opens
 * a parenthetical, which the anchor would otherwise exclude entirely.
 *
 * The trailing `\b` rejects a unit that is merely a prefix of a longer word:
 * "1 gal" must not read as 1 gram. ("30 mg" was never at risk — neither
 * predecessor matched it, since `mg` is not `g` or `ml`.)
 */
const BARE = new RegExp(String.raw`(?:^|[\s(])(\d+(?:\.\d+)?)\s*${UNIT}\b`);

/** Grams/millilitres parsed from a label serving string, or null if none. */
export function parseLabelServingGrams(
  servingSize: string | null | undefined,
): number | null {
  if (!servingSize) return null;
  const lower = servingSize.toLowerCase();

  // Prefer the parenthetical: on "1 can (355 mL)" the household measure ("1")
  // comes first, and taking it would yield a 1-gram serving.
  const paren = lower.match(PAREN);
  if (paren) return parseFloat(paren[1]);

  const bare = lower.match(BARE);
  if (bare) return parseFloat(bare[1]);

  return null;
}
