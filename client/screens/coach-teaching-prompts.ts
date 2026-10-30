/**
 * The free NutriCoach's starter prompts (spec 2026-10-30). "ask" prompts go to
 * the coach as before. "teach" and "pro" prompts are answered right here in the
 * app: no AI call, and none of the person's daily coach messages is spent.
 */
export type SuggestedPrompt =
  | { kind: "ask"; text: string }
  | {
      kind: "teach";
      text: string;
      answer: string;
      actionLabel: string;
      target: "Scan";
    }
  | { kind: "pro"; text: string; answer: string; actionLabel: string };

export const SUGGESTED_PROMPTS: SuggestedPrompt[] = [
  { kind: "ask", text: "What should I eat today?" },
  { kind: "ask", text: "How can I hit my protein goal?" },
  {
    kind: "teach",
    text: "What's the fastest way to log a meal?",
    answer:
      "Use the camera. Tap the + button and scan the barcode or the nutrition label. It fills in the food for you, no typing needed.",
    actionLabel: "Open camera",
    target: "Scan",
  },
  {
    kind: "pro",
    text: "How did my week go?",
    answer:
      "Coach Pro can look back over everything you logged this week and tell you how it went: what's on track and what to change next. NutriCoach answers general questions; Coach Pro knows your days.",
    actionLabel: "See Coach Pro",
  },
];
