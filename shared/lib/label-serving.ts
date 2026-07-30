/**
 * The single serving-size parser for PHOTOGRAPHED LABEL text, shared by the
 * client's readiness gate (`isLabelReady`) and the server's override gate
 * (`buildLabelConflict`).
 *
 * It exists because those two gates previously called two different functions
 * — `client/lib/serving-size-utils.ts` and `server/services/barcode-lookup.ts`
 * — with genuinely different behaviour:
 *
 *     "355"      -> client 355, server null
 *     "30"       -> client 30,  server null
 *     "355 mL)"  -> client null, server 355
 *
 * The client-accepts/server-refuses direction was live and reachable:
 * `SERVING_SIZE_PATTERN` captures to end of line, so an OCR line break splits
 * "Serving Size 355 mL" into `"355"`. The client gate passed, which ALSO
 * suppresses the "we couldn't use that label" notice, the label was POSTed,
 * the server refused — and a refusal returns the same body shape as agreement.
 * The user got database values with nothing saying the label had been dropped.
 *
 * Both existing `parseServingGrams` functions are left alone for their own
 * callers (DB serving strings, the serving-size controls). Only the two gates
 * move here, so they cannot drift apart again.
 *
 * A UNIT IS REQUIRED. The client's version accepted a bare number
 * (`/^(\d+\.?\d*)$/`), which on label text is dangerous rather than generous:
 * "Serving Size 1" would parse to a 1-gram serving and scale every nutrient by
 * 100x. Ambiguity here fails closed — the caller then treats the label as
 * unusable and TELLS the user, which is the honest outcome.
 */

/** Grams/millilitres parsed from a label serving string, or null if none. */
export function parseLabelServingGrams(
  servingSize: string | null | undefined,
): number | null {
  if (!servingSize) return null;
  const lower = servingSize.toLowerCase();

  // Preferred form: the metric figure in parentheses beside a household
  // measure — "1 can (355 mL)", "2/3 cup (55 g)", "2 tbsp (32g)".
  const paren = lower.match(/\((\d+(?:\.\d+)?)\s*(?:g|ml)\)/);
  if (paren) return parseFloat(paren[1]);

  // Otherwise a bare metric serving — "355 mL", "30g", "236.0 g".
  //
  // `(?:^|\s)` anchors the number to a token start so a digit embedded in a
  // longer run cannot be picked up, and `(?![a-z])` stops "30 mg" being read
  // as 30 g — sodium lines sit right beside serving lines on a real panel.
  const trailing = lower.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?:g|ml)(?![a-z])/);
  if (trailing) return parseFloat(trailing[1]);

  return null;
}
