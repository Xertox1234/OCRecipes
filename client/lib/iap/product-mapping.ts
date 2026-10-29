// Pure conversions from expo-iap's store objects to the app's own IAP types.
// Type-only imports: this module never loads the native package, so it is safe
// to unit-test and to import from the mock path.
import type {
  ProductSubscriptionAndroid,
  ProductSubscriptionIOS,
  Purchase,
  SubscriptionOffer,
  SubscriptionPeriodIOS,
  SubscriptionPeriodUnit as StorePeriodUnit,
} from "expo-iap";
import type {
  FreeTrialOffer,
  IAPProduct,
  IAPPurchaseResult,
  SubscriptionPeriod,
  SubscriptionPeriodUnit,
} from "./types";

const ISO_UNITS: Record<string, SubscriptionPeriodUnit> = {
  D: "day",
  W: "week",
  M: "month",
  Y: "year",
};

/** Reads a single-unit ISO 8601 period such as Google's "P1Y" or "P3D". */
export function parseIsoPeriod(iso: string): SubscriptionPeriod | null {
  const match = /^P(\d+)([DWMY])$/.exec(iso);
  if (!match) return null;
  const count = Number(match[1]);
  if (count <= 0) return null;
  return { count, unit: ISO_UNITS[match[2]] };
}

function iosUnit(
  unit: SubscriptionPeriodIOS | StorePeriodUnit | null | undefined,
): SubscriptionPeriodUnit | null {
  return unit && unit !== "empty" && unit !== "unknown" ? unit : null;
}

/** The product's introductory free-trial offer, if the store lists one. */
export function freeTrialOfferIOS(
  product: ProductSubscriptionIOS,
): SubscriptionOffer | null {
  return (
    product.subscriptionOffers?.find(
      (offer) =>
        offer.type === "introductory" && offer.paymentMode === "free-trial",
    ) ?? null
  );
}

/**
 * The base billing period comes from the flat subscriptionPeriod*IOS fields;
 * subscriptionOffers holds only the intro and promotional offers.
 *
 * @param eligibleForIntroOffer from isEligibleForIntroOfferIOS: StoreKit lists
 *   the intro offer on the product whether or not this user already used it.
 */
export function toIAPProductIOS(
  product: ProductSubscriptionIOS,
  eligibleForIntroOffer: boolean,
): IAPProduct {
  let period: SubscriptionPeriod | null = null;
  const unit = iosUnit(product.subscriptionPeriodUnitIOS);
  const count = Number(product.subscriptionPeriodNumberIOS);
  if (unit && count > 0) {
    period = { count, unit };
  }

  let introOffer: FreeTrialOffer | null = null;
  const offer = eligibleForIntroOffer ? freeTrialOfferIOS(product) : null;
  const offerUnit = iosUnit(offer?.period?.unit);
  const offerValue = offer?.period?.value ?? 0;
  const offerCount = offer?.periodCount ?? offer?.numberOfPeriodsIOS ?? 0;
  if (offerUnit && offerValue > 0 && offerCount > 0) {
    introOffer = {
      kind: "free-trial",
      length: { count: offerValue * offerCount, unit: offerUnit },
    };
  }

  return {
    productId: product.id,
    displayPrice: product.displayPrice,
    period,
    introOffer,
    androidOfferToken: null,
  };
}

function isFreePhase(micros: string): boolean {
  return micros === "0";
}

/**
 * OpenIAP gives a base plan (no offerId) its basePlanId as its id, and sets
 * basePlanIdAndroid on every offer.
 */
function isBasePlanOffer(offer: SubscriptionOffer): boolean {
  return offer.id === offer.basePlanIdAndroid;
}

function phasesOf(offer: SubscriptionOffer) {
  return offer.pricingPhasesAndroid?.pricingPhaseList ?? [];
}

/**
 * Google Play lists only the offers this user is eligible for, so a listed
 * free-then-recurring offer means the user can start a free trial.
 */
export function toIAPProductAndroid(
  product: ProductSubscriptionAndroid,
): IAPProduct | null {
  const offers = product.subscriptionOffers;
  if (offers.length === 0) return null;

  // Exactly two phases — free, then the recurring price — so "Free for N days,
  // then <price>" is the whole story. A free phase followed by a paid intro
  // phase would hide that middle charge; such an offer is not chosen.
  const trialOffer = offers.find((offer) => {
    const phases = phasesOf(offer);
    return phases.length === 2 && isFreePhase(phases[0].priceAmountMicros);
  });
  const chosen = trialOffer ?? offers.find(isBasePlanOffer) ?? offers[0];
  const phases = phasesOf(chosen);
  const recurring = phases[phases.length - 1];
  if (!recurring) return null;

  let introOffer: FreeTrialOffer | null = null;
  if (trialOffer) {
    const length = parseIsoPeriod(phases[0].billingPeriod);
    if (length) introOffer = { kind: "free-trial", length };
  }

  return {
    productId: product.id,
    displayPrice: recurring.formattedPrice,
    period: parseIsoPeriod(recurring.billingPeriod),
    introOffer,
    androidOfferToken: chosen.offerTokenAndroid ?? null,
  };
}

/** Null when the store gave no token to verify; the purchase can't be validated. */
export function toPurchaseResult(purchase: Purchase): IAPPurchaseResult | null {
  if (!purchase.purchaseToken) return null;
  const transactionId =
    ("transactionId" in purchase && purchase.transactionId) || purchase.id;
  return {
    productId: purchase.productId,
    transactionId,
    purchaseToken: purchase.purchaseToken,
    native: purchase,
  };
}
