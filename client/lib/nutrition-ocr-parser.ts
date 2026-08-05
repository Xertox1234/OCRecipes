/**
 * Pure function parser that extracts structured nutrition data from OCR text.
 * Designed for US nutrition labels in English. Uses line-by-line regex matching
 * with common OCR misread correction.
 */
import { parseLabelServingGrams } from "@shared/lib/label-serving";

export interface LocalNutritionData {
  calories: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  totalCarbs: number | null;
  dietaryFiber: number | null;
  totalSugars: number | null;
  protein: number | null;
  servingSize: string | null;
  confidence: number;
}

/** Fix common OCR character misreads in numeric strings */
function fixOCRDigits(s: string): string {
  return s
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/(?<=\d)S|S(?=\d)/g, "5");
}

/** Maximum plausible value per serving for any nutrition field */
const MAX_NUTRITION_VALUE = 10000;

/** Extract a numeric value from a string, applying OCR correction */
function extractNumber(raw: string): number | null {
  const fixed = fixOCRDigits(raw.trim());
  const num = parseFloat(fixed);
  if (isNaN(num) || num < 0 || num > MAX_NUTRITION_VALUE) return null;
  return num;
}

type NumericField = keyof Omit<
  LocalNutritionData,
  "servingSize" | "confidence"
>;

interface FieldPattern {
  key: NumericField;
  pattern: RegExp;
}

