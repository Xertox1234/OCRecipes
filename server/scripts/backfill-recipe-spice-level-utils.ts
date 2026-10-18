import { parseSpiceLevel } from "@shared/constants/recipe-attributes";
import type { SpiceLevel } from "@shared/schemas/recipe-finder";
import { sanitizeUserInput } from "../lib/ai-safety";

export interface SpiceRow {
  id: number;
  title: string;
  ingredients: string[];
}

/** How many recipes go into one AI call (keeps cost and reply size small). */
export const SPICE_BATCH_SIZE = 10;

export const SPICE_SYSTEM_PROMPT =
  "You judge how spicy (hot) recipes are. For each recipe, going only by its title and ingredient list, " +
  'answer "mild" (a gentle warmth), "medium" (clearly spicy), "hot" (very spicy), or null when the dish has ' +
  "no meaningful heat or you are unsure. Heat comes from chilies, cayenne, chili flakes, hot sauce, harissa, " +
  "curry paste, jalapeños and similar — not from ordinary seasoning. Never guess: when unsure, use null. " +
  'Respond with JSON only: {"levels": {"<recipe id>": "mild" | "medium" | "hot" | null}} with one entry per recipe id given.';

/** The user-role message for one batch. All recipe text is untrusted. */
export function buildSpiceUserMessage(rows: SpiceRow[]): string {
  return rows
    .map(
      (r) =>
        `#${r.id}: ${sanitizeUserInput(r.title)}\nIngredients: ${sanitizeUserInput(r.ingredients.join(", "))}`,
    )
    .join("\n\n");
}

/**
 * Validate an AI reply against the shared schema. Only ids we asked about are
 * kept; a missing, null or invalid answer is simply absent (stays null in the
 * database) — never a guess.
 */
export function parseSpiceReply(
  content: string,
  askedIds: readonly number[],
): Map<number, SpiceLevel> {
  const out = new Map<number, SpiceLevel>();
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return out;
  }
  const levels =
    json && typeof json === "object" && "levels" in json
      ? (json as { levels: unknown }).levels
      : null;
  if (!levels || typeof levels !== "object") return out;
  for (const id of askedIds) {
    const level = parseSpiceLevel((levels as Record<string, unknown>)[id]);
    if (level) out.set(id, level);
  }
  return out;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
