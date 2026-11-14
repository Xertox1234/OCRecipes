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
  if (extras?.writeCards) body.writeCards = true;
  if (extras?.liveCard) body.liveCard = extras.liveCard;
  return body;
}
