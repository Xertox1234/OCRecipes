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
 */
import { storage } from "../storage";
import {
  containsUnsafeCoachAdvice,
  sanitizeContextField,
} from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";
import { AI_DAILY_CAPS } from "@shared/types/premium";
import type { SuggestionList } from "@shared/schemas/coach-blocks";
import { analyzeMenuPhoto, type MenuAnalysisResult } from "./menu-analysis";

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
  const proteinPart =
    Number.isFinite(protein) && protein >= 0
      ? `, ${Math.round(protein)} g protein`
      : "";
  return `About ${Math.round(kcal)} kcal${proteinPart}`;
}

/**
 * The menu's best dishes as list rows. `allergyLeftOut` counts the dishes left
 * out because they may hold one of the user's allergens.
 */
export function menuToPicks(menu: MenuAnalysisResult): {
  items: Pick[];
  allergyLeftOut: number;
} {
  const flagged = menu.allergenFlags ?? {};
  let allergyLeftOut = 0;
  const ranked: { rank: number; index: number; pick: Pick }[] = [];
  menu.menuItems.forEach((d, index) => {
    if (Object.hasOwn(flagged, d.name)) {
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
  "Here are my picks from that menu for your goals. The numbers are rough estimates for a restaurant portion. Tell me what you order and I'll log it.";
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
 */
export async function menuPhotoReply(
  imageBase64: string,
  ctx: { userId: string; menuScanner: boolean },
): Promise<MenuPhotoReply> {
  if (!ctx.menuScanner) return { payload: null, text: MENU_NO_PLAN_TEXT };
  const claimed = await storage.claimDailyAiCall(
    ctx.userId,
    "menuScan",
    AI_DAILY_CAPS.menuScan,
  );
  if (!claimed) return { payload: null, text: MENU_CAP_TEXT };

  const menu = await analyzeMenuPhoto(imageBase64, ctx.userId);
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

  const { items, allergyLeftOut } = menuToPicks(menu);
  const allergy = allergyText(allergyLeftOut);
  if (items.length === 0)
    return { payload: null, text: MENU_NONE_TEXT + allergy };
  return {
    payload: null,
    suggestions: { type: "suggestion_list", items },
    text: MENU_TEXT + allergy,
  };
}
