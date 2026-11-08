/**
 * The Coach's opening brief: the first message of a new chat, assembled from
 * the day's data with fixed wording (no model call). Shared so the server can
 * render it for `GET /api/coach/brief` AND re-render the exact same text when
 * it saves the brief into the conversation on the first send — the client
 * never sends assistant text (spec: 2026-11-08-coach-opening-brief-design).
 */
import { remainingCaloriesStat } from "./coach-stats";
import { toSecondPerson } from "./notebook-text";

export type BriefForm = "full" | "short";

export type ShowableReminder =
  | { type: "commitment"; notebookEntryId: number; content: string }
  | { type: "meal-log" }
  | { type: "daily-checkin" };

export interface BriefInput {
  /** 0–23 in the user's own timezone. */
  localHour: number;
  name: string | null;
  consumedCalories: number;
  calorieGoal: number | null;
  consumedProtein: number;
  proteinGoal: number | null;
  tonightPlan: string | null;
  expiringPantry: string[];
  topTip: string | null;
  suggestions: string[];
  reminder: ShowableReminder | null;
}

export interface BriefStat {
  value: string;
  label: string;
}

export interface BriefAction {
  label: string;
  kind: "send" | "quick-log";
  message?: string;
}

export interface BriefReminder {
  type: ShowableReminder["type"];
  lead: string;
  actions: BriefAction[];
}

export interface RenderedBrief {
  greeting: string;
  recap: string;
  stats: BriefStat[];
  pointer: string | null;
  reminder: BriefReminder | null;
  suggestions: string[];
  /** The plain brief as it is saved to the conversation — no button labels. */
  text: string;
}

/** `chat_messages.metadata` of a saved opening brief. */
export const OPENING_BRIEF_METADATA = { kind: "opening_brief" } as const;

/** True for the saved opening brief row (metadata is untyped jsonb). */
export function isOpeningBriefMessage(message: { metadata: unknown }): boolean {
  const meta = message.metadata;
  return (
    typeof meta === "object" &&
    meta !== null &&
    (meta as { kind?: unknown }).kind === OPENING_BRIEF_METADATA.kind
  );
}

const MAX_CHIPS = 3;
const MAX_TILE_CHARS = 18;

export function greetingFor(localHour: number, name: string | null): string {
  const part =
    localHour < 12 ? "morning" : localHour < 17 ? "afternoon" : "evening";
  return name ? `Good ${part}, ${name}.` : `Good ${part}.`;
}

const whole = (n: number) => (Math.round(n) + 0).toLocaleString();

function proteinLeft(input: BriefInput): number {
  if (input.proteinGoal == null) return 0;
  return Math.max(0, Math.round(input.proteinGoal - input.consumedProtein));
}

function recapFor(input: BriefInput): string {
  if (Math.round(input.consumedCalories) <= 0)
    return "Nothing logged yet today.";
  if (input.calorieGoal == null) {
    return `You've logged ${whole(input.consumedCalories)} calories so far.`;
  }
  const calories = `You're at ${whole(input.consumedCalories)} of ${whole(input.calorieGoal)} calories.`;
  const goal = input.proteinGoal;
  if (goal == null || proteinLeft(input) <= 0) return calories;
  return `${calories} Protein is behind at ${whole(input.consumedProtein)} of ${whole(goal)} g.`;
}

function shorten(text: string): string {
  return text.length <= MAX_TILE_CHARS
    ? text
    : `${text.slice(0, MAX_TILE_CHARS - 1)}…`;
}

function statsFor(input: BriefInput): BriefStat[] {
  if (input.calorieGoal == null) return [];
  const stats: BriefStat[] = [
    remainingCaloriesStat(input.calorieGoal, input.consumedCalories),
  ];
  const left = proteinLeft(input);
  if (left > 0) stats.push({ value: `${left} g`, label: "Protein to go" });
  if (input.tonightPlan) {
    stats.push({ value: shorten(input.tonightPlan), label: "Tonight" });
  }
  return stats;
}

function pointerFor(input: BriefInput): string | null {
  const [expiring] = input.expiringPantry;
  if (expiring) {
    return input.tonightPlan
      ? `Your ${expiring} expires soon. It could go in tonight's ${input.tonightPlan}.`
      : `Your ${expiring} expires soon.`;
  }
  if (input.tonightPlan) return `Tonight's plan is ${input.tonightPlan}.`;
  if (input.topTip) return input.topTip;
  const left = proteinLeft(input);
  if (left > 0) return `${left} g protein left today.`;
  return null;
}

/**
 * Notebook commitments are stored in the third person ("The user agreed to
 * add…"); speak them back as "You agreed to add…". A plain action ("Drink
 * more water") reads as something the user said they'd do.
 */
function commitmentLead(content: string): string {
  const text = content.trim().replace(/[.!]+$/, "");
  const spoken = toSecondPerson(text);
  if (spoken !== text) return `${spoken}. How did it go?`;
  const action = text.charAt(0).toLowerCase() + text.slice(1);
  return `Earlier you said you'd ${action}. How did it go?`;
}

function mealFor(localHour: number): string {
  if (localHour < 11) return "breakfast";
  if (localHour < 16) return "lunch";
  if (localHour < 21) return "dinner";
  return "snack";
}

function reminderFor(
  reminder: ShowableReminder,
  localHour: number,
): BriefReminder {
  switch (reminder.type) {
    case "commitment":
      return {
        type: "commitment",
        lead: commitmentLead(reminder.content),
        actions: [
          { label: "Went well", kind: "send", message: "It went well" },
          { label: "Partly", kind: "send", message: "It went partly" },
          { label: "Didn't happen", kind: "send", message: "It didn't happen" },
        ],
      };
    case "meal-log":
      return {
        type: "meal-log",
        lead: "Nothing logged yet today.",
        actions: [{ label: `Log ${mealFor(localHour)}`, kind: "quick-log" }],
      };
    case "daily-checkin":
      return {
        type: "daily-checkin",
        lead: "Time for your check-in.",
        actions: [
          {
            label: "How was my day?",
            kind: "send",
            message: "How was my day?",
          },
        ],
      };
  }
}

export function renderOpeningBrief(
  input: BriefInput,
  form: BriefForm,
): RenderedBrief {
  const greeting = greetingFor(input.localHour, input.name);
  const recap = recapFor(input);
  if (input.reminder) {
    const reminder = reminderFor(input.reminder, input.localHour);
    return {
      greeting,
      recap,
      stats: [],
      pointer: null,
      reminder,
      suggestions: input.suggestions.slice(0, MAX_CHIPS),
      text: [greeting, reminder.lead, recap].join("\n\n"),
    };
  }
  if (form === "short") {
    return {
      greeting,
      recap,
      stats: [],
      pointer: null,
      reminder: null,
      suggestions: [],
      text: [greeting, recap].join("\n\n"),
    };
  }
  const pointer = pointerFor(input);
  return {
    greeting,
    recap,
    stats: statsFor(input),
    pointer,
    reminder: null,
    suggestions: input.suggestions.slice(0, MAX_CHIPS),
    text: [greeting, recap, pointer].filter(Boolean).join("\n\n"),
  };
}
