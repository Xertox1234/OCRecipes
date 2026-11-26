/**
 * A meal photo sent into the Coach chat (Coach roadmap S1).
 *
 * The photo runs through the same meal analysis and nutrition lookup as the
 * Scan screen, and the answer is the Coach's own food log card: one row per
 * food, sized to the portion seen in the photo, count 1. The user changes the
 * counts on the card; nothing is saved until they tap it.
 *
 * S2 added labels and barcodes: `buildPhotoReply` classifies the photo first
 * and answers a nutrition label or a barcode with a one-row card for one
 * serving of that product.
 *
 * S3 added grocery receipts, read into the pantry card
 * (coach-receipt-photo.ts), and restaurant menus, read into a list of the
 * best dishes for the user's goals (coach-menu-photo.ts).
 */
import {
  labelEnergyAgrees,
  looksLikeKilojoules,
  macroCalories,
  type LabelMacros,
} from "@shared/lib/label-energy";
import {
  analyzePhoto,
  analyzeLabelPhoto,
  classifyPhoto,
  type FoodItem,
} from "./photo-analysis";
import {
  loadAllergyProfile,
  loadBarcodeScanContext,
} from "./barcode-scan-context";
import { buildScanResponseFlags } from "./scan-flags";
import type { BarcodeLookupResult } from "./barcode-lookup";
import type { ProfileOutcome } from "./scan-flags";
import type { LabelExtractionResult } from "@shared/types/label-analysis";
import { logger, toError } from "../lib/logger";
import { batchNutritionLookup, type NutritionData } from "./nutrition-lookup";
import { portionNutrition } from "./portion-nutrition";
import { inferMealTimeHint } from "../lib/meal-time-hint";
import { civilHourInTz } from "../lib/civil-date";
import {
  logFoodCardArgsSchema,
  type UpdatePantryCardArgs,
  type WriteCardProposal,
} from "./write-cards/tool-args";
import type {
  FoodCardPayload,
  PantryCardPayload,
} from "@shared/schemas/coach-write-cards";
import { receiptPhotoReply, type ReceiptFeatures } from "./coach-receipt-photo";
import { menuPhotoReply } from "./coach-menu-photo";
import type { SuggestionList } from "@shared/schemas/coach-blocks";
import type { PremiumFeatures } from "@shared/types/premium";

export {
  COACH_PHOTO_USER_TEXT,
  COACH_BARCODE_USER_TEXT,
} from "@shared/lib/coach-photo";

const MAX_CARD_ITEMS = 8;
const MAX_LOOKUP_FOODS = 12;
const MAX_NAME = 200;
export const MAX_UNIT_LABEL = 60;

type PhotoFood = Pick<FoodItem, "name" | "quantity" | "lookupName" | "grams">;
export type CardItem = FoodCardPayload["items"][number];

const lookupKey = (f: PhotoFood) => f.lookupName ?? f.name;

/**
 * The rule the Coach's own `log_food_item` rows pass: bounded numbers, and
 * text that clears the unsafe-advice screen. A photo row is model output too
 * (text read from a picture), so it gets the same check.
 */
const cardRowSchema = logFoodCardArgsSchema.shape.items.element;

/**
 * Card rows for the foods that have a nutrition match. `skipped` counts the
 * foods left out: no match, a row the card's rules refuse, or past 8 rows.
 */
export function photoFoodsToCardItems(
  foods: PhotoFood[],
  nutrition: Map<string, NutritionData | null>,
): { items: CardItem[]; skipped: number } {
  const items: CardItem[] = [];
  for (const food of foods) {
    if (items.length === MAX_CARD_ITEMS) break;
    const found = nutrition.get(lookupKey(food));
    const name = food.name.trim().slice(0, MAX_NAME);
    if (!found || !name) continue;
    const portion = portionNutrition(found, food);
    const unitLabel =
      portion.servingSize.trim().slice(0, MAX_UNIT_LABEL) || "portion";
    const perUnit = {
      calories: portion.calories,
      protein: portion.protein,
      carbs: portion.carbs,
      fat: portion.fat,
    };
    const row = { name, unitLabel, count: 1, estimate: perUnit };
    if (!cardRowSchema.safeParse(row).success) continue;
    items.push({ name, unitLabel, perUnit, count: 1, source: "lookup" });
  }
  return { items, skipped: foods.length - items.length };
}

/**
 * The Coach's line above the card. Fixed wording: food names are model
 * output read from a photo, so they stay on the card and out of the saved
 * message text that later turns feed back to the model.
 */
