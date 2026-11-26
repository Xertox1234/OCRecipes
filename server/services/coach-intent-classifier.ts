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

// Building blocks for the prolonged-starvation pattern below. One quantity
// list and one duration list feed every phrasing, so widening a dimension is
// one edit.
const STARVE_WORD_NUM =
  "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|twenty|thirty)";
// A numeric quantity, with an optional range ("2-3", "2 to 3", "2 or 3"),
// decimal ("1.5") or "+" ("3+").
const STARVE_NUM =
  "\\d+(?:\\.\\d+)?(?:\\s*(?:-|to|or)\\s*\\d+(?:\\.\\d+)?)?\\+?";
const STARVE_QTY = `(?:${STARVE_NUM}|${STARVE_WORD_NUM}(?:\\s+(?:or|to)\\s+${STARVE_WORD_NUM})?|a|an|several|few|a\\s+few|many|some|multiple|(?:a\\s+)?couple(?:\\s+of)?|(?:the|a)\\s+(?:whole|full|entire)|an\\s+entire)`;
// 24+ hours, optionally as a range ("24-48 hours") or glued ("48h").
const STARVE_HOURS =
  "(?:\\d+\\s*(?:-|to|or)\\s*)?(?:2[4-9]|[3-9]\\d|\\d{3,})\\s*(?:hours?|hrs?|h)";
const STARVE_DURATION = `(?:days?|weeks?|fortnights?|months?|${STARVE_HOURS})`;
// An optional hedge before the quantity: "more than a week", "at least 3 days".
const STARVE_HEDGE =
  "(?:(?:more\\s+than|over|at\\s+least|about|around|almost|nearly)\\s+)?";
// "(qty) duration": the quantity is optional ("for days") and may be glued to
// its unit ("3days").
const QTY_DURATION = `${STARVE_HEDGE}(?:${STARVE_QTY}\\s*)?${STARVE_DURATION}`;
const FOR_DURATION = `for\\s+${QTY_DURATION}`;
// A negating verb. The contraction is tied to its auxiliary ("don't", "dont",
// "can't", "wont", "shan't"), so a word that merely ends in "nt" ("consistent eating",
// "plant eating") is not read as a negation.
const STARVE_NEGATION =
  "\\b(?:stop|quit|skip|avoid|cease|not|cannot|never|refuse\\s+to|(?:do|does|did|wo|ca|could|would|should|must|have|has|had|is|are|was|were|ai|need|might|ought|sha)n['\\u2019]?t)";
const GO = "\\b(?:go|going|goes|went|gone)";
const WITHOUT_EATING = "without\\s+(?:eating|food)\\b";
const PROLONGED_STARVATION = new RegExp(
  [
    // stop/skip/not/don't (or "dont")/haven't eat(ing/en) [anything] for <duration>
    `${STARVE_NEGATION}\\s+eat(?:ing|en)?\\s+(?:(?:anything|any\\s+food|food|at\\s+all|entirely|completely|altogether)\\s+)*${FOR_DURATION}\\b`,
    // eat nothing for <duration>
    `\\beat(?:ing)?\\s+nothing\\s+${FOR_DURATION}\\b`,
    // go/went/gone (for) <duration> without eating/food
    `${GO}\\s+(?:for\\s+)?${QTY_DURATION}\\s+${WITHOUT_EATING}`,
    // go/went/gone without eating/food for <duration>
    `${GO}\\s+${WITHOUT_EATING}(?:\\s+(?:anything|at\\s+all))?\\s+${FOR_DURATION}\\b`,
    // starve/starved/starving + reflexive
    `\\bstarv(?:e|ed|ing)\\s+(?:myself|yourself|himself|herself|themselves|ourselves)\\b`,
    `\\bhow\\s+long\\s+(?:can|could|would)\\s+(?:i|you|a\\s+person|someone|one)\\s+(?:go|survive|last)\\s+${WITHOUT_EATING}`,
  ].join("|"),
  "i",
);

// ── Safety patterns (ordered; first match wins) ──────────────────────────────

/**
 * Suicide and self-harm wording. One pattern for the router and for
 * matchesSelfHarm. "suicid" is a stem ("suicide", "suicidal"). The phrases
 * are first-person and reflexive ("kill myself", not "kill"), because the
 * coach hears a lot of food talk that shares the words: "this diet is
 * killing me", "to die for", "I cut myself chopping onions". "hurt / harm /
 * cut myself" therefore needs an intent verb in front, and "don't want to
 * live" must not run on into "on salads" / "off shakes". That veto is
 * kept to those two words on purpose: "like this", "with this pain" and
 * "without him" are how people say it, and over-matching is the safe side.
 * "cut myself" also stops short of "a slice", "some slack" and "off from
 * sugar", but only for those named continuations: "cut myself a little"
 * and "cut myself a lot" still match.
 */
