/**
 * Pure helpers for `migrate-recipe-ingredients.ts` — zero-dependency leaf so
 * the parsers are unit-testable (the script connects to Postgres and runs
 * `main()` at module load).
 */

/**
 * CLI contract: preview by default; writes only on an explicit --commit, and
 * `--dry-run` is a VETO — it wins even alongside --commit, so a stale
 * habitual --dry-run in a saved command stays a safety net rather than being
 * silently ignored (the safe failure direction in every combination).
 * `vetoed` reports the conflict so the script's banner can NAME --dry-run as
 * the reason, instead of telling the operator to pass a --commit they
 * already passed. Same shape as `scripts/cleanup-junk-recipes-utils.ts`
 * (PR #825) — see docs/solutions/logic-errors/safety-flag-must-veto-not-alias-2026-08-16.md.
 */
export function parseCleanupFlags(argv: readonly string[]): {
  commit: boolean;
  vetoed: boolean;
} {
  const commitRequested = argv.includes("--commit");
  const dryRun = argv.includes("--dry-run");
  return {
    commit: commitRequested && !dryRun,
    vetoed: commitRequested && dryRun,
  };
}

// ---------------------------------------------------------------------------
// Ingredient parsing
// ---------------------------------------------------------------------------

export function parseIngredientLine(raw: string): {
  name: string;
  quantity: string;
  unit: string;
} {
  // Match: "200g rice noodles", "3 tbsp fish sauce", "1/2 cup flour"
  const match = raw.match(
    /^(\d+(?:[/.]\d+)?)\s*(g|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|tablespoons?|teaspoons?|ounces?|pounds?|bunch|head|clove|cloves|stalk|stalks|piece|pieces|slice|slices|can|cans|handful|pinch)?\s+(.+)$/i,
  );
  if (match) {
    return { quantity: match[1], unit: match[2] ?? "", name: match[3].trim() };
  }
  // "1 cucumber, thinly sliced" — quantity + name, no unit
  const simpleMatch = raw.match(/^(\d+(?:[/.]\d+)?)\s+(.+)$/);
  if (simpleMatch) {
    return {
      quantity: simpleMatch[1],
      unit: "",
      name: simpleMatch[2].trim(),
    };
  }
  // No quantity — "Fresh herbs (mint, cilantro, Thai basil)"
  return { quantity: "", unit: "", name: raw };
}

// ---------------------------------------------------------------------------
// Instruction/ingredient splitting
// ---------------------------------------------------------------------------

export interface SplitResult {
  ingredients: { name: string; quantity: string; unit: string }[];
  instructions: string[];
  /**
   * Lines dropped because they matched a section-header pattern (echoed
   * "Ingredients"/"Instructions"/etc. labels inside a section, distinct from
   * the boundary header already consumed by the split) — NOT blank lines,
   * which the same filters also drop but which are not worth surfacing.
   * Reported so an operator can eyeball a partial drop before --commit.
   */
  droppedHeaderLines: string[];
}

/**
 * Whole-line, header-SHAPED match (optionally with a trailing colon) — never
 * a prefix match. A real step/ingredient that merely BEGINS with one of
 * these words (e.g. "Cooking time is about 20 minutes") must survive; only a
 * line that IS just the header (optionally ":") is section-header noise.
 * Same shape as `client/lib/menu-ocr-parser.ts`'s `SECTION_HEADER_RE`.
 * Letting a stray "Directions:" echo through as a step is the SAFE
 * direction (cosmetic) versus silently deleting a real step (unrecoverable,
 * no backup table) — do not "tighten" this back to a prefix match.
 */
const STEPS_HEADER_LINE_RE =
  /^(?:instructions|steps|preparation|cooking|directions):?\s*$/i;
const INGREDIENTS_HEADER_LINE_RE = /^ingredients:?\s*$/i;

/**
 * Cleans a raw ingredient line by stripping markdown/bullet prefixes.
 * Handles:
 *   - "- ingredient"  / "* ingredient"  / "• ingredient"
 *   - "1. ingredient" (numbered list)
 *   - "**bold**" markdown
 *   - Leading/trailing whitespace
 */