// Canadian/bilingual labels put the English name first with the French name
// after a slash ("Fat / Lipides", "Sugars / Sucres") or use the French name
// alone ("Glucides", "Protéines"). ALL ten numeric fields carry that form.
//
// Five additions vs. a plain US pattern, all regression-safe:
//   1. `(?:\s*\/\s*[a-zà-ÿ]+)?` — an OPTIONAL alternate-name group that steps
//      over the "/ Lipides" half without over-consuming the value.
//   2. `(\S+?)\s*g` — a loose capture (so fixOCRDigits still repairs OCR
//      misreads like "l2" -> 12) followed by an optional space before the unit
//      (for the Canadian "0 g" spacing).
//   3. A line anchor on bare tokens. "fat", "sugars", "trans" and "fibre" are
//      substrings of other fields' names and of marketing copy, so their
//      standalone forms only match at the start of a line.
//   4. `[ \t]+` before the value and `(?![a-zà-ÿ])` after the gram unit — the
//      name, the value and the unit must all be on ONE line. See below.
//   5. `|[ \t]+9(?![\d.])(?![ \t]*g)` — an alternate gram unit, tolerating the
//      recogniser's `g` -> `9` substitution. See below.
//   6. `|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.]))` — the same substitution
//      with no space before it. This branch MARKS rather than accepts: its
//      capture group is what tells `parseNutritionFromOCR` the reading is
//      ambiguous and must survive `gluedUnitIsForced` before it can be
//      adopted. Both trailing guards exist because being LAST in the
//      alternation is not enough to make a branch a last resort: the
//      alternation is retried at every length of the lazy `\S+?`, so branch 6
//      reaches a match at a SHORTER capture than branches 4-5 need and wins
//      outright. "Total Sugars 39 9" is the case — branch 5 reads it correctly
//      as 39 plus a lone unit, but only at capture "39", while branch 6 gets
//      there first at capture "3" and strands the real unit. So branch 6 must
//      refuse whenever a unit its siblings would have consumed is still
//      sitting there: a real "g", or a lone "9" further along the line.
//
// ── Why a field may not assemble itself across lines ─────────────────────────
// `\s` matches newlines and `g` matches the leading letter of any word, so
// `\s+<?(\S+?)\s*g` could take a name from one line, a value from the next and
// a "unit" from the one after that. `Trans\n15\nGLUTEN FREE` read transFat = 15
// — value from line 2, "unit" from the G of GLUTEN.
//
// That is not hypothetical. OCR flattens the whole package into one string, so
// both device captures carry `GLUTEN FREE` / `SANS GLUTEN` badges AND bare
// number-only lines (`15`, `19`, `49`) shed by the %DV column, a few lines from
// the panel. The same shape let `LOW SODIUM\n30 mg` report 30 mg of sodium.
//
// Requiring one line can only cost recall, never correctness: a field we fail
// to read falls back to the database and raises the "couldn't use that label"
// notice, whereas a field assembled from three lines is silently wrong.
//
// This was previously true of only five fields — fat, saturated fat, sugars,
// carbs and protein — on the reasoning that trans fat, cholesterol, sodium and
// fibre were "not read by the feature" and could stay US-only. That premise was
// wrong twice over, and two device captures on 2026-08-05 showed the cost:
//
//   - `(\S+?)mg` cannot cross a space, because `\S` never matches one. So
//     "Sodium 400 mg" and "Cholesterol / Cholestérol 5 mg" — both read
//     PERFECTLY by the recogniser — parsed as null. Only the glued form
//     ("400mg") ever worked, and Canadian panels do not use it.
//   - the fields are read: `confidence` counts all ten and gates the instant
//     local preview in `LabelAnalysisScreen` at 0.6; `shouldReplaceWithAI`
//     compares sodium; and sodium is one of the FSA-banded nutrients the
//     redesigned nutrition panel displays.
//
// Those four are NOT in the `labelNutrition` payload `useNutritionLookup` posts
// (calories, sugars, fat, saturated fat, serving size), so none of them can
// change whether a label overrides the product database — only how much of the
// label survives the parse.
//
// ── Why the unit slot also accepts a `9` ─────────────────────────────────────
// MLKit reads the "g" on these panels as a "9" often enough that it is the
// single largest cause of dropped fields: "0 9", "39 9", "0.2 9", "9 9" are all
// device-observed (2026-07-30 Cherry Coke; 2026-08-05 x2). But a `9` is also a
// digit, so "19" is genuinely ambiguous — it is either 19 grams or "1 g", and
// nothing in the flattened text distinguishes them.
//
// This one IS worth holding to a higher bar than the four above, because it
// recovers `totalFat`, `totalSugars` and `saturatedFat` — which ARE in that
// payload. A value read wrong here reaches the server override and the user's
// log. So the alternation resolves exactly the cases a human could and refuses
// the rest. A substituted unit must be a LONE token, which takes all three
// guards — dropping any one of them re-opens a real misread:
//
//   `[ \t]+`        preceded by same-line whitespace. NOT `\s`, which would let
//                   a stray "9" on the FOLLOWING line supply this line's unit.
//   `(?![\d.])`     not followed by more digits, so a %DV that lost its "%"
//                   ("3 95") is not mistaken for a value plus unit.
//   `(?![ \t]*g)`   and no REAL "g" still sitting unconsumed after it. Without
//                   this, "Total Fat 1 9 g" yields 1 — the `9` branch fires
//                   even though the true unit was right there. A dropped
//                   decimal point ("1.9 g" -> "1 9 g") is a single OCR error
//                   producing exactly that shape, so this is the guard that
//                   keeps a truncated macro out of the override payload.
//
//   "Total Fat 19 g"   -> 19    lazy `\S+?` tries "1", but the "9" is not
//                               whitespace-preceded, so it backtracks to the
//                               real "g". A true 19 is never read as 1.
//   "Fat / Ipldes 0 9" -> 0     no "g" anywhere; the "9" stands alone.
//   "Glucides 9 9"     -> 9     value and unit are both the glyph "9".
//   "Total Fat 1 9 g"  -> null  a real "g" follows: not a substitution.
//
// A GLUED substitution ("saturés 19") has no whitespace to key on, so a third
// branch matches it and hands it to `gluedUnitIsForced`, which adopts it only
// where the label itself rules the whole-token reading out:
//
//   "Glucides 09"      -> 0     no panel prints a leading zero before a digit.
//   "saturés 19"       -> 1     19 g of saturated fat cannot fit in the 11 g
//                               of total fat the same label reports.
//   "Lipides 2.59"     -> null  AMBIGUOUS: nothing contradicts 2.59, so it is
//                               declined, not guessed.
//   "Total Fat 19"     -> null  AMBIGUOUS: totalFat has no parent to overflow.
//   "Total Fat 0.59"   -> null  AMBIGUOUS: a leading zero before a DECIMAL
//                               point is ordinary, not impossible.
//
// On this path a missing field falls back to the database, and a confident
// wrong one does not — so wherever both readings survive, declining still
// beats picking the likelier one.
//
// Deliberately NOT extended to `mg`: an "m9" substitution has never been
// observed, and inventing tolerance for an unseen failure mode is how the
// ambiguous-"19" trap gets reintroduced by accident.
const FIELD_PATTERNS: FieldPattern[] = [
  // The same-line rule matters most here: calories is half the readiness gate,
  // so a value bled from a "REDUCED CALORIES" badge on the line above would
  // override the database with a marketing number. Requiring the same line can
  // only cost recall, and a lost field falls back to the database WITH a notice.
  { key: "calories", pattern: /calories[ \t]+(?!from\b)<?(\S+)/i },
  {
    key: "totalFat",
    pattern:
      /(?:total\s+fat|(?:^|\n)\s*(?:fat|lipides))(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g)|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.])))/i,
  },
  {
    key: "saturatedFat",
    pattern:
      /(?:saturated\s+fat|(?:^|\n)\s*(?:saturated|satur[ée]s))(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g)|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.])))/i,
  },
  {
    key: "transFat",
    // The bare bilingual "Trans / trans" line is printed as an indented
    // sub-line, and the recogniser renders that indent marker as a leading
    // "+" ("+Trans", "+ Trans" — both captured on device). `[\s+]*` steps over
    // it while keeping the line anchor that stops "NO TRANSFAT" and
    // "SANS GRASTRANS" badges from matching.
    pattern:
      /(?:trans\s+fat|(?:^|\n)[\s+]*trans)(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g)|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.])))/i,
  },
  {
    key: "cholesterol",
    // `[ée]` covers the English and French spellings in one token. Worth it:
    // on one capture the recogniser mangled the English half to "iOlesterol"
    // and the French half was the only legible name on the line.
    pattern: /cholest[ée]rol(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)\s*mg/i,
  },
  // "Sodium" is spelled the same in both languages; only the space was wrong.
  { key: "sodium", pattern: /sodium[ \t]+<?(\S+?)\s*mg/i },
  {
    key: "totalCarbs",
    pattern:
      /(?:total\s+carb(?:ohydrate|s|\.?)?|carbohydrates?|glucides)(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g)|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.])))/i,
  },
  {
    key: "dietaryFiber",
    // "fibre" is the French spelling AND the British English one, so one
    // alternation serves both. The line anchor on the bare form is doing real
    // work here: Canadian panels carry "Not a significant source of fibre,
    // potassium, calcium or iron." in running text a few lines below.
    pattern:
      /(?:dietary\s+fib(?:er|re)|(?:^|\n)\s*fib(?:er|re)s?)(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g)|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.])))/i,
  },
  {
    key: "totalSugars",
    pattern:
      /(?:total\s+sugars?|(?:^|\n)\s*(?:sugars?|sucres?))(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g)|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.])))/i,
  },
  {
    key: "protein",
    pattern:
      /(?:protein|prot[ée]ines?)(?:\s*\/\s*[a-zà-ÿ]+)?[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g)|(9)(?![\d.])(?![ \t]*g)(?![ \t]+9(?![\d.])))/i,
  },
];