const SELF_HARM_RE = new RegExp(
  [
    "self.?harm",
    "suicid",
    "\\bkill(?:ing)?\\s+my\\s?self\\b",
    "\\b(?:end|tak)(?:e|ing)?\\s+my\\s+(?:own\\s+)?life\\b",
    "\\bend(?:ing)?\\s+it\\s+all\\b",
    "\\bwant\\s+to\\s+die\\b",
    "\\bwish\\s+i\\s+(?:was|were)\\s+dead\\b",
    "\\bbetter\\s+off\\s+(?:dead|without\\s+me)\\b",
    "\\b(?:don['’]?t|do\\s+not)\\s+want\\s+to\\s+(?:be\\s+alive\\b|live\\b(?!\\s+(?:on|off)\\b))",
    "\\b(?:want(?:ed)?|going|plan(?:ning)?|thinking\\s+(?:of|about))\\s+(?:to\\s+)?(?:(?:hurt|harm)(?:ing)?\\s+my\\s?self\\b|cut(?:ting)?\\s+my\\s?self\\b(?!\\s+(?:(?:a|an|some)\\s+(?:\\w+\\s+)?(?:slice|piece|portion|serving|wedge|slack|break)|off|loose|free)\\b))",
  ].join("|"),
  "i",
);

/**
 * Purging, said about oneself or as a way to undo eating: "make myself throw
 * up", "purge after dinner", "throw up to undo those calories". The bare
 * words are everyday kitchen and family talk ("purge my pantry of junk food",
 * "my son vomited after dinner", "throw up some ideas"), and one match also
 * turns that user's weekly report into the safety template (audit
 * 2026-11-24, M31).
 */
const PURGING =
  "\\bma(?:ke|king|de)\\s+my\\s?self\\s+(?:throw\\s+up|vomit|sick|puke)\\b" +
  "|\\b(?:purg(?:e|ing)|throw(?:ing)?\\s+up|vomit(?:ing)?|puk(?:e|ing))\\s+(?:up\\s+)?(?:after\\b|to\\s+(?:undo|get\\s+rid|lose|make\\s+up|cancel)\\b|(?:my|a|the)\\s+(?:food|meals?|dinner|lunch|breakfast|binge)\\b|what\\s+i\\s+(?:ate|eat)\\b|everything\\s+i\\s+(?:ate|eat)\\b)" +
  // "want to throw up" as distress; not "the smell makes me want to vomit"
  // and not "want to purge my pantry".
  "|(?<!ma(?:kes?|de|king)\\s+me\\s+)\\b(?:want|need|have|trying|going)\\s+to\\s+(?:throw\\s+up|purge|vomit)\\b(?!\\s+(?:my|the|some|a|an|out)\\b)" +
  // Said plainly about oneself: "I binge and purge", "I purged last night",
  // "How do I purge?". A kitchen object after it is not this.
  "|\\bbinge(?:s|d|ing)?\\s+and\\s+purg" +
  "|\\bi\\s+(?:(?:have\\s+been|keep|just|always|sometimes|often)\\s+)?purg(?:e|ed|ing)\\b(?!\\s+(?:my|the|our|all|some|clams?|mussels?|shellfish)\\b)";

/**
 * An eating disorder or bingeing, said about oneself: "I think I have
 * anorexia", "I'm bulimic", "I've been bingeing", "I keep binge eating".
 * Talk about the topic ("what is anorexia", "my friend has bulimia") and
 * binge-watching are ordinary (audit 2026-11-24, L46; owner 2026-11-25).
 */
const ED_NAME =
  "(?:(?:an?\\s+)?eating\\s+disorder|anorexia(?:\\s+nervosa)?|bulimia(?:\\s+nervosa)?|binge[\\s-]eating(?:\\s+disorder)?|arfid|orthorexia)";
const NOT_SCREEN_BINGE =
  "(?![\\s-]*watch|\\s+(?:on\\s+)?(?:netflix|tv|shows?|series|youtube|podcasts?|movies?|films?)\\b)";
