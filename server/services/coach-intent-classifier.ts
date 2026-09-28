export type CoachIntent =
  | "safety_refusal"
  | "general_fact"
  | "vague_request"
  | "personalized_advice"
  | "recipe_request";

export interface IntentClassification {
  intent: CoachIntent;
  /** Short token identifying which rule fired — used in debug logging. */
  matchedRule: string;
}

// ── Safety patterns (ordered; first match wins) ──────────────────────────────

const SAFETY_PATTERNS: { pattern: RegExp; name: string }[] = [
  {
    // Medical conditions — cardiovascular, diabetes, kidney, thyroid, etc.
    // Only the organ words that collide with FOOD words get boundary +
    // collocation guards: "kidney beans", "hearty", "artichoke hearts",
    // "chicken liver", and "delivery" (substring liver) must NOT route a
    // benign cooking question into the refusal prompt bundle. "heart" and
    // "liver" therefore require a medical collocation or a possessive
    // ("my heart"); "kidney" excludes the beans collocation (space or
    // hyphen joined). All OTHER terms stay substring matches (like the
    // original pattern) so compound words keep routing to safety:
    // hyperthyroidism/hypothyroidism, cancerous, diabetic — none collide
    // with food vocabulary. The model's own safety instructions remain
    // the second line of defense for anything the router misses.
    pattern:
      /(?:cardiovascular|cardiac|diabet(?:es|ic)|thyroid|cancer|pregnan)|\bkidneys?\b(?![\s-]+beans?\b)|\bheart\s+(?:disease|condition|failure|attack|murmur|valve|surgery|problems?|issues?|health|rate|meds?|medications?)\b|\bmy\s+heart\b|\bliver\s+(?:disease|condition|damage|failure|enzymes?|function|problems?|issues?|health)\b|\bfatty\s+liver\b|\bmy\s+liver\b/i,
    name: "medical_condition",
  },
  {
    // GLP-1 and other metabolic medications
    pattern: /(semaglutide|ozempic|wegovy|glp[-\s]?1|metformin|insulin)/i,
    name: "medication_glp1",
  },
  {
    // Disordered eating / self-harm signals
    pattern: /(throw up|purge|vomit|self.?harm|suicide)/i,
    name: "disordered_eating",
  },
  {
    // Supplement megadose — catches "50,000 IU", "megadose", "toxic dose"
    pattern: /(\d{3,}\s*iu\b|mega.?dose|toxic dose)/i,
    name: "megadose",
  },
  {
    // Prompt injection via "ignore" keyword — [\s\S]{0,2000} matches across
    // newlines. The bound equals the 2000-char message cap (chat.ts Zod schema
    // + sanitizeUserInput slice), so the whole sanitized message is always in
    // range. A smaller bound would let a padded injection push the trigger
    // keyword past the gap and bypass detection.
    pattern: /ignore[\s\S]{0,2000}(instruction|rule|guidelines?|safety)/i,
    name: "prompt_injection_ignore",
  },
  {
    // Extended fasting protocols — "water fast", "72-hour fast", "3-day fast"
    pattern: /(water fast|\d+[\s-](hour|hr|day)s?\s*(water\s*)?fast)/i,
    name: "extreme_fasting",
  },
  {
    // Jailbreak via persona reassignment — [\s\S]{0,2000} matches across
    // newlines; the bound equals the 2000-char message cap (see above) so a
    // padded injection cannot push the keyword past the gap.
    pattern:
      /(unrestricted[\s\S]{0,2000}(fitness|nutrition|diet|health|ai)|no safety guidelines|you are now \w+bot)/i,
    name: "jailbreak_persona",
  },
];

/**
 * Matches "NNN cal/calorie* ... day/daily" where NNN < 1200.
 * Uses \d{2,3} per the plan spec — catches 3-digit unsafe targets (500, 800, etc.)
 * while leaving realistic plans (1500 cal/day) unaffected.
 * Negative lookbehind (?<!\d) ensures "500" inside "1500" is never extracted.
 */
const CALORIE_RESTRICTION_RE =
  /(?<!\d)(\d{2,3})(?!\d)\s*(?:cal(?:orie)?s?)[^\d]*(?:day|daily)/i;

// ── Vague request ─────────────────────────────────────────────────────────────

const VAGUE_EXACT_RE = /^(help|hi|hey|hello|idk|i don.?t know)$/i;

// ── General fact ─────────────────────────────────────────────────────────────

/**
 * Matches questions that start with a factual question stem.
 * Anchored at ^ so mid-sentence "What are" doesn't trigger on "I've been
 * feeling tired lately. What are good sources of iron?"
 *
 * The `what` arm uses [''']s? (apostrophe variants) rather than `.s` to avoid
 * false-positives on "What should…" and "What stocks…" where `.` would match
 * the space before "should"/"stocks" giving "What s" as an accidental match.
 *
 * The `do …need` arm is scoped to a nutrient/macro vocabulary so generic
 * "do I need…" questions (which are almost always personal) fall through to
 * personalized_advice rather than being misrouted as factual. The `s?\b`
 * suffix matches optional plurals while preventing substring hits
 * ("fat" in "father", "carb" in "carbon"). Its two `[\s\S]{0,500}` gaps are
 * bounded so the arm cannot contribute backtracking depth on adversarially
 * long input. 500 is ample here — this is a routing heuristic, not a safety
 * detector, so a miss only mis-routes; the safety patterns above bound to the
 * full 2000-char message cap instead.
 */