export function cleanIngredientLine(raw: string): string {
  return raw
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/\*{1,2}([^*]*)\*{1,2}/g, "$1")
    .trim();
}

/**
 * Cleans a raw instruction step line by stripping markdown bold labels,
 * numbered prefixes, and bullet markers.
 * Handles:
 *   - "**Step Label:** actual text"  → "actual text"
 *   - "1. text"                      → "text"
 *   - "- text"                       → "text"
 *
 * SAFETY: the bold-label strip below is destructive by design — it discards
 * everything it matches, unlike `cleanIngredientLine`'s capture-and-restore
 * unwrap — because a genuine "**Step 1:**" label prefix should be discarded,
 * not kept. But a step wrapped ENTIRELY in bold with no colon-terminated
 * label to distinguish "label" from "body" (e.g. "**Press the tofu firmly
 * between paper towels**") matches the same pattern end-to-end and would
 * otherwise be destroyed to "". Falling back to a non-destructive unwrap
 * whenever the destructive path ate all the content is the SAME safe-
 * direction trade-off as the header-line filters above: a stray leaked "**"
 * pair is cosmetic, a silently deleted step is unrecoverable (no backup
 * table).
 *
 * The fallback is gated on `afterBulletAndNumber` (the intermediate BEFORE
 * the bold-label strip), not on `raw` — this is load-bearing. A line that
 * was ALREADY just a bullet/number marker with nothing else (e.g. "1." or
 * "-") reduces to "" during the bullet/number strips alone, before the
 * bold-label strip ever runs; gating on `raw` would revive that bare marker
 * as fake "instruction" text (`"1."`, `"-"`), defeating the empty-result
 * data-loss guard in `splitInstructionsArray` for the one case it exists to
 * catch — a steps section with no real content. Gating on the intermediate
 * fires the fallback only when the bold-label strip is what zeroed
 * genuinely-present content.
 */
export function cleanInstructionLine(raw: string): string {
  const afterBulletAndNumber = raw
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\d+\.\s*/, "");
  const cleaned = afterBulletAndNumber
    // Strip bold step labels like "**Prep Tofu:**" or "*Prep Tofu:**"
    .replace(/^\*{1,2}[^*]+\*{1,2}:?\s*/, "")
    .trim();
  if (cleaned.length === 0 && afterBulletAndNumber.trim().length > 0) {
    // The bold-label strip specifically consumed real content with nothing
    // left over — fall back to unwrapping markdown markers
    // (cleanIngredientLine's approach) instead of discarding it. Residual,
    // explicit judgment call: a step that is SOLELY a labelled marker with
    // no body (e.g. "**Step 1:**") also lands here and survives as
    // "Step 1:" rather than falling to null — an odd but non-empty step is
    // the safe direction versus silently discarding it.
    return afterBulletAndNumber.replace(/\*{1,2}([^*]*)\*{1,2}/g, "$1").trim();
  }
  return cleaned;
}

/**
 * Extracts ingredients and instruction steps from a recipe's instructions array.
 *
 * Handles all known storage patterns:
 *   Pattern A — ingredients + steps in the first element separated by \n
 *   Pattern B — markdown "### Ingredients:" header with \n separation
 *   Pattern C — bold "**Ingredients**:" label embedded in a numbered element
 *   Pattern D — separate array elements with plain "Ingredients:" / "Instructions:" labels
 *
 * Returns `null` — meaning "skip this row, write nothing" — whenever the blob
 * cannot be split into BOTH a non-empty ingredients list and a non-empty
 * instruction list. All four null paths (no ingredients header, no steps
 * header, empty ingredients section, empty steps section) are equivalent to
 * the caller: the row is left exactly as it was found.
 */