const NAMED_DISORDER =
  `\\bi\\s+(?:think\\s+i\\s+|might\\s+|may\\s+|probably\\s+)?(?:(?:might|may)\\s+)?(?:have|had|struggle\\s+with|suffer\\s+from|(?:was|got|have\\s+been)\\s+diagnosed\\s+with)\\s+${ED_NAME}\\b` +
  `|\\bi(?:['’]m|\\s+am)\\s+(?:(?:in\\s+)?recover(?:y|ing)\\s+from\\s+${ED_NAME}\\b|(?:an?\\s+)?(?:anorexic|bulimic)\\b)` +
  `|\\bi(?:['’]ve|\\s+have)\\s+been\\s+(?:binge[\\s-]?eating|bing(?:e)?ing)\\b${NOT_SCREEN_BINGE}` +
  `|\\bi\\s+(?:keep|always|often|sometimes)\\s+(?:binge[\\s-]?eat(?:ing)?|bing(?:e)?(?:ing)?)\\b${NOT_SCREEN_BINGE}`;

const DISORDERED_EATING_RE = new RegExp(
  `${PURGING}|${NAMED_DISORDER}|${SELF_HARM_RE.source}`,
  "i",
);

/**
 * Zero-width characters, the soft hyphen and the BOM, which pasted text and
 * some keyboards put inside words. One inside "suicide" broke every match
 * (audit 2026-11-24, L17).
 */
const INVISIBLE_CHARS_RE = /[\u00AD\u180E\u200B-\u200F\u2060-\u2064\uFEFF]/g;

/**
 * The text the safety patterns read: NFKC (full-width letters become plain
 * ones) with the invisible characters removed.
 */
function normalizeForSafety(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE_CHARS_RE, "");
}

/** A fast of 24 hours or longer, as a number of hours. */
const LONG_FAST_HOURS = "(?:2[4-9]|[3-9]\\d|\\d{3,})";
/** A count of days or weeks for a fast, as digits or a number word. */
const FAST_COUNT =
  "(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|several|a\\s+few|multi)";

/**
 * Extended fasting: a water fast, or any fast of 24 hours or longer. A 12-18
 * hour window is ordinary intermittent fasting, the coach's own safe
 * alternative, and must not load the refusal bundle (audit 2026-11-24, M31).
 * "I drink water fast after workouts" and "a 2 day fast-food detox" are not
 * fasts.
 */
const EXTREME_FASTING_RE = new RegExp(
  [
    "\\bwater[\\s-](?:only[\\s-])?fast(?:s|ing)?\\b(?!\\s+(?:after|when|during|before|at|with|while)\\b)",
    `\\b${LONG_FAST_HOURS}[\\s-]?(?:hours?|hrs?)[\\s-]+(?:water[\\s-]+)?fast`,
    `\\b${FAST_COUNT}[\\s-]days?[\\s-]+(?:water[\\s-]+)?fast(?![\\s-]food)`,
    `\\bfast(?:ing)?\\s+for\\s+(?:${LONG_FAST_HOURS}\\s*(?:hours?|hrs?)|${FAST_COUNT}\\s+(?:days?|weeks?))\\b`,
    "\\bweek[\\s-]long\\s+(?:water[\\s-](?:only[\\s-])?)?fast",
  ].join("|"),
  "i",
);

/**
 * "Ignore / disregard / forget ... <the assistant's rules>". The gap keeps
 * the 2000-char bound (the message cap), so padding cannot push the object
 * out of range; the object has to name the assistant's own instructions
 * ("your", "all", "previous", "system", "safety"), so "ignore the cooking
 * instructions on the box" and "ignore the sugar guidelines on cheat days"
 * stay ordinary (audit 2026-11-24, M31).
 */
