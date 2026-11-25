/**
 * A restaurant menu photo sent into the Coach chat (Coach roadmap S3).
 *
 * The menu is read by the same analysis as the Menu Scanner, which rates each
 * dish against the user's goals and flags dishes that may hold one of their
 * allergens. The answer is a short list of the best-rated dishes, each with
 * rough calories, protein and the reason it was picked. The list is a
 * suggestion_list block, which every app with the photo button can draw; its
 * rows are not tappable. To log what they order, the user says so in the chat.
 *
 * Later turns feed the model only each message's text, never its blocks, so
 * dish names read from the photo stay on the list.
 *
 * Allergies fail closed: the dishes are checked here against the user's
 * allergy list (the analyzer's own flags fall silent when its profile read
 * fails), and when the list cannot be read or the check fails, no dish is
 * picked. A user with allergies is always told the check goes only by what
 * the menu says.
 *
 * The chat photo route's per-minute limit (10) is looser than the Menu
 * Scanner's (5); the daily menu credit, claimed before the read, bounds the
 * spend on both.
 */
import { storage } from "../storage";
import {
  containsUnsafeCoachAdvice,
  sanitizeContextField,
} from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import type { SuggestionList } from "@shared/schemas/coach-blocks";
import {
  detectAllergens,
  type AllergySeverity,
} from "@shared/constants/allergens";
import { analyzeMenuPhoto, type MenuAnalysisResult } from "./menu-analysis";
import { loadAllergyProfile } from "./barcode-scan-context";

const log = createServiceLogger("coach-menu-photo");

const MAX_PICKS = 3;
const MAX_TITLE = 80;
const MAX_REASON = 120;

type Dish = MenuAnalysisResult["menuItems"][number];
type Pick = SuggestionList["items"][number];

/** Best first. A dish rated "avoid" is never a pick; an unrated one comes last. */
const RANK: Record<NonNullable<Dish["recommendation"]>, number | null> = {
  great: 0,
  good: 1,
  okay: 2,
  avoid: null,
};
const UNRATED_RANK = 3;

/** Menu text as one clean line, cut by whole characters. */
function cleanText(raw: string | undefined, max: number): string {
  if (!raw) return "";
  const flat = sanitizeContextField(raw, 1000).replace(/\s+/g, " ").trim();
  return [...flat].slice(0, max).join("").trim();
}

/** "About 620 kcal, 43 g protein", or "" when the estimates are unusable. */
function numbersLine(d: Dish): string {
  const kcal = d.estimatedCalories;
  const protein = d.estimatedProtein;
  if (!Number.isFinite(kcal) || kcal <= 0) return "";
  // To the nearest 10: the estimate is rough, and the row should not read
  // as exact.
  const proteinPart =
    Number.isFinite(protein) && protein >= 0
      ? `, ${Math.round(protein)} g protein`
      : "";
  return `About ${Math.max(10, Math.round(kcal / 10) * 10)} kcal${proteinPart}`;
}

/**
 * The dishes (by position) whose name or description names one of the
 * user's allergens, by the same matcher the Menu Scanner uses. Throws when
 * the matcher does: the caller fails closed.
 */
export function flagAllergenDishes(
  menu: MenuAnalysisResult,
  allergies: { name: string; severity: AllergySeverity }[],
): Set<number> {
  const flagged = new Set<number>();
  if (allergies.length === 0) return flagged;
  const texts = menu.menuItems.map((d) => `${d.name} ${d.description ?? ""}`);
  const hit = new Set(
    detectAllergens(texts, allergies).map((m) => m.ingredientName),
  );
  texts.forEach((t, i) => {
    if (hit.has(t)) flagged.add(i);
  });
  return flagged;
}

/**
 * The menu's best dishes as list rows. `allergyLeftOut` counts the dishes left
 * out because they may hold one of the user's allergens.
 */