export function photoReplyText(shown: number, skipped: number): string {
  if (shown === 0) {
    return "I couldn't make out food I can log in that photo. Try again with the plate filling the frame, or tell me what you ate.";
  }
  const left =
    skipped > 0
      ? ` I left out ${skipped} ${skipped === 1 ? "item" : "items"} I couldn't find nutrition for.`
      : "";
  return `Here's what I see in your photo. Change any portion that looks off, then log it.${left}`;
}

/** The card's proposal, in the shape a `log_food_item` tool call has. */
export function photoCardProposal(payload: FoodCardPayload): WriteCardProposal {
  return {
    kind: "food",
    args: {
      items: payload.items.map((item) => ({
        name: item.name,
        unitLabel: item.unitLabel,
        count: item.count,
        estimate: item.perUnit,
      })),
      mealType: payload.mealType,
      day: payload.day,
    },
  };
}

/** Analyze the photo and build the food card payload (null: nothing to show). */
export async function buildPhotoFoodCard(
  imageBase64: string,
  ctx: { tz: string; now: Date },
): Promise<{ payload: FoodCardPayload | null; skipped: number }> {
  const analysis = await analyzePhoto(imageBase64, "log");
  // Bounded before the lookups: a photo of a long food list would otherwise
  // fan out to one paid lookup per name. A few spare past the card's 8 rows
  // cover foods with no match.
  const foods = analysis.foods.slice(0, MAX_LOOKUP_FOODS);
  const nutrition = await batchNutritionLookup([
    ...new Set(foods.map(lookupKey)),
  ]);
  const { items, skipped: unshown } = photoFoodsToCardItems(foods, nutrition);
  const skipped = unshown + (analysis.foods.length - foods.length);
  if (items.length === 0) return { payload: null, skipped };
  return {
    payload: {
      items,
      mealType: inferMealTimeHint(civilHourInTz(ctx.now, ctx.tz)),
      day: "today",
    },
    skipped,
  };
}

// ── Labels and barcodes (Coach roadmap S2) ─────────────────────────────

/**
 * A photo reply: the food card to show (null: none), a pantry card for a
 * receipt, a list of picks for a menu, and the Coach's line.
 */
export interface PhotoReply {
  payload: FoodCardPayload | null;
  pantry?: { args: UpdatePantryCardArgs; payload: PantryCardPayload };
  suggestions?: SuggestionList;
  text: string;
}

/** The plan features a receipt or menu read needs, from the route's tier lookup. */
export type PhotoFeatures = ReceiptFeatures &
  Pick<PremiumFeatures, "menuScanner">;

/** Below this the classifier's answer is not trusted and the photo is read as a meal. */
const CLASSIFY_CONFIDENCE = 0.7;

const LABEL_NO_CALORIES_TEXT =
  "I couldn't read the calories on that label. Try again with the whole nutrition panel in the frame and in good light.";
const LABEL_TEXT =
  "Here's what I read from that label, per serving. Check it against the pack, set how many servings you had, then log it.";
/**
 * The calories read do not match the label's own protein, carbs and fat: one
 * figure was misread (owner report 2026-11-26, a full label logged as 10
 * cal). No card, since the card cannot fix its calories; the numbers are
 * the vision model's, rounded, never text from the photo.
 */
function labelDoesNotAddUpText(kcal: number, macros: LabelMacros): string {
  const read = Math.round(kcal);
  const fromMacros = Math.round(macroCalories(macros));
  const opening = looksLikeKilojoules(kcal, macros)
    ? `The ${read} I read from that label looks like its kilojoules, not its calories: its protein, carbs and fat make about ${fromMacros} calories.`
    : `The numbers I read from that label don't add up: ${read} calories, but its protein, carbs and fat make about ${fromMacros}.`;
  return `${opening} I won't log it from this photo. Tell me the calories printed on it and I'll log that, or try again with the panel flat and in good light, or scan the barcode instead.`;
}
const LABEL_GAPS_TEXT = " I couldn't read every number, so some show as 0.";
const LABEL_UNSURE_TEXT =
  " The label was hard to read, so check each number before you log it.";
// A label photo shows no ingredients list the Coach can check. Said only to
// a user who has allergies on their profile, or whose profile could not be
// read (fail-dangerous, as on a scan).
export const LABEL_ALLERGY_TEXT =
  " I can't check ingredients from a label photo, so read the pack for your allergies.";
/** A row the food card's rules refuse: numbers out of range, or text it screens out. */
export const ROW_REFUSED_TEXT =
  "I couldn't turn that into something I can log. Tell me what it was and how much you had, and I'll log it for you.";
const BARCODE_UNREAD_TEXT =
  "I can see a barcode but couldn't read its number. Try again closer and straight on, or send a photo of the nutrition label.";
