/**
 * The Coach's answers to what the phone itself read in the chat's live
 * scanner: a barcode, the nutrition label it read on the phone (Coach
 * roadmap V5), and the optional front of the pack the AI model reads for a
 * product the barcode gives no name for. Split from coach-photo.ts, which
 * keeps the photo replies and the card helpers these share.
 */
import type { FrontLabelExtractionResult } from "@shared/types/front-label";
import { labelFitsProduct } from "@shared/lib/label-fit";
import { sanitizeContextField } from "../lib/ai-safety";
import { logger, toError } from "../lib/logger";
import {
  loadAllergyProfile,
  loadBarcodeScanContext,
} from "./barcode-scan-context";
import type { BarcodeLookupResult } from "./barcode-lookup";
import { analyzeFrontLabel } from "./front-label-analysis";
import { buildScanResponseFlags, type ProfileOutcome } from "./scan-flags";
import { UpstreamUnavailableError } from "./usda-lookup";
import {
  ALLERGEN_UNCHECKED_TEXT,
  BARCODE_LOOKUP_DOWN_TEXT,
  LABEL_ALLERGY_TEXT,
  MAX_UNIT_LABEL,
  ROW_REFUSED_TEXT,
  barcodeAllergyText,
  barcodePhotoReply,
  onePackagedFood,
  packagedFoodRow,
  productDisplayName,
  round1,
  type CardItem,
  type PhotoReply,
} from "./coach-photo";

const PHONE_LABEL_TEXT =
  "I read that label on your phone, per serving. Check it against the pack, set how many servings you had, then log it.";

/** The numbers the app's text reader took from a nutrition label (Coach roadmap V5). */
export interface PhoneLabelRead {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSize: string;
}

// A barcode scanned with its label read on the phone (the scanner's label
// step): the name is the product's, the numbers are the pack's own.
const BARCODE_LABEL_TEXT =
  "I found this product from its barcode and used the numbers from your label. Check it's the right one, set how many servings you had, then log it.";
const BARCODE_UNKNOWN_LABEL_TEXT =
  "I couldn't find that product from its barcode, so I used the numbers from your label. Check them against the pack, set how many servings you had, then log it.";
// The label is far from what the barcode's product makes: likely another
// pack, so the card keeps the label's numbers but not the product's name.
const BARCODE_MISMATCH_LABEL_TEXT =
  "Your label's numbers don't match what I have for this barcode, so I left the product's name off. Check you scanned the right pack, set how many servings you had, then log it.";
const BARCODE_DOWN_LABEL_TEXT =
  "I couldn't look that product up just now, so I used the numbers from your label. Check them against the pack, set how many servings you had, then log it.";

/** The one-serving row a label read on the phone makes, under `name`. */
function phoneLabelRow(read: PhoneLabelRead, name: string): CardItem | null {
  const serving = sanitizeContextField(read.servingSize, 200)
    .replace(/\s+/g, " ")
    .trim();
  const withServing = serving ? `1 serving (${serving})` : "1 serving";
  return packagedFoodRow(
    name,
    withServing.length <= MAX_UNIT_LABEL ? withServing : serving,
    {
      calories: round1(read.calories),
      protein: round1(read.protein),
      carbs: round1(read.carbs),
      fat: round1(read.fat),
    },
  );
}

/**
 * A nutrition label the phone read itself, as a one-serving card. No model
 * reads anything: the numbers are the user's own phone's reading, as trusted
 * as numbers the user types, and the card's own limits still apply. The
 * panel shows no product name, so the row is "Packaged food".
 */
export function phoneLabelReply(
  read: PhoneLabelRead,
  profileOutcome: ProfileOutcome,
  ctx: { tz: string; now: Date },
  /** What the reply opens with; the plain label wording by default. */
  lead: string = PHONE_LABEL_TEXT,
  /**
   * The front of the pack, read in the scanner's front step: the card's name
   * and the allergy statements printed on it.
   */
  front?: FrontLabelExtractionResult,
): PhotoReply {
  const name = front ? frontName(front) : "";
  const item = phoneLabelRow(read, name);
  if (!item) return { payload: null, text: ROW_REFUSED_TEXT };
  const allergyCheckOwed =
    !profileOutcome.ok || profileOutcome.allergies.length > 0;
  const allergy = !allergyCheckOwed
    ? ""
    : front
      ? frontAllergyText(front, profileOutcome)
      : LABEL_ALLERGY_TEXT;
  return {
    payload: onePackagedFood(item, ctx),
    text: lead + (name ? FRONT_NAME_TEXT : "") + allergy,
  };
}

// The front of the pack (the scanner's optional third step). Its allergy
// statement can only ADD a warning: a statement that names nothing on the
// user's list, or no statement at all, is never read as "safe".
const FRONT_NAME_TEXT = " I took its name from the front of the pack.";
const FRONT_ALLERGEN_MATCH_TEXT =
  " Allergy check: the allergy statement on the front may mention something on your allergy list. Read the pack before you eat it.";
const FRONT_NO_MATCH_TEXT =
  " Nothing in the front's allergy statement matched your allergy list, but read the full ingredients for your allergies.";
