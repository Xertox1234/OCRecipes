import { sanitizeUserInput } from "../../lib/ai-safety";
import type { WriteCardOutcome } from "./tool-args";

/** Every write tool's result in write-card mode — never "saved". */
export const CARD_SHOWN_MESSAGE =
  "A card with these details is on screen for the user to check and save. Nothing has been saved. Do not say it was logged or added; tell them to tap the card when it looks right.";

/**
 * The grocery card's result: what the pantry check changed, so the reply never
 * lists an item the card does not show or points at a card that is not there.
 */
export function groceryCardResult(outcome: void | WriteCardOutcome) {
  if (outcome?.kind === "grocery_on_plan_card") {
    return {
      card_shown: false,
      message:
        "No separate grocery card was made: the meal plan card on screen already adds these meals' shopping to the user's grocery list when they save it. Do not list items to buy; tell them the one card does both.",
    };
  }
  if (!outcome || outcome.kind !== "grocery") {
    return { card_shown: true, message: CARD_SHOWN_MESSAGE };
  }
  const names = (list: string[]) => list.join(", ");
  if (!outcome.shown) {
    return {
      card_shown: false,
      // Worded for this request only: an earlier card from the same turn
      // stays on screen, so this must not say there is no card at all.
      message: `No grocery card was made for this request: the user's pantry already has everything asked for (${names(outcome.leftOff)}). Nothing has been saved. Tell them they already have these, and do not tell them to tap a card for these items.`,
    };
  }
  const notes = [
    outcome.leftOff.length > 0 &&
      `Left off the card because the pantry already has enough: ${names(outcome.leftOff)}. Do not list these as items to buy.`,
    outcome.unticked.length > 0 &&
      `Shown unticked because the pantry has some, in an amount that could not be compared: ${names(outcome.unticked)}. Tell the user to tick them if they need more.`,
  ].filter(Boolean);
  return {
    card_shown: true,
    message: [CARD_SHOWN_MESSAGE, ...notes].join(" "),
  };
}

/**
 * The plan card's result (Coach roadmap A1): when the model asked for the
 * grocery list too, whether this card saves it.
 */
export function planCardResult(outcome: void | WriteCardOutcome) {
  if (!outcome || outcome.kind !== "plan") {
    return { card_shown: true, message: CARD_SHOWN_MESSAGE };
  }
  const note =
    outcome.groceryList === "on_card"
      ? "The same card also adds these meals' ingredients to the user's grocery list when they save it (they can switch that off or pick the list on the card); what their pantry already covers is left off. Do not call add_to_grocery_list for these meals, and do not write out the ingredients."
      : "This card does not include the grocery list. Do not call add_to_grocery_list in this turn: it would replace this card. Tell the user to save the plan first, then ask for the grocery list.";
  return { card_shown: true, message: `${CARD_SHOWN_MESSAGE} ${note}` };
}

/**
 * The pantry card's result. The row lines carry pantry item names, which the
 * user typed, so each passes the prompt sanitizer before the model sees it.
 */
export function pantryCardResult(outcome: void | WriteCardOutcome) {
  if (!outcome || outcome.kind !== "pantry") {
    return { card_shown: true, message: CARD_SHOWN_MESSAGE };
  }
  const left =
    outcome.dropped === 0
      ? ""
      : ` ${outcome.dropped} ${outcome.dropped === 1 ? "change was" : "changes were"} left off because the pantry item was not found or the amount could not be read; call get_pantry_items for the current ids, and give amounts as numbers.`;
  if (!outcome.shown) {
    return {
      card_shown: false,
      message: `No pantry card was made for this request, and nothing has changed.${left} Do not tell the user to tap a card for these changes.`,
    };
  }
  const rows = outcome.rows.map((line) => sanitizeUserInput(line)).join("; ");
  return {
    card_shown: true,
    message: `${CARD_SHOWN_MESSAGE} The card shows: ${rows}.${left}`,
  };
}

/**
 * The goals card's result. The line holds only goal names and numbers the
 * server worked out, so it needs no sanitizing.
 */
export function goalsCardResult(outcome: void | WriteCardOutcome) {
  if (!outcome || outcome.kind !== "goals") {
    return { card_shown: true, message: CARD_SHOWN_MESSAGE };
  }
  if (!outcome.shown) {
    return {
      card_shown: false,
      message:
        "No goals card was made: these are already the user's goals, and nothing has changed. Do not tell the user to tap a card.",
    };
  }
  return {
    card_shown: true,
    message: `${CARD_SHOWN_MESSAGE} The card shows: ${outcome.rows}.`,
  };
}
