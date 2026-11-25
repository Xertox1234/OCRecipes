/**
 * Coach's notes hold no medical conditions and no medications (owner ruling
 * 2026-11-25: a condition belongs in the profile from onboarding; medications
 * are not kept). This is the code screen behind that rule, for the notes
 * Coach extracts and the ones a user types. It errs toward dropping: a lost
 * note costs little, a stored diagnosis is health data in the wrong place.
 * A word list cannot name every condition or drug: the extraction prompt
 * carries the rule too, and a typed note that names only an unlisted drug
 * gets through.
 *
 * Words are chosen so ordinary food notes pass: "heart-healthy", "pressure
 * cooker", "low-sodium" and "cutting carbs" name no condition.
 */
const CONDITIONS = [
  "(?:pre)?diabet\\w*",
  "hypertension",
  "(?:high|low)\\s+blood\\s+pressure",
  "high\\s+cholesterol",
  "insulin\\s+resistan\\w*",
  "(?:hypo|hyper)thyroid\\w*",
  "thyroid\\s+(?:disease|condition|disorder|problem)s?",
  "hashimoto\\w*",
  "c(?:o)?eliac",
  "crohn\\w*",
  "colitis",
  "ibs",
  "ibd",
  "gerd",
  "acid\\s+reflux",
  "gastroparesis",
  "pcos",
  "endometriosis",
  "gout",
  "an(?:a)?emi[ac]",
  "epilep\\w*",
  "cancer",
  "chemo(?:therapy)?",
  "(?:kidney|renal|liver|heart|cardiac|cardiovascular|coronary)\\s+(?:disease|condition|failure|problem|attack)s?",
  "stroke",
  "depression",
  "bipolar",
  "anxiety\\s+disorder",
  "adhd",
  "eating\\s+disorder",
  "anorexi[ac]",
  "bulimi[ac]",
  "binge[- ]eating\\s+disorder",
  "pregnan\\w*",
  "breast[- ]?feeding",
  "postpartum",
  "menopaus\\w*",
  "(?:bariatric|gastric|weight[- ]loss)\\s+(?:surgery|bypass|sleeve|band)",
  "asthma\\w*",
  "arthritis",
  "lupus",
  "migraines?",
  "hypoglyc(?:a)?emi[ac]",
  "(?:high|low)\\s+blood\\s+sugar",
  "kidney\\s+stones?",
  "diagnos\\w*",
];

const MEDICATIONS = [
  "ozempic",
  "wegovy",
  "mounjaro",
  "zepbound",
  "rybelsus",
  "saxenda",
  "semaglutide",
  "tirzepatide",
  "liraglutide",
  "glp[- ]?1",
  "metformin",
  "insulin",
  "statins?",
  "levothyroxine",
  "antidepressants?",
  "ssris?",
  "beta[- ]blockers?",
  "blood\\s+thinners?",
  "anticoagulants?",
  "warfarin",
  "lisinopril",
  "antibiotics?",
  "steroids?",
  "inhalers?",
  "medications?",
  "meds",
  "prescri\\w*",
];

const HEALTH_NOTE_RE = new RegExp(
  `\\b(?:${[...CONDITIONS, ...MEDICATIONS].join("|")})\\b`,
  "i",
);

/** True when the text names a medical condition or a medication. */
export function mentionsHealthCondition(text: string): boolean {
  return HEALTH_NOTE_RE.test(text);
}
