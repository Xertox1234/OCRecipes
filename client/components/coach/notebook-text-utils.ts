/**
 * Notebook entries are extracted by the model in the third person
 * ("User has…", "User's breakfast…"). Show them to the user in the second
 * person without changing what is stored.
 */
const IRREGULAR: Record<string, string> = {
  has: "have",
  is: "are",
  was: "were",
  does: "do",
};

export function toSecondPerson(text: string): string {
  if (/^User's\b/.test(text)) return text.replace(/^User's\b/, "Your");
  const m = /^User (\w+)/.exec(text);
  if (!m) return text;
  const verb = m[1];
  const lower = verb.toLowerCase();
  let converted = verb;
  if (IRREGULAR[lower]) converted = IRREGULAR[lower];
  else if (lower.endsWith("ies")) converted = verb.slice(0, -3) + "y";
  else if (/(sses|shes|ches|xes)$/.test(lower)) converted = verb.slice(0, -2);
  else if (lower.endsWith("s") && !lower.endsWith("ss"))
    converted = verb.slice(0, -1);
  return text.replace(/^User \w+/, `You ${converted}`);
}