export function menuToPicks(
  menu: MenuAnalysisResult,
  allergyFlagged: ReadonlySet<number> = new Set(),
): {
  items: Pick[];
  allergyLeftOut: number;
} {
  let allergyLeftOut = 0;
  const ranked: { rank: number; index: number; pick: Pick }[] = [];
  menu.menuItems.forEach((d, index) => {
    if (allergyFlagged.has(index)) {
      allergyLeftOut += 1;
      return;
    }
    const rank = d.recommendation ? RANK[d.recommendation] : UNRATED_RANK;
    if (rank === null) return;
    const title = cleanText(d.name, MAX_TITLE);
    const reason = cleanText(d.recommendationReason, MAX_REASON);
    // Model text read from a photo gets the same screen as the Coach's own
    // card text; a dish that fails it is not shown.
    if (!title || containsUnsafeCoachAdvice(title)) return;
    if (reason && containsUnsafeCoachAdvice(reason)) return;
    const subtitle = [numbersLine(d), reason].filter(Boolean).join(". ");
    ranked.push({ rank, index, pick: { title, subtitle, action: null } });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return {
    items: ranked.slice(0, MAX_PICKS).map((r) => r.pick),
    allergyLeftOut,
  };
}

/** A menu reply: no food card, a list of picks when there are any, and the Coach's line. */
export interface MenuPhotoReply {
  payload: null;
  suggestions?: SuggestionList;
  text: string;
}

// Fixed wording: dish names are model output read from a photo, so they stay
// on the list and out of the saved message text later turns feed the model.
export const MENU_TEXT =
  "Here are my picks from that menu. The numbers are rough estimates for a restaurant portion. Tell me what you order and I'll log it.";
// Said to every user with allergies: the check reads only the menu's words.
const MENU_ALLERGY_CAVEAT_TEXT =
  " I can only go by what the menu says, so check with the restaurant about your allergies before you order.";
const MENU_ALLERGY_UNCHECKED_TEXT =
  "I couldn't check that menu against your allergies just now, so I won't pick dishes for you. Please try again in a moment.";
const MENU_NONE_TEXT =
  "I couldn't find a dish on that menu I'd recommend. Try again with the menu flat and in good light, or tell me what's on it and I'll help you choose.";
const MENU_NO_PLAN_TEXT =
  "Reading a menu needs a plan with the menu scanner. Tell me what's on the menu and I'll help you choose.";
const MENU_CAP_TEXT =
  "You've reached today's menu limit. Tell me what's on the menu and I'll help you choose.";

function allergyText(count: number): string {
  if (count === 0) return "";
  return ` I left out ${count} ${count === 1 ? "dish" : "dishes"} that may contain something on your allergy list.`;
}

/**
 * Read a menu photo into a list of picks, under the Menu Scanner's plan rules
 * (server/routes/menu.ts): the menu scanner on the plan and the daily menu
 * credit, spent on top of the photo credit the chat's photo route already
 * claimed for the classification. The scan is saved to the menu history, as
 * a scan on the Menu Scanner is.
 *
 * Null when the photo shows no dishes: the classifier took something else
 * (most likely a meal) for a menu, and the caller reads it as a meal instead.
 */
export async function menuPhotoReply(
  imageBase64: string,
  ctx: { userId: string; menuScanner: boolean },
): Promise<MenuPhotoReply | null> {
  if (!ctx.menuScanner) return { payload: null, text: MENU_NO_PLAN_TEXT };
  const claimed = await storage.claimDailyAiCall(
    ctx.userId,
    "menuScan",
    AI_DAILY_CAPS.menuScan,
  );
  if (!claimed) return { payload: null, text: MENU_CAP_TEXT };

  const [menu, profile] = await Promise.all([
    analyzeMenuPhoto(imageBase64, ctx.userId),
    loadAllergyProfile(ctx.userId),
  ]);
  if (menu.menuItems.length === 0) return null;
  try {
    await storage.createMenuScan({
      userId: ctx.userId,
      restaurantName: menu.restaurantName ?? null,
      cuisine: menu.cuisine ?? null,
      menuItems: menu.menuItems,
    });
  } catch (err) {
    // The history is a side record; the user still gets their picks.
    log.error({ err: toError(err) }, "coach menu scan not saved");
  }

  if (!profile.ok) return { payload: null, text: MENU_ALLERGY_UNCHECKED_TEXT };
  let flagged: Set<number>;
  try {
    flagged = flagAllergenDishes(menu, profile.allergies);
  } catch (err) {
    log.warn({ err: toError(err) }, "coach menu allergy check failed");
    return { payload: null, text: MENU_ALLERGY_UNCHECKED_TEXT };
  }

  const { items, allergyLeftOut } = menuToPicks(menu, flagged);
  const allergy =
    allergyText(allergyLeftOut) +
    (profile.allergies.length > 0 ? MENU_ALLERGY_CAVEAT_TEXT : "");
  if (items.length === 0) {
    return { payload: null, text: MENU_NONE_TEXT + allergy };
  }
  return {
    payload: null,
    suggestions: { type: "suggestion_list", items },
    text: MENU_TEXT + allergy,
  };
}