const FRONT_NO_STATEMENT_TEXT =
  " I couldn't see an allergy statement on the front, so read the full ingredients for your allergies.";

/** Brand and product name from the front, or "" when it shows neither. */
function frontName(front: FrontLabelExtractionResult): string {
  return sanitizeContextField(
    [front.brand, front.productName].filter(Boolean).join(" "),
    200,
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** The allergy line for a user with allergies, from the front's statements. */
function frontAllergyText(
  front: FrontLabelExtractionResult,
  profileOutcome: ProfileOutcome,
): string {
  if (!profileOutcome.ok) return ALLERGEN_UNCHECKED_TEXT;
  const statements = front.allergenStatements ?? [];
  if (statements.length === 0) return FRONT_NO_STATEMENT_TEXT;
  const flags = buildScanResponseFlags(
    {
      allergenTags: [],
      ingredientsText: statements.join(". "),
      allergenDataAvailable: true,
    },
    profileOutcome,
  );
  return flags.some((f) => f.kind === "allergen")
    ? FRONT_ALLERGEN_MATCH_TEXT
    : FRONT_NO_MATCH_TEXT;
}

/** The Coach's answer to a label the phone read, with the allergy reminder a label photo gets. */
export async function scannedLabelReply(
  read: PhoneLabelRead,
  ctx: { tz: string; now: Date; userId: string },
): Promise<PhotoReply> {
  return phoneLabelReply(read, await loadAllergyProfile(ctx.userId), ctx);
}

/**
 * A barcode scanned together with its nutrition label read on the phone: the
 * card is named from the product and carries the label's numbers, which are
 * the pack in the user's hand. An unknown product still gets a card, from the
 * label alone.
 */
export function barcodeWithLabelReply(
  product: BarcodeLookupResult | null,
  profileOutcome: ProfileOutcome,
  read: PhoneLabelRead,
  ctx: { tz: string; now: Date },
  /** The front of the pack: used only when the product gives no name. */
  front?: FrontLabelExtractionResult,
): PhotoReply {
  if (!product) {
    return phoneLabelReply(
      read,
      profileOutcome,
      ctx,
      BARCODE_UNKNOWN_LABEL_TEXT,
      front,
    );
  }
  if (!labelFitsProduct(read, product.per100g.calories)) {
    // Neither the name nor its allergen data is trusted for this pack.
    return phoneLabelReply(
      read,
      profileOutcome,
      ctx,
      BARCODE_MISMATCH_LABEL_TEXT,
      front,
    );
  }
  const item = phoneLabelRow(read, productDisplayName(product));
  if (!item) return { payload: null, text: ROW_REFUSED_TEXT };
  return {
    payload: onePackagedFood(item, ctx),
    text: BARCODE_LABEL_TEXT + barcodeAllergyText(product, profileOutcome),
  };
}

/**
 * The Coach's answer to a barcode the app's camera read: the same lookup,
 * card and allergy check as a barcode in a photo, with no model in the way.
 * A lookup outage is answered in words; any other failure rejects.
 */
export async function scannedBarcodeReply(
  code: string,
  ctx: { tz: string; now: Date; userId: string },
  /** The pack's nutrition label, read on the phone in the scanner's label step. */
  label?: PhoneLabelRead,
  /** The front of the pack, read by the AI model in the front step. */
  front?: FrontLabelExtractionResult,
): Promise<PhotoReply> {
  try {
    const { result, profileOutcome } = await loadBarcodeScanContext(
      code,
      ctx.userId,
    );
    return label
      ? barcodeWithLabelReply(result, profileOutcome, label, ctx, front)
      : barcodePhotoReply(result, profileOutcome, ctx);
  } catch (err) {
    // Every source errored: an outage, not an unknown product.
    if (err instanceof UpstreamUnavailableError) {
      if (label) {
        return phoneLabelReply(
          label,
          await loadAllergyProfile(ctx.userId),
          ctx,
          BARCODE_DOWN_LABEL_TEXT,
          front,
        );
      }
      return { payload: null, text: BARCODE_LOOKUP_DOWN_TEXT };
    }
    throw err;
  }
}

const FRONT_FAILED_TEXT = " I couldn't read the front of the pack, though.";

/**
 * A barcode scanned with its label read on the phone and a photo of the
 * front of the pack (the scanner's optional third step, offered when the
 * barcode gives no usable name). The front is read by the AI model for its
 * name and printed allergen statements while the product is looked up; a
 * front that can't be read still leaves the label's card.
 */
export async function scannedBarcodeFrontReply(
  code: string,
  frontImageBase64: string,
  ctx: { tz: string; now: Date; userId: string },
  label: PhoneLabelRead,
): Promise<PhotoReply> {
  const front = await analyzeFrontLabel(frontImageBase64, {
    allergens: true,
  }).catch((err: unknown) => {
    logger.warn({ err: toError(err) }, "coach front-of-pack read failed");
    return undefined;
  });
  const reply = await scannedBarcodeReply(code, ctx, label, front);
  return front ? reply : { ...reply, text: reply.text + FRONT_FAILED_TEXT };
}