const BARCODE_UNKNOWN_TEXT =
  "I read the barcode but couldn't find that product. Send a photo of its nutrition label and I'll read that instead.";
const BARCODE_NO_NUTRITION_TEXT =
  "I found that product but it has no nutrition data. Send a photo of its nutrition label and I'll read that instead.";
const BARCODE_TEXT =
  "I found this product from its barcode. Check it's the right one, set how many servings you had, then log it.";
const BARCODE_UNKNOWN_SERVING_TEXT =
  " I don't know this product's serving size, so check the amount on the card.";
const BARCODE_GAPS_TEXT =
  " Some numbers are missing for this product, so some show as 0.";
export const BARCODE_LOOKUP_DOWN_TEXT =
  "I couldn't look that product up just now. Please try again in a moment.";
/** What the barcode lookup calls a product it has no name for. */
const LOOKUP_PLACEHOLDER_NAME = "Unknown Product";
// Fixed wording that names no allergen: the product's allergen data comes
// from Open Food Facts and is never stored (see BarcodeLookupResult), and
// this line is saved with the message. What the saved message does record
// is the outcome of the check for this user (a match, or no check possible).
const ALLERGEN_MATCH_TEXT =
  " Allergy check: this product may contain something on your allergy list. Read the pack before you eat it.";
export const ALLERGEN_UNCHECKED_TEXT =
  " I couldn't check this product against your allergies, so read the pack.";

