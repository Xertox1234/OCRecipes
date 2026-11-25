/**
 * Cook mode (Coach roadmap V1): the pure parts. A recipe's steps are plain
 * text with no stored durations, so a step's timers are read from its own
 * wording ("simmer for 10 minutes").
 */

export interface StepTimer {
  /** How long the timer runs. A range starts at its lower end. */
  seconds: number;
  /** Short spoken and shown name: "10 min", "8–10 min", "1 hr 30 min". */
  label: string;
}

export type CookCard =
  | { kind: "ready"; ingredients: string[] }
  | {
      kind: "step";
      /** 1-based, counting only the steps that have text. */
      number: number;
      text: string;
      detail: string | null;
      timers: StepTimer[];
    };

/** Shorter than this is not worth a timer; longer is not a kitchen timer. */
const MIN_SECONDS = 5;
const MAX_SECONDS = 12 * 60 * 60;

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const GLYPHS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };

// Longest forms first: "1 1/2" before "1", "half an" before "an".
const NUM =
  "(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:\\.\\d+)?\\s*[½¼¾]?|[½¼¾]|half\\s+an?|an?|one|two|three|four|five|six|seven|eight|nine|ten)";
const UNIT = "(hours?|hrs?|minutes?|mins?|seconds?|secs?)";
// Not after a letter, digit, slash or dot, so "a" is the word and "5" is not
// the tail of "1.5" or "1/5". The unit must end at a word boundary, so
// "minced" and "section" are not units.
const DURATION = new RegExp(
  `(?<![\\w/.])(${NUM})(?:\\s*(?:-|–|—|to)\\s*(${NUM}))?[\\s-]*${UNIT}\\b`,
  "gi",
);

function toNumber(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (/^half\s+an?$/.test(text)) return 0.5;
  if (text in WORD_NUMBERS) return WORD_NUMBERS[text];
  if (text in GLYPHS) return GLYPHS[text];
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (mixed) {
    const den = Number(mixed[3]);
    return den ? Number(mixed[1]) + Number(mixed[2]) / den : null;
  }
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) {
    const den = Number(fraction[2]);
    return den ? Number(fraction[1]) / den : null;
  }
  const glyph = /^(\d+(?:\.\d+)?)\s*([½¼¾])$/.exec(text);
  if (glyph) return Number(glyph[1]) + GLYPHS[glyph[2]];
  const plain = Number(text);
  return Number.isFinite(plain) ? plain : null;
}

type Unit = "hr" | "min" | "sec";
const UNIT_SECONDS: Record<Unit, number> = { hr: 3600, min: 60, sec: 1 };

function toUnit(raw: string): Unit {
  const u = raw.toLowerCase();
  return u.startsWith("h") ? "hr" : u.startsWith("m") ? "min" : "sec";
}

/** "1 hr 30 min", "45 sec". */
function durationLabel(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [
    hours ? `${hours} hr` : "",
    minutes ? `${minutes} min` : "",
    secs ? `${secs} sec` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** A number as it is said in a range label: 8, 1.5. */
const plainNumber = (n: number) => String(Math.round(n * 100) / 100);

interface Found {
  start: number;
  end: number;
  seconds: number;
  unit: Unit;
  /** Set for a range ("8–10 min"), which is never joined to a neighbour. */
  rangeLabel: string | null;
}

/** The timers a step's wording asks for, in the order they appear. */
export function stepTimers(text: string): StepTimer[] {
  const found: Found[] = [];
  for (const match of text.matchAll(DURATION)) {
    const low = toNumber(match[1]);
    const high = match[2] === undefined ? null : toNumber(match[2]);
    if (low === null) continue;
    const unit = toUnit(match[3]);
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      seconds: Math.round(low * UNIT_SECONDS[unit]),
      unit,
      rangeLabel:
        high !== null && high > low
          ? `${plainNumber(low)}–${plainNumber(high)} ${unit}`
          : null,
    });
  }

  // "1 hour 30 minutes" and "1 hour and 15 minutes" are one timer.
  const joined: Found[] = [];
  for (const next of found) {
    const prev = joined.at(-1);
    const between = prev ? text.slice(prev.end, next.start) : "";
    if (
      prev &&
      !prev.rangeLabel &&
      !next.rangeLabel &&
      UNIT_SECONDS[next.unit] < UNIT_SECONDS[prev.unit] &&
      /^\s*(?:,|and)?\s*$/i.test(between)
    ) {
      joined[joined.length - 1] = {
        ...prev,
        end: next.end,
        seconds: prev.seconds + next.seconds,
        unit: next.unit,
      };
    } else {
      joined.push(next);
    }
  }

  return joined
    .filter((f) => f.seconds >= MIN_SECONDS && f.seconds <= MAX_SECONDS)
    .map((f) => ({
      seconds: f.seconds,
      label: f.rangeLabel ?? durationLabel(f.seconds),
    }));
}

/** "4:05", "1:30:05". Never negative. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return hours
    ? `${hours}:${pad(minutes)}:${pad(s % 60)}`
    : `${minutes}:${pad(s % 60)}`;
}

/**
 * Whole seconds left until `endsAt` (both in ms). Counted from the clock, not
 * from ticks, so a timer is still right after the app was in the background.
 */
export function remainingSeconds(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

interface CookIngredient {
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
}

/** The cards cook mode pages through; empty when the recipe has no steps. */
export function cookCards(recipe: {
  ingredients: CookIngredient[];
  instructions: string[];
  /** One optional extra note per instruction, by index. */
  details?: (string | null)[];
}): CookCard[] {
  const steps: CookCard[] = [];
  recipe.instructions.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    steps.push({
      kind: "step",
      number: steps.length + 1,
      text,
      detail: recipe.details?.[index]?.trim() || null,
      timers: stepTimers(text),
    });
  });
  if (steps.length === 0) return [];
  const ingredients = recipe.ingredients
    .map((i) =>
      [i.quantity, i.unit?.trim(), i.name.trim()].filter(Boolean).join(" "),
    )
    .filter(Boolean);
  return ingredients.length > 0
    ? [{ kind: "ready", ingredients }, ...steps]
    : steps;
}

/** What is read aloud for a card. */
export function stepSpeech(card: CookCard, stepCount: number): string {
  if (card.kind === "ready") {
    return `Get ready. You need: ${card.ingredients.join(". ")}.`;
  }
  return `Step ${card.number} of ${stepCount}. ${card.text}`;
}
