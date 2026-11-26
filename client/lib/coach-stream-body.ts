import type { FinderAction } from "@shared/schemas/recipe-finder";
import type { WriteCardEdits } from "@shared/schemas/coach-write-cards";
import type { BriefForm } from "@shared/lib/opening-brief";

export interface CoachStreamExtras {
  warmUpId?: string | null;
  screenContext?: string;
  finderAction?: FinderAction;
  /** First send from a new chat that showed the opening brief. */
  openingBrief?: BriefForm;
  /** Coach write cards (spec 2026-11-09): this app can show them. */
  writeCards?: boolean;
  /** The live card on screen and the user's edits to it. */
  liveCard?: { cardId: string; edits: WriteCardEdits };
}

/**
 * Card kinds this build can draw beyond the first three (spec 2026-11-16).
 * The server gives Coach a card's tool only when its kind is listed, so a
 * build without the card is never told one is on screen. "quick_log" (Coach
 * roadmap T2): this build shows a food card that arrives already logged,
 * with Undo, so a small typed log is applied at once.
 */
const EXTRA_CARD_KINDS = [
  "pantry",
  "goals",
  "allergy",
  "plan_shop",
  "quick_log",
] as const;

/** The POST body for a coach message; unset extras are left out. */
export function buildCoachStreamBody(
  content: string,
  turnKey: string,
  extras?: CoachStreamExtras,
): Record<string, unknown> {
  const body: Record<string, unknown> = { content, turnKey };
  if (extras?.warmUpId) body.warmUpId = extras.warmUpId;
  if (extras?.screenContext) body.screenContext = extras.screenContext;
  if (extras?.finderAction) body.finderAction = extras.finderAction;
  if (extras?.openingBrief) body.openingBrief = extras.openingBrief;
  if (extras?.writeCards) {
    body.writeCards = true;
    body.cardKinds = [...EXTRA_CARD_KINDS];
  }
  if (extras?.liveCard) body.liveCard = extras.liveCard;
  return body;
}
