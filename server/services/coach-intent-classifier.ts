export type CoachIntent =
  | "safety_refusal"
  | "general_fact"
  | "vague_request"
  | "personalized_advice";

export interface IntentClassification {
  intent: CoachIntent;
  /** Short token identifying which rule fired — used in debug logging. */
  matchedRule: string;
}

// ── Safety patterns (ordered; first match wins) ──────────────────────────────

const SAFETY_PATTERNS: { pattern: RegExp; name: string }[] = [
  {
    // Medical conditions — cardiovascular, diabetes, kidney, thyroid, etc.
    pattern:
      /(heart|cardiovascular|cardiac|diabetes|kidney|thyroid|liver|cancer|pregnan)/i,
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
    // Prompt injection via "ignore" keyword — [\s\S]{0,500} matches across
    // newlines while bounding backtracking depth (upstream sanitization caps
    // message length, so the gap between "ignore" and the keyword is short).
    pattern: /ignore[\s\S]{0,500}(instruction|rule|guidelines?|safety)/i,
    name: "prompt_injection_ignore",
  },
  {
    // Extended fasting protocols — "water fast", "72-hour fast", "3-day fast"
    pattern: /(water fast|\d+[\s-](hour|hr|day)s?\s*(water\s*)?fast)/i,
    name: "extreme_fasting",
  },
  {
    // Jailbreak via persona reassignment — [\s\S]{0,500} matches across
    // newlines while bounding backtracking depth.
    pattern:
      /(unrestricted[\s\S]{0,500}(fitness|nutrition|diet|health|ai)|no safety guidelines|you are now \w+bot)/i,
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
 * bounded — same defense-in-depth as the safety patterns — so the arm cannot
 * contribute backtracking depth on adversarially long input.
 */
const GENERAL_FACT_RE =
  /^(how (much|many)|what(?:[''']s?| is| are)|is\s+\w+\s+(high|low|good|bad)|do [\s\S]{0,500}need\b[\s\S]{0,500}(protein|carb|fiber|vitamin|supplement|calorie|fat|macro)s?\b)/i;

/**
 * If the message contains a temporal personal reference the user is asking
 * about their current situation — route to personalized_advice instead.
 */
const TEMPORAL_PERSONAL_RE = /\b(today|now|right now|currently)\b/i;

// ── Classifier ────────────────────────────────────────────────────────────────

function wordCount(message: string): number {
  return message.trim().split(/\s+/).length;
}

/**
 * Deterministic regex/keyword intent classifier. Pure function — no I/O,
 * no LLM call. Rule precedence: safety > vague > general_fact > personalized.
 * Safety wins all ties.
 */
export function classifyIntent(message: string): IntentClassification {
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

  // ── Rule 2: vague_request ─────────────────────────────────────────────────
  const hasQuestion = trimmed.includes("?");
  if (
    VAGUE_EXACT_RE.test(trimmed) ||
    (wordCount(trimmed) <= 3 && !hasQuestion)
  ) {
    return { intent: "vague_request", matchedRule: "vague_exact_or_short" };
  }

  // ── Rule 3: general_fact ──────────────────────────────────────────────────
  if (GENERAL_FACT_RE.test(trimmed) && !TEMPORAL_PERSONAL_RE.test(trimmed)) {
    return { intent: "general_fact", matchedRule: "general_fact_question" };
  }

  // ── Rule 4: personalized_advice (default) ─────────────────────────────────
  return { intent: "personalized_advice", matchedRule: "default" };
}