/**
 * True for an EAN-13, UPC-A or EAN-8 number whose last digit is the right
 * check digit. The number in a photo is read by a vision model, and one
 * wrong digit would otherwise fetch a different product; a single misread
 * digit always fails this check.
 */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  // From the right, the digits before the check digit weigh 3, 1, 3, 1…
  const sum = digits
    .reverse()
    .reduce((total, d, i) => total + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** One card row for a packaged food, or null when the card's rules refuse it. */
/** The row's name when nothing names the product. */
export const UNNAMED = "Packaged food";

export function packagedFoodRow(
  rawName: string,
  rawUnitLabel: string,
  perUnit: CardItem["perUnit"],
): CardItem | null {
  const name = rawName.trim().slice(0, MAX_NAME) || UNNAMED;
  const unitLabel = rawUnitLabel.trim().slice(0, MAX_UNIT_LABEL) || "1 serving";
  const row = { name, unitLabel, count: 1, estimate: perUnit };
  if (!cardRowSchema.safeParse(row).success) return null;
  return { name, unitLabel, perUnit, count: 1, source: "lookup" };
}

export function onePackagedFood(
  item: CardItem,
  ctx: { tz: string; now: Date },
): FoodCardPayload {
  return {
    items: [item],
    mealType: inferMealTimeHint(civilHourInTz(ctx.now, ctx.tz)),
    day: "today",
  };
}

/** A nutrition label read from a photo, as a one-serving card. */
export function labelPhotoReply(
  label: LabelExtractionResult,
  profileOutcome: ProfileOutcome,
  ctx: { tz: string; now: Date },
): PhotoReply {
  if (label.calories === null) {
    return { payload: null, text: LABEL_NO_CALORIES_TEXT };
  }
  const serving = label.servingSize?.trim();
  const withServing = serving ? `1 serving (${serving})` : "1 serving";
  const item = packagedFoodRow(
    label.productName ?? "",
    // A serving text too long for the row is shown without the "1 serving".
    withServing.length <= MAX_UNIT_LABEL ? withServing : (serving ?? ""),
    {
      calories: round1(label.calories),
      protein: round1(label.protein ?? 0),
      carbs: round1(label.totalCarbs ?? 0),
      fat: round1(label.totalFat ?? 0),
    },
  );
  if (!item) return { payload: null, text: ROW_REFUSED_TEXT };
  const macros: LabelMacros = {
    protein: label.protein,
    carbs: label.totalCarbs,
    fat: label.totalFat,
    fibre: label.dietaryFiber,
  };
  if (!labelEnergyAgrees(label.calories, macros)) {
    return {
      payload: null,
      text: labelDoesNotAddUpText(label.calories, macros),
    };
  }
  const gaps =
    label.protein === null ||
    label.totalCarbs === null ||
    label.totalFat === null;
  const allergyCheckOwed =
    !profileOutcome.ok || profileOutcome.allergies.length > 0;
  return {
    payload: onePackagedFood(item, ctx),
    text:
      LABEL_TEXT +
      (gaps ? LABEL_GAPS_TEXT : "") +
      (label.confidence < CLASSIFY_CONFIDENCE ? LABEL_UNSURE_TEXT : "") +
      (allergyCheckOwed ? LABEL_ALLERGY_TEXT : ""),
  };
}

/** The product's allergy line for a barcode reply, or "". */
export function barcodeAllergyText(
  product: BarcodeLookupResult,
  profileOutcome: ProfileOutcome,
): string {
  // The same allergen check a scan on the Scan screen gets.
  const flags = buildScanResponseFlags(
    {
      allergenTags: product.allergenTags ?? [],
      ingredientsText: product.ingredientsText ?? null,
      allergenDataAvailable: product.allergenDataAvailable,
    },
    profileOutcome,
  );
  return flags.some((f) => f.kind === "allergen")
    ? ALLERGEN_MATCH_TEXT
    : flags.some((f) => f.kind === "allergen-unavailable")
      ? ALLERGEN_UNCHECKED_TEXT
      : "";
}

export function productDisplayName(product: BarcodeLookupResult): string {
  const productName =
    product.productName === LOOKUP_PLACEHOLDER_NAME ? "" : product.productName;
  return [product.brandName, productName].filter(Boolean).join(" ");
}

/** A product found by its barcode, as a one-serving card. */
export function barcodePhotoReply(
  product: BarcodeLookupResult | null,
  profileOutcome: ProfileOutcome,
  ctx: { tz: string; now: Date },
): PhotoReply {
  if (!product) return { payload: null, text: BARCODE_UNKNOWN_TEXT };
  const per = product.perServing;
  if (per.calories === undefined) {
    return { payload: null, text: BARCODE_NO_NUTRITION_TEXT };
  }
  const item = packagedFoodRow(
    productDisplayName(product),
    product.servingInfo.displayLabel,
    {
      calories: round1(per.calories),
      protein: round1(per.protein ?? 0),
      carbs: round1(per.carbs ?? 0),
      fat: round1(per.fat ?? 0),
    },
  );
  if (!item) return { payload: null, text: ROW_REFUSED_TEXT };
  const gaps =
    per.protein === undefined ||
    per.carbs === undefined ||
    per.fat === undefined;

  const allergy = barcodeAllergyText(product, profileOutcome);
  return {
    payload: onePackagedFood(item, ctx),
    text:
      BARCODE_TEXT +
      (product.isServingDataTrusted ? "" : BARCODE_UNKNOWN_SERVING_TEXT) +
      (gaps ? BARCODE_GAPS_TEXT : "") +
      allergy,
  };
}

async function mealPhotoReply(
  imageBase64: string,
  ctx: { tz: string; now: Date },
): Promise<PhotoReply> {
  const { payload, skipped } = await buildPhotoFoodCard(imageBase64, ctx);
  return {
    payload,
    text: photoReplyText(payload?.items.length ?? 0, skipped),
  };
}

/**
 * The Coach's answer to a photo. The photo is classified first: a nutrition
 * label is read as a label, a barcode is looked up, a grocery receipt goes to
 * the pantry card, a restaurant menu to a list of picks, and anything else
 * (or a photo the classifier is unsure about, or could not classify) is read
 * as a meal, as before S2.
 */
export async function buildPhotoReply(
  imageBase64: string,
  ctx: { tz: string; now: Date; userId: string; features: PhotoFeatures },
): Promise<PhotoReply> {
  const seen = await classifyPhoto(imageBase64).catch((err) => {
    logger.warn({ err: toError(err) }, "coach photo: classification failed");
    return null;
  });
  if (!seen || seen.confidence < CLASSIFY_CONFIDENCE) {
    return mealPhotoReply(imageBase64, ctx);
  }
  if (seen.contentType === "nutrition_label") {
    const [label, profileOutcome] = await Promise.all([
      analyzeLabelPhoto(imageBase64),
      loadAllergyProfile(ctx.userId),
    ]);
    return labelPhotoReply(label, profileOutcome, ctx);
  }
  if (seen.contentType === "has_barcode") {
    if (!seen.barcode || !hasValidCheckDigit(seen.barcode)) {
      return { payload: null, text: BARCODE_UNREAD_TEXT };
    }
    const { result, profileOutcome } = await loadBarcodeScanContext(
      seen.barcode,
      ctx.userId,
    );
    return barcodePhotoReply(result, profileOutcome, ctx);
  }
  if (seen.contentType === "grocery_receipt") {
    return receiptPhotoReply(imageBase64, {
      userId: ctx.userId,
      features: ctx.features,
    });
  }
  if (seen.contentType === "restaurant_menu") {
    const menu = await menuPhotoReply(imageBase64, {
      userId: ctx.userId,
      menuScanner: ctx.features.menuScanner,
    });
    // No dishes on it: most likely a meal taken for a menu.
    if (menu) return menu;
  }
  return mealPhotoReply(imageBase64, ctx);
}