// ── Resolving a GLUED substituted unit ──────────────────────────────────────
// The third branch above matches "saturés 19" — a value with the substituted
// unit glued to it, no whitespace to key on. That shape is genuinely ambiguous
// ("1 g" or "19"), so matching it is NOT the same as adopting it: the branch
// only lifts these candidates out of the text, and they are then admitted one
// by one, and only where something the label ITSELF says rules the whole-token
// reading out. Everything else stays declined, exactly as before.
//
// Two pieces of evidence qualify. Both are facts about labels, not guesses
// about the recogniser, which is what separates them from the reading this
// parser still refuses ("2.59" -> 2.5 g, true only if you assume the printing
// precision rules).

/**
 * Fields whose value cannot exceed another field's, by definition — saturated
 * and trans fat are both fat; fibre and sugars are both carbohydrate. A whole-
 * token reading that breaks the containment is not a value the package could
 * be carrying, whatever the glyphs look like.
 */
const PARENT_FIELD: Partial<Record<NumericField, NumericField>> = {
  saturatedFat: "totalFat",
  transFat: "totalFat",
  dietaryFiber: "totalCarbs",
  totalSugars: "totalCarbs",
};

/**
 * Decide whether a glued candidate may be adopted. `value` is the reading with
 * the trailing glyph taken as the unit; `raw` is the whole token, i.e. the
 * competing reading. Returns false whenever both readings remain possible.
 */