export function splitInstructionsArray(lines: string[]): SplitResult | null {
  // Join everything into one blob so multi-line strings are handled uniformly
  const blob = lines.join("\n");

  // Locate the ingredients section header (flexible: plain, ###, **bold**,
  // numbered — Pattern C's docblock claim). Anchored to a LINE START (`^` +
  // `m`, tolerating leading horizontal whitespace via `[ \t]*` and an
  // optional numbered-list prefix via `(?:\d+[.)]\s*)?`, e.g. "1. " or "1) ",
  // so an indented or numbered header line still matches) — unanchored, this
  // would match the word "ingredients" anywhere in the blob, including
  // mid-line inside real content (e.g. an ingredient line ending in a word
  // that happens to also be a steps-header trigger word — see the steps
  // locator below for the concrete case). The numbered-prefix group requires
  // the digits be immediately followed by "." or ")" — a real content line
  // like "2 tbsp oil for cooking" (digit then a space) does not match it, so
  // the mid-line-hijack protection is unaffected. `^` with `m` is safe on
  // the sliced `afterIngredients`/`stepsBlob` strings too: each slice always
  // starts immediately after a boundary match's own `\n`, so position 0 is
  // always a real line start, never a mid-line offset.
  const ingredientMatch = blob.match(
    /^[ \t]*(?:\d+[.)]\s*)?(?:#{1,3}\s*)?(?:\*{1,2})?ingredients(?:\*{1,2})?(?:\s*\*{1,2})?:?\s*\n/im,
  );
  if (!ingredientMatch) return null;

  const afterIngredients = blob.slice(
    ingredientMatch.index! + ingredientMatch[0].length,
  );

  // Locate the instructions/steps/preparation/cooking/directions section
  // header — same line-start anchor as above (leading whitespace AND
  // numbered-prefix tolerance included). Unanchored, an ingredient line like
  // "2 tbsp oil for cooking" would hijack the split: "cooking\n" matches the
  // pattern mid-line, truncating the ingredient list and reclassifying the
  // remainder as steps (found in review via an actual run, not by
  // inspection — see the regression test below).
  const stepsMatch = afterIngredients.match(
    /^[ \t]*(?:\d+[.)]\s*)?(?:#{1,3}\s*)?(?:\*{1,2})?(?:instructions|steps|preparation|cooking|directions)(?:\*{1,2})?:?\s*\n/im,
  );

  if (!stepsMatch) {
    // No steps marker found — cannot safely split
    return null;
  }

  const ingredientBlob = afterIngredients.slice(0, stepsMatch.index!);
  const stepsBlob = afterIngredients.slice(
    stepsMatch.index! + stepsMatch[0].length,
  );

  // Parse ingredient lines
  const ingredientCleaned = ingredientBlob.split("\n").map(cleanIngredientLine);
  const droppedIngredientHeaderLines = ingredientCleaned.filter(
    (line) => line.length > 0 && INGREDIENTS_HEADER_LINE_RE.test(line),
  );
  const ingredientLines = ingredientCleaned.filter(
    (line) => line.length > 0 && !INGREDIENTS_HEADER_LINE_RE.test(line),
  );

  if (ingredientLines.length === 0) return null;

  const ingredients = ingredientLines.map(parseIngredientLine);

  // Parse instruction steps
  const stepsCleaned = stepsBlob.split("\n").map(cleanInstructionLine);
  const droppedStepsHeaderLines = stepsCleaned.filter(
    (line) => line.length > 0 && STEPS_HEADER_LINE_RE.test(line),
  );
  const instructionLines = stepsCleaned.filter(
    (line) => line.length > 0 && !STEPS_HEADER_LINE_RE.test(line),
  );

  // DATA-LOSS GUARD, mirroring the ingredients guard above. The caller writes
  // `instructions` straight over `communityRecipes.instructions` on --commit,
  // and this script keeps NO backup table (unlike migrate-instructions.ts),
  // so an empty array here would destroy the original prose irrecoverably.
  // Skipping the row costs a manual follow-up; writing [] costs the recipe.
  if (instructionLines.length === 0) return null;

  const droppedHeaderLines = [
    ...droppedIngredientHeaderLines,
    ...droppedStepsHeaderLines,
  ];

  return { ingredients, instructions: instructionLines, droppedHeaderLines };
}