const INJECTION_IGNORE_RE =
  /\b(?:ignore|disregard|forget|override)\b[\s\S]{0,2000}?(?:\b(?:your|all|any|every|these|those|previous|prior|above|earlier|system)\s+(?:\w+\s+){0,2}(?:instructions?|rules?|guidelines?|prompts?|restrictions?|guardrails?|training|protocols?)\b|(?<!\bfood\s)\bsafety\b(?!\s+(?:dates?|valve|seal|cap|labels?|tips?)\b)|\bthe\s+(?:instructions?|rules?|guidelines?)\b(?!\s+(?:on|of|for|in|from)\s+(?!(?:this|our)\s+(?:chat|conversation|session)\b|your\s+(?:developers?|creators?|makers?)\b))|\beverything\s+you\s+(?:were|have\s+been|\'ve\s+been)\s+told\b)/i;

/**
 * Laxatives, diuretics or diet pills used for weight control. A question
 * about constipation or whether coffee is a diuretic is ordinary.
 */
const WEIGHT_CONTROL =
  "(?:los(?:e|ing)\\s+(?:weight|pounds|lbs)|weight\\s+loss|drop\\s+(?:a\\s+few\\s+)?(?:pounds|lbs|weight)|stay\\s+(?:thin|skinny)|slim(?:mer)?\\s+down|after\\s+(?:every|each)\\s+meal|weigh[\\s-]in)";
const PILLS = "(?:laxatives?|diuretics?|water\\s+pills?|diet\\s+pills?)";
const PILL_MISUSE_RE = new RegExp(
  `\\b${PILLS}\\b[\\s\\S]{0,2000}?\\b${WEIGHT_CONTROL}\\b|\\b${WEIGHT_CONTROL}\\b[\\s\\S]{0,2000}?\\b${PILLS}\\b`,
  "i",
);

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
    // Disordered eating / self-harm signals. The self-harm half is
    // SELF_HARM_RE itself, so every wording that routes here also selects the
    // crisis message (matchesSelfHarm) and none gets the eating-focused text.
    pattern: DISORDERED_EATING_RE,
    name: "disordered_eating",
  },
  {
    // Supplement megadose by name. A dose in IU is judged by its size, in
    // isIuMegadose: "600 IU of vitamin D" is a standard dose.
    pattern: /(mega.?dose|toxic dose)/i,
    name: "megadose",
  },
  {
    pattern: PILL_MISUSE_RE,
    name: "pill_misuse",
  },
  {
    pattern: INJECTION_IGNORE_RE,
    name: "prompt_injection_ignore",
  },
  {
    pattern: EXTREME_FASTING_RE,
    name: "extreme_fasting",
  },
  {
    // Plain-language prolonged starvation — "stop eating for a week", "not eat
    // for 5 days", "go without food for a week", "go 7 days without eating",
    // "how long can I go without food". The verb must be followed DIRECTLY by
    // (an optional "anything/food/at all") and then the duration, so a named
    // food ("stop eating meat for a week"), a clock time ("stop eating after
    // 8pm") or a quantity ("stop eating so much junk") never matches. Only
    // day/week (or 24+ hour) durations trip it; "fast for 12 hours" and "stop
    // eating 2 hours before sleep" stay ordinary. "starve myself" (reflexive)
    // trips; "starving, what should I eat" and "starve off hunger" do not.
    pattern:
      /(?:(?:\b(?:stop|quit|skip|avoid|cease|not)|n['\u2019]t)\s+eat(?:ing)?\s+(?:(?:anything|any\s+food|food|at\s+all|entirely|completely|altogether)\s+)*for\s+(?:(?:a|an|one|two|three|several|few|a\s+few|many|some|\d+)\s+)?(?:days?|weeks?|(?:2[4-9]|[3-9]\d|\d{3,})\s*(?:hours?|hrs?))\b|\bgo(?:ing)?\s+(?:for\s+)?(?:(?:a|an|one|two|three|several|few|a\s+few|many|some|\d+)\s+)?(?:days?|weeks?|(?:2[4-9]|[3-9]\d|\d{3,})\s*(?:hours?|hrs?))\s+without\s+(?:eating|food)\b|\bgo(?:ing)?\s+without\s+(?:eating|food)\s+for\s+(?:(?:a|an|one|two|three|several|few|a\s+few|many|some|\d+)\s+)?(?:days?|weeks?|(?:2[4-9]|[3-9]\d|\d{3,})\s*(?:hours?|hrs?))\b|\bstarv(?:e|ing)\s+(?:myself|yourself|himself|herself|themselves|ourselves)\b|\bhow\s+long\s+(?:can|could|would)\s+(?:i|you|a\s+person|someone|one)\s+(?:go|survive|last)\s+without\s+(?:eating|food)\b)/i,
    name: "prolonged_starvation",
  },
  {
    // Wider phrasings of the same intent, as a SECOND entry so the one above
    // (#1333) keeps everything it already refuses: this entry can only add
    // refusals, never remove one. Adds months, number words, ranges ("2-3
    // days", "3+", "1.5 weeks", "48h"), hedges ("more than a week"),
    // contractions tied to their auxiliary ("dont", "isn't", "haven't
    // eaten" — so "consistent eating" is not a negation), "went/gone N days
    // without food", "eat nothing for a week" and "starved myself".
    pattern: PROLONGED_STARVATION,
    name: "prolonged_starvation",
  },
  {
    // Jailbreak via persona reassignment — [\s\S]{0,2000} matches across
    // newlines; the bound equals the 2000-char message cap (see above) so a
    // padded injection cannot push the keyword past the gap.
    pattern:
      /(unrestricted[\s\S]{0,2000}\b(?:ai|assistant|coach|bot|chatbot|model|mode|persona|guru|expert|advis[eo]r|trainer|nutritionist|dietitian)\b|unrestricted\s+(?:\w+\s+){0,2}(?:advice|answers?|responses?)\b|no safety guidelines|you are now \w+bot)/i,
    name: "jailbreak_persona",
  },
];

/** Above this, a dose in IU is past the usual adult upper limits. */
const IU_UPPER_LIMIT = 4000;

/** "50,000 IU", "20000 IU": a dose in IU above the upper limit. */
function isIuMegadose(message: string): boolean {
  // "50,000", "50 000" and "50.000" are the same dose.
  for (const m of message.matchAll(/(\d{1,3}(?:[ ,.]\d{3})+|\d+)\s*iu\b/gi)) {
    if (Number(m[1].replace(/[ ,.]/g, "")) > IU_UPPER_LIMIT) return true;
  }
  return false;
}

/** A calorie figure with its unit: "900 calories", "1100 kcal", "600 calorie". */
const CALORIE_FIGURE_RE =
  /(?<![\d.])(\d{2,4})(?!\d)\s*-?\s*(?:k?cal(?:orie)?s?|kilocalories)\b/gi;
/**
 * Right after the figure: "per day", "a day", "daily", "/day", with at most
 * a plan word between ("500 calorie meal plan for each day", "800 calories
 * total per day"). A meal noun between them makes it a per-meal figure.
 */
const DAILY_AFTER_RE =
  /^(?:\s*\/\s*day\b|[\s-]+(?:(?:total|in\s+total|meal\s+plan|plan|diet|limit|target|max|maximum)\s+)?(?:(?:per|a|each|every|in\s+a|for\s+the|for\s+each|all)[\s-]+day|daily)\b)/i;
/** Before the figure: an amount to change by or burned, not an intake. */
const CALORIE_CHANGE_BEFORE_RE =
  /\b(?:cut(?:ting)?|trim(?:ming)?|burn(?:s|ed|ing)?|add(?:ing)?|sav(?:e|ing)|deficit\s+of|surplus\s+of|by|extra|another)\s+(?:(?:about|around|roughly|up\s+to)\s+)*$/i;

/**
 * True when the message asks for a daily intake under 1,200 calories: the
 * figure has to be followed directly by its daily marker ("800 kcal a day",
 * "900 cal/day", "a 1,199 calorie daily limit"). A per-meal figure followed
 * later by "today" or "Monday" is ordinary food talk (audit 2026-11-24,
 * M32 + M33).
 */
function asksForLowDailyCalories(message: string): boolean {
  // "1,100" → "1100" so the figure is read whole.
  const s = message.replace(/(\d),(?=\d{3}(?!\d))/g, "$1");
  for (const m of s.matchAll(CALORIE_FIGURE_RE)) {
    if (Number(m[1]) >= 1200) continue;
    const after = s.slice(m.index + m[0].length);
    if (!DAILY_AFTER_RE.test(after)) continue;
    if (CALORIE_CHANGE_BEFORE_RE.test(s.slice(0, m.index))) continue;
    return true;
  }
  return false;
}

// ── Vague request ─────────────────────────────────────────────────────────────

const VAGUE_EXACT_RE = /^(help|hi|hey|hello|idk|i don.?t know)$/i;

/**
 * A short message that answers the coach's last question or tells it what to
 * do: "Yes please", "The second one", "Log 2 eggs". These are not vague, and
 * the vague bundle ("ask ONE clarifying question, never guess") would stop
 * the coach acting on them (audit 2026-11-24, M34).
 */
const SHORT_ANSWER_RE =
  /^(?:yes|yeah|yep|yup|sure|ok|okay|no|nope|nah|please|thanks|thank\s+you|go\s+ahead|sounds\s+good|do\s+it|that\s+works|perfect|great|both|neither|either|the\s+\w+|that\s+one|this\s+one|option\s+\w+|first|second|third|last|(?:\d+|one|two|three|four|five|six)\s+\w+)\b|\binstead$/i;
const SHORT_COMMAND_RE =
  /^(?:log|add|plan|save|remove|delete|swap|make|change|show|find|use|skip|replace|set|track|undo|try|keep|cancel|start|stop)\b/i;

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

// "a recipe", "some quick vegan recipes" (not "a recipe on/in/into …", which
// files one). {0,3} matches recipe_leading's modifier bound. A modifier is
// never a referent determiner, so "a name for my recipe" is not one.
const REFERENT_DETERMINER = String.raw`(?:this|that|these|those|my)`;
const INDEFINITE_RECIPE = String.raw`\b(?:a|an|any|another|new|different|some)\s+(?:(?!${REFERENT_DETERMINER}\b)[\w-]+\s+){0,3}recipes?\b(?!\s+(?:on|in|into)\b)`;
// "this recipe", "my lasagna recipe".
const REFERENT_RECIPE = String.raw`\b${REFERENT_DETERMINER}\s+(?:[\w-]+\s+){0,2}recipes?\b`;

/**
 * Acting on a meal or a recipe the user already has is a coach action (log,
 * meal plan, grocery list, substitutions, nutrition), not a search — the
 * coach's tools answer it (#1151 review). A referent vetoes only when no
 * indefinite recipe comes before it: "Find me a recipe like my lasagna
 * recipe" routes, "Turn my chili recipe into a slow-cooker recipe" does not.
 * Known miss: a referent-first message that then asks for a new one ("My
 * chili recipe is boring. Find me a better one") stays with the coach.
 */
const RECIPE_REQUEST_EXCLUSIONS: RegExp[] = [
  // Logging/saving/tracking.
  /\b(?:log|logged|logging|save|saved|delete|track)\b[^.?!]{0,30}\b(?:recipe|meal|dinner|lunch|breakfast|brunch)s?\b/i,
  // A recipe they already have, named before any request for a new one. One
  // left-to-right pass; each step's lookahead is bounded by the word counts.
  new RegExp(
    String.raw`^(?:(?!${INDEFINITE_RECIPE})[\s\S])*?${REFERENT_RECIPE}`,
    "i",
  ),
  // Asking about one: "the calories in the recipe", "a shopping list for it".
  /\b(?:calories|macros|nutrition|nutrients|protein|carbs|fat|ingredients|grocery list|shopping list|substitutes?|substitutions?)\s+(?:in|of|for|from)\s+(?:the|this|that|these|those|my)\s+(?:[\w-]+\s+){0,2}recipes?\b/i,
  // Filing one: "add a recipe to my meal plan".
  /\b(?:add|put)\s+(?:(?:a|an|the)\s+)?(?:[\w-]+\s+){0,2}recipes?\s+(?:to|on|in|into)\b/i,
];

// ── Classifier ────────────────────────────────────────────────────────────────

function wordCount(message: string): number {
  return message.trim().split(/\s+/).length;
}

/**
 * The classifier's own disordered-eating / self-harm pattern, for callers
 * that need the signal without routing a message (the weekly report reads it
 * over the week's coach messages). One regex, no copy.
 */
export function matchesDisorderedEating(text: string): boolean {
  return DISORDERED_EATING_RE.test(normalizeForSafety(text));
}

/**
 * True when a message names suicide or self-harm. It picks which safety
 * message a turn gets once the turn is already routed to safety. It reads the
 * same pattern the router does, so the two cannot disagree.
 */
export function matchesSelfHarm(text: string): boolean {
  return SELF_HARM_RE.test(normalizeForSafety(text));
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
  const trimmed = normalizeForSafety(message).trim();

  // ── Rule 1: safety_refusal (highest priority) ─────────────────────────────
  for (const { pattern, name } of SAFETY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { intent: "safety_refusal", matchedRule: name };
    }
  }

  if (isIuMegadose(trimmed)) {
    return { intent: "safety_refusal", matchedRule: "megadose" };
  }

  if (asksForLowDailyCalories(trimmed)) {
    return {
      intent: "safety_refusal",
      matchedRule: "calorie_restriction_below_1200",
    };
  }

  // ── Rule 2: recipe_request (after safety, before vague/general_fact) ──────
  if (
    opts.recipeRequests !== false &&
    !RECIPE_REQUEST_EXCLUSIONS.some((re) => re.test(trimmed))
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
    (wordCount(trimmed) <= 3 &&
      !hasQuestion &&
      !SHORT_ANSWER_RE.test(trimmed) &&
      !SHORT_COMMAND_RE.test(trimmed))
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