const GENERAL_FACT_RE =
  /^(how (much|many)|what(?:[''']s?| is| are)|is\s+\w+\s+(high|low|good|bad)|do [\s\S]{0,500}need\b[\s\S]{0,500}(protein|carb|fiber|vitamin|supplement|calorie|fat|macro)s?\b)/i;

/**
 * If the message contains a temporal personal reference the user is asking
 * about their current situation — route to personalized_advice instead.
 */
const TEMPORAL_PERSONAL_RE = /\b(today|now|right now|currently)\b/i;

// ── Recipe request (recipe finder, spec R4) ──────────────────────────────────

/**
 * A request for a dish/recipe → the server-run recipe finder (Coach Pro, flag
 * on). Checked AFTER safety and BEFORE vague/general_fact, so "meal ideas"
 * (≤3 words) and "What's a …" stems route here. Measured 2026-09-28 against
 * evals/datasets/coach-cases.json: exactly 5 of 41 cases route.
 * `[^.?!]{0,40}` / `[^?!]{0,40}` bound each gap (routing heuristic, not a
 * safety detector — see GENERAL_FACT_RE's note on bounded gaps).
 */
const RECIPE_REQUEST_PATTERNS: { pattern: RegExp; name: string }[] = [
  {
    pattern:
      /\b(?:find|give|show|suggest|recommend|send|share|need|want|get|looking for|search for)\b[^.?!]{0,40}\brecipes?\b/i,
    name: "recipe_verb",
  },
  {
    pattern:
      /^(?:a |an |any |some )?(?:[\w-]+ ){0,3}recipes? (?:for|with|using)\b/i,
    name: "recipe_leading",
  },
  {
    pattern: /\bwhat (?:should|can|could|shall) (?:i|we) (?:make|cook|bake)\b/i,
    name: "what_to_cook",
  },
  {
    pattern:
      /\b(?:meal|dinner|lunch|breakfast|brunch)s?\b[^?!]{0,40}\bideas?\b/i,
    name: "meal_ideas",
  },
  {
    pattern:
      /\bideas?\b[^.?!]{0,40}\b(?:meal|dinner|lunch|breakfast|brunch)s?\b/i,
    name: "ideas_for_meal",
  },
];

/** Logging/saving/tracking a meal or recipe is a coach action, not a search. */
const RECIPE_REQUEST_EXCLUSION_RE =
  /\b(?:log|logged|logging|save|saved|delete|track)\b[^.?!]{0,30}\b(?:recipe|meal|dinner|lunch|breakfast|brunch)s?\b/i;

// ── Classifier ────────────────────────────────────────────────────────────────

function wordCount(message: string): number {
  return message.trim().split(/\s+/).length;
}

/**
 * Deterministic regex/keyword intent classifier. Pure function — no I/O,
 * no LLM call. Rule precedence: safety > recipe_request > vague >
 * general_fact > personalized. Safety wins all ties. `recipeRequests: false`
 * skips the recipe_request rule (flag off, free Coach, and the generators'
 * self-classification fallback keep their legacy prompt intent).
 */
export function classifyIntent(
  message: string,
  opts: { recipeRequests?: boolean } = {},
): IntentClassification {
  const trimmed = message.trim();

  // ── Rule 1: safety_refusal (highest priority) ─────────────────────────────
  for (const { pattern, name } of SAFETY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: "safety_refusal", matchedRule: name };
    }
  }

  // Strip thousand-separator commas ("1,500" → "1500") before calorie check to
  // prevent false-positive on realistic targets like "1,500 cal/day".
  const normalizedForCalorie = trimmed.replace(/(\d),(\d{3})/g, "$1$2");
  const calorieMatch = normalizedForCalorie.match(CALORIE_RESTRICTION_RE);
  if (calorieMatch && parseInt(calorieMatch[1], 10) < 1200) {
    return {
      intent: "safety_refusal",
      matchedRule: "calorie_restriction_below_1200",
    };
  }

  // ── Rule 2: recipe_request (after safety, before vague/general_fact) ──────
  if (
    opts.recipeRequests !== false &&
    !RECIPE_REQUEST_EXCLUSION_RE.test(trimmed)
  ) {
    for (const { pattern, name } of RECIPE_REQUEST_PATTERNS) {
      if (pattern.test(trimmed)) {
        return { intent: "recipe_request", matchedRule: name };
      }
    }
  }

  // ── Rule 3: vague_request ─────────────────────────────────────────────────
  const hasQuestion = trimmed.includes("?");
  if (
    VAGUE_EXACT_RE.test(trimmed) ||
    (wordCount(trimmed) <= 3 && !hasQuestion)
  ) {
    return { intent: "vague_request", matchedRule: "vague_exact_or_short" };
  }

  // ── Rule 4: general_fact ──────────────────────────────────────────────────
  if (GENERAL_FACT_RE.test(trimmed) && !TEMPORAL_PERSONAL_RE.test(trimmed)) {
    return { intent: "general_fact", matchedRule: "general_fact_question" };
  }

  // ── Rule 5: personalized_advice (default) ─────────────────────────────────
  return { intent: "personalized_advice", matchedRule: "default" };
}
