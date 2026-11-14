import { toSecondPerson } from "@shared/lib/notebook-text";

export interface PageItem {
  id: number;
  /** The entry in the user's words (second person). */
  text: string;
  /** Saw it saved and kept it, or confirmed it here. */
  confirmed: boolean;
}

export interface WhatCoachKnows {
  goals: PageItem[];
  preferences: PageItem[];
  /** Commitments, named for what they are: things the user is trying. */
  trying: PageItem[];
  /** One softened line when a coaching strategy exists; its text is never shown. */
  howCoachTalks: string | null;
}

const STRATEGY_LINE = "Keeps suggestions short and practical.";

/**
 * The "What Coach knows" page (visible memory R3): goals, preferences and
 * commitments as plain second-person sentences. Interpretations (insight,
 * motivation), conversation summaries and feelings are never shown; the
 * coaching strategy appears only as one fixed, softened line.
 */
export function groupForPage(
  entries: readonly {
    id: number;
    type: string;
    content: string;
    status: string;
    confirmedAt: string | null;
  }[],
): WhatCoachKnows {
  const page: WhatCoachKnows = {
    goals: [],
    preferences: [],
    trying: [],
    howCoachTalks: null,
  };
  for (const e of entries) {
    if (e.status !== "active") continue;
    const item = {
      id: e.id,
      text: toSecondPerson(e.content.trim()).replace(/[.!]+$/, ""),
      confirmed: e.confirmedAt != null,
    };
    if (e.type === "goal") page.goals.push(item);
    else if (e.type === "preference") page.preferences.push(item);
    else if (e.type === "commitment") page.trying.push(item);
    else if (e.type === "coaching_strategy") page.howCoachTalks = STRATEGY_LINE;
  }
  return page;
}