function gluedUnitIsForced(
  key: NumericField,
  value: number,
  raw: string,
  result: LocalNutritionData,
): boolean {
  // A printed panel never puts a leading zero in front of another digit. It
  // writes "0 g", so "09" is not a value any label could carry. Note this asks
  // for a zero before a DIGIT: "0.59" is perfectly printable and stays declined.
  if (/^0\d/.test(raw)) return true;

  // Otherwise the only remaining evidence is containment: the whole-token
  // reading has to overflow a parent field that actually parsed, AND the unit
  // reading has to fit inside it. If the parent is missing the argument cannot
  // be made, so the candidate is declined — a wrong parent must never be able
  // to promote a child.
  const parent = PARENT_FIELD[key];
  const bound = parent ? result[parent] : null;
  if (bound === null) return false;

  const wholeToken = extractNumber(raw);
  return wholeToken !== null && wholeToken > bound && value <= bound;
}

const SERVING_SIZE_PATTERN = /serving\s+size\s+(.+)/i;
// Canadian/bilingual labels head the column with "Per 355 mL" / "pour 250 mL" /
// "Portion". Only accept this form when the capture carries a g/ml token, so a
// stray "Amount per serving" line can't hijack the serving size.
//
// The capture STOPS at the last unit token instead of running to end of line.
// MLKit flattens physically adjacent print columns into one line, so on a
// package whose ingredients panel sits beside the nutrition panel the serving
// line arrives as "Per 1 tbsp (15 mL)/par 1 c. à s. (15 mL) Sugar, Vinegar,
// Splu Lguit et y" — and that whole string was displayed AND posted in the
// label-override payload. A serving spec is quantity-and-unit tokens; whatever
// follows the final one belongs to another column.
//
// Two details carry the trim:
//   `\b` after the unit — "Sugar", "Vinegar" and "Lguit" all contain a "g",
//        and both `[^\n]*` are greedy, so without a token boundary the capture
//        would cut mid-word ("...Splu Lg") and lose the unit entirely.
//   `\)?` — keeps the closing bracket of a parenthesised metric equivalent, so
//        "(15 mL)" survives intact rather than as "(15 mL".
//
// Trimming can only ever remove text AFTER the final unit, so the substring
// `parseLabelServingGrams` reads is untouched: this cannot change whether a
// label passes `isLabelReady`, only what the user is shown.
const SERVING_PER_PATTERN =
  /(?:^|\n)\s*(?:per|pour|portion)\s+([^\n]*\d[^\n]*(?:g|ml)\b\)?)/i;

/** Total number of numeric fields used to calculate confidence */
const TOTAL_FIELDS = FIELD_PATTERNS.length;

