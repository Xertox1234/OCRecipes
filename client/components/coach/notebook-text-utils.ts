/**
 * Notebook entries are extracted by the model in the third person
 * ("User has…", "The user has…", "User's breakfast…"). Show them to the user
 * in the second person without changing what is stored.
 */
const IRREGULAR: Record<string, string> = {
  has: "have",
  is: "are",
  was: "were",
  does: "do",
  "isn't": "aren't",
  "wasn't": "weren't",
  "doesn't": "don't",
  "hasn't": "haven't",
};

function rewriteLeadingSubject(text: string): string {
  if (/^User's\b/.test(text)) return text.replace(/^User's\b/, "Your");
  const m = /^User (\w+n't|\w+)/.exec(text);
  if (!m) return text;
  const verb = m[1];
  const lower = verb.toLowerCase();
  let converted = verb;
  if (IRREGULAR[lower]) converted = IRREGULAR[lower];
  else if (lower.endsWith("ies")) converted = verb.slice(0, -3) + "y";
  else if (/(sses|shes|ches|xes|oes)$/.test(lower))
    converted = verb.slice(0, -2);
  else if (lower.endsWith("s") && !lower.endsWith("ss"))
    converted = verb.slice(0, -1);
  return text.replace(/^User (?:\w+n't|\w+)/, `You ${converted}`);
}

export function toSecondPerson(text: string): string {
  const normalised = text.replace(/^The user\b/i, "User");
  const rewritten = rewriteLeadingSubject(normalised);
  if (rewritten === normalised) return text;
  // Only a note that opened with the user as its subject gets "their" → "your":
  // elsewhere "their" may mean someone else ("Kids like their pasta plain").
  return rewritten
    .replace(/\btheir\b/g, "your")
    .replace(/\bthemselves\b/g, "yourself");
}
