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
 * The plan card's result: which meals the card shows and how many of the
 * asked-for meals were left off, so the reply never lists a meal the card
 * does not have or points at a card that is not there. When the model asked
 * for the grocery list too (Coach roadmap A1), whether this card saves it.
 * Recipe titles are written by users and the community, so each line passes
 * the prompt sanitizer.
 */
export function planCardResult(outcome: void | WriteCardOutcome) {
  if (!outcome || outcome.kind !== "plan") {
    return { card_shown: true, message: CARD_SHOWN_MESSAGE };
  }
  if (outcome.shown === false) {
    return {
      card_shown: false,
      message:
        "No meal plan card was made, and nothing has been saved: none of those recipes could be used (an id that does not exist, or a recipe that is not safe for the user's allergies). Call find_plan_recipes or get_my_recipes for ids, then try again. Do not tell the user to tap a card.",
    };
  }
  const notes: string[] = [];
  if (outcome.meals && outcome.meals.length > 0) {
    notes.push(
      `The card shows: ${outcome.meals.map((line) => sanitizeUserInput(line)).join("; ")}.`,
    );
  }
  if (outcome.dropped && outcome.dropped > 0) {
    notes.push(
      `${outcome.dropped} of the meals asked for ${outcome.dropped === 1 ? "was" : "were"} left off because the recipe was not found or is not safe for the user's allergies. Describe only the meals on the card.`,
    );
  }
  if (outcome.groceryList === "on_card") {
    notes.push(
      "The same card also adds these meals' ingredients to the user's grocery list when they save it (they can switch that off or pick the list on the card); what their pantry already covers is left off. Do not call add_to_grocery_list for these meals, and do not write out the ingredients.",
    );
  } else if (outcome.groceryList === "not_on_card") {
    notes.push(
      "This card does not include the grocery list. Do not call add_to_grocery_list in this turn: it would replace this card. Tell the user to save the plan first, then ask for the grocery list.",
    );
  }
  return {
    card_shown: true,
    message: [CARD_SHOWN_MESSAGE, ...notes].join(" "),
  };
}

/** The food card's result: whether there is a card to point the user at. */
export function foodCardResult(outcome: void | WriteCardOutcome) {
  if (outcome?.kind === "food" && !outcome.shown) {
    return {
      card_shown: false,
      message:
        "No food card was made, and nothing has been logged: there was nothing in the request that could be logged. Do not tell the user to tap a card.",
    };
  }
  if (outcome?.kind === "food" && outcome.loggedAtOnce) {
    return { card_shown: true, message: LOGGED_AT_ONCE_MESSAGE };
  }
  return { card_shown: true, message: CARD_SHOWN_MESSAGE };
}

/**
 * A small food log the turn applies at once (Coach roadmap T2): the card
 * shows it logged, with Undo. The model must say so, and must not log it
 * again to change it.
 */
const LOGGED_AT_ONCE_MESSAGE =
  "This food is already logged, as the card on screen shows, and the user can tap Undo on the card to take it back. Say it was logged and that they can undo it. If they later want it changed, tell them to tap Undo on that card first, or to edit it in their log; calling log_food_item again would log it twice.";

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