export function parseNutritionFromOCR(text: string): LocalNutritionData {
  const result: LocalNutritionData = {
    calories: null,
    totalFat: null,
    saturatedFat: null,
    transFat: null,
    cholesterol: null,
    sodium: null,
    totalCarbs: null,
    dietaryFiber: null,
    totalSugars: null,
    protein: null,
    servingSize: null,
    confidence: 0,
  };

  if (!text.trim()) return result;

  // Extract serving size (free-form text, not numeric). Prefer the US
  // "Serving Size" label; fall back to the Canadian "Per X mL" form only when
  // that capture contains a g/ml token (see SERVING_PER_PATTERN).
  // Both forms can appear on one panel — a US "Serving size" line AND a
  // Canadian "Per ..." line. Taking the first that MATCHES loses the label
  // when that one happens not to carry a metric figure: "Serving size 1 can"
  // wins over "Per 1 can (355 mL)", parses to nothing, and `isLabelReady` now
  // hard-requires a parseable serving, so the whole label is dropped. Prefer
  // whichever candidate actually parses, and fall back to the first captured
  // string so `servingSize` still carries raw text for display.
  const servingCandidates = [
    text.match(SERVING_SIZE_PATTERN)?.[1],
    text.match(SERVING_PER_PATTERN)?.[1],
  ]
    .filter((c): c is string => c != null)
    .map((c) => c.trim().slice(0, 100));
  const parseable = servingCandidates.find(
    (c) => parseLabelServingGrams(c) != null,
  );
  result.servingSize = parseable ?? servingCandidates[0] ?? null;

  // Extract numeric fields. A match whose SECOND group is set came from the
  // glued-unit branch and is ambiguous on its face, so it is set aside rather
  // than adopted — see `gluedUnitIsForced`.
  let extracted = 0;
  const glued: { key: NumericField; value: number; raw: string }[] = [];
  for (const { key, pattern } of FIELD_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const value = extractNumber(match[1]);
    if (value === null) continue;
    if (match[2]) {
      glued.push({ key, value, raw: match[1] + match[2] });
      continue;
    }
    result[key] = value;
    extracted++;
  }

  // Second pass, after every unambiguous field is in place. Deferring is what
  // makes the containment test independent of FIELD_PATTERNS order: a child
  // never gets tested against a parent that has not been read yet.
  for (const { key, value, raw } of glued) {
    if (!gluedUnitIsForced(key, value, raw, result)) continue;
    result[key] = value;
    extracted++;
  }

  result.confidence = extracted / TOTAL_FIELDS;

  return result;
}

/**
 * Decides whether a parsed nutrition label is usable as the source of truth.
 *
 * Product rule (user decision, 2026-07-30): **when a nutrition label is present
 * it is the source of truth** — its serving size and calories are adopted over
 * the product database record. So this gate asks for exactly those two:
 *
 * - `calories` — the value being adopted.
 * - `servingSize` — what that value is *per*. Without it there is nothing to
 *   scale by, and the calorie figure would be silently presented as whatever
 *   serving the database assumed. That is the bug this rule exists to fix, so
 *   adopting calories without a serving would just relocate it.
 *
 * It deliberately does NOT also require a sugars-or-fat reading. That looked
 * like cheap corroboration, but the two are not independent: the recogniser's
 * `g` -> `9` substitution breaks the sugars and fat patterns *together*, so one
 * glitch took out both and discarded labels whose calories and serving were
 * perfect. Device-observed on a Cherry Coke can (barcode 06772408) on
 * 2026-07-30 — the screen fell back to the database's per-100 mL figure and
 * showed 39 kcal for a 140 kcal can. The verbatim capture is in the tests.
 *
 * A field that failed to parse is treated as ABSENT, not as evidence the label
 * is wrong: `null` here means "we did not read this", never "the label is
 * untrustworthy".
 */
export function isLabelReady(
  parsed: LocalNutritionData | null | undefined,
): boolean {
  if (parsed == null || parsed.calories == null) return false;
  // Not merely "a serving string was captured" — it must PARSE to grams/ml.
  // `isLabelReady` also suppresses the "we couldn't use that label" notice, so
  // a label this accepts and the server then refuses reaches the user as
  // database values with NO indication the label was dropped — a server
  // refusal returns the same body shape as agreement. A US label reading
  // `Serving Size 1 can`, with no gram/ml figure, is the live case: captured
  // fine, parses to nothing.
  //
  // Shares `parseLabelServingGrams` with the server's `buildLabelConflict`
  // rather than each side calling its own parser — they previously used two
  // different implementations that disagreed on real inputs (`"355"` -> 355
  // here, `null` there), which is precisely how a label could pass this gate
  // and be refused downstream.
  return parseLabelServingGrams(parsed.servingSize) != null;
}
