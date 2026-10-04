// Pure conversions from expo-iap's store objects to the app's own IAP types.
// Type-only imports: this module never loads the native package, so it is safe
// to unit-test and to import from the mock path.
import type {
  ProductSubscriptionAndroid,
  ProductSubscriptionAndroidOfferDetails,
  ProductSubscriptionIOS,
  Purchase,
  SubscriptionPeriodIOS,
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
  unit: SubscriptionPeriodIOS | null | undefined,
): SubscriptionPeriodUnit | null {
  return unit && unit !== "empty" ? unit : null;
}

/**
 * Reads subscriptionInfoIOS although expo-iap marks it deprecated in favour of
 * subscriptionOffers: the version is pinned (3.4.8) and the base billing period
 * is not part of subscriptionOffers.
 *
 * @param eligibleForIntroOffer from isEligibleForIntroOfferIOS: StoreKit lists
 *   the intro offer on the product whether or not this user already used it.
 */
export function toIAPProductIOS(
  product: ProductSubscriptionIOS,
  eligibleForIntroOffer: boolean,
): IAPProduct {
  const info = product.subscriptionInfoIOS;
  let period: SubscriptionPeriod | null = null;
  const infoUnit = iosUnit(info?.subscriptionPeriod.unit);
  if (info && infoUnit && info.subscriptionPeriod.value > 0) {
    period = { count: info.subscriptionPeriod.value, unit: infoUnit };
  } else {
    const flatUnit = iosUnit(product.subscriptionPeriodUnitIOS);
    const flatCount = Number(product.subscriptionPeriodNumberIOS);
    if (flatUnit && flatCount > 0) {
      period = { count: flatCount, unit: flatUnit };
    }
  }

  let introOffer: FreeTrialOffer | null = null;
  const offer = info?.introductoryOffer;
  const offerUnit = iosUnit(offer?.period.unit);
  if (
    eligibleForIntroOffer &&
    offer &&
    offer.paymentMode === "free-trial" &&
    offerUnit &&
    offer.period.value > 0 &&
    offer.periodCount > 0
  ) {
    introOffer = {
      kind: "free-trial",
      length: {
        count: offer.period.value * offer.periodCount,
        unit: offerUnit,
      },
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
 * Google Play lists only the offers this user is eligible for, so a listed
 * free-then-recurring offer means the user can start a free trial. Reads the
 * deprecated subscriptionOfferDetailsAndroid on purpose: it is the field
 * expo-iap's own hook uses to sort a product into `subscriptions`.
 */
export function toIAPProductAndroid(
  product: ProductSubscriptionAndroid,
): IAPProduct | null {
  const offers: ProductSubscriptionAndroidOfferDetails[] =
    product.subscriptionOfferDetailsAndroid;
  if (offers.length === 0) return null;

  // Exactly two phases — free, then the recurring price — so "Free for N days,
  // then <price>" is the whole story. A free phase followed by a paid intro
  // phase would hide that middle charge; such an offer is not chosen.
  const trialOffer = offers.find((offer) => {
    const phases = offer.pricingPhases.pricingPhaseList;
    return phases.length === 2 && isFreePhase(phases[0].priceAmountMicros);
  });
  const chosen =
    trialOffer ?? offers.find((offer) => !offer.offerId) ?? offers[0];
  const phases = chosen.pricingPhases.pricingPhaseList;
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
    androidOfferToken: chosen.offerToken,
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
