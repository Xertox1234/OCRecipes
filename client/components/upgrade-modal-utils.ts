import type { PurchaseError, PurchaseState } from "@shared/types/subscription";
import type {
  IAPProduct,
  SubscriptionPeriod,
  SubscriptionPeriodUnit,
} from "@/lib/iap/types";

/** Benefit items displayed in the upgrade modal. */
export const BENEFITS = [
  { icon: "zap" as const, label: "Unlimited daily scans" },
  { icon: "bar-chart-2" as const, label: "Detailed macro goals" },
  { icon: "book-open" as const, label: "AI recipe generation" },
  { icon: "camera" as const, label: "High quality photo capture" },
];

const UNIT_TITLE: Record<SubscriptionPeriodUnit, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

/** "year" for one, "3 months" for several. */
function formatPeriod(period: SubscriptionPeriod): string {
  return period.count === 1 ? period.unit : `${period.count} ${period.unit}s`;
}

function formatLength(period: SubscriptionPeriod): string {
  return `${period.count} ${period.unit}${period.count === 1 ? "" : "s"}`;
}

/** "$29.99 per year" — the store's localized price and its billing period. */
function priceWithPeriod(product: IAPProduct): string {
  if (!product.period) return product.displayPrice;
  return product.period.count === 1
    ? `${product.displayPrice} per ${formatPeriod(product.period)}`
    : `${product.displayPrice} every ${formatPeriod(product.period)}`;
}

/**
 * Returns the CTA button label. The free-trial wording appears only when the
 * store reported a trial this user can start.
 */
export function getCtaLabel(
  status: PurchaseState["status"],
  product: IAPProduct | null = null,
): string {
  switch (status) {
    case "loading":
    case "pending":
      return "Processing...";
    case "restoring":
      return "Restoring...";
    case "success":
      return "Welcome to Premium!";
    default: {
      const trial = product?.introOffer;
      if (!trial) return "Subscribe";
      return `Start ${trial.length.count}-${UNIT_TITLE[trial.length.unit]} Free Trial`;
    }
  }
}

/** Returns whether the CTA button should be disabled. */
export function isCtaDisabled(
  status: PurchaseState["status"],
  hasProduct = true,
): boolean {
  return (
    !hasProduct ||
    status === "loading" ||
    status === "pending" ||
    status === "restoring" ||
    status === "success"
  );
}

/** The price line; never a made-up price before the store answers. */
export function getPriceLine(product: IAPProduct | null): string {
  return product ? priceWithPeriod(product) : "Price unavailable";
}

/** "Free for 3 days, then $29.99 per year." — or null without a trial. */
export function getTrialLine(product: IAPProduct | null): string | null {
  const trial = product?.introOffer;
  if (!product || !trial) return null;
  return `Free for ${formatLength(trial.length)}, then ${priceWithPeriod(product)}.`;
}

/**
 * The auto-renewal disclosure App Store guideline 3.1.2 asks for: what is
 * charged, when, that it renews, and how to cancel.
 */
export function getRenewalTerms(
  product: IAPProduct | null,
  platform: "ios" | "android",
): string | null {
  if (!product) return null;
  const store = platform === "ios" ? "App Store" : "Google Play";
  const account = platform === "ios" ? "Apple Account" : "Google Play account";
  const charge = product.introOffer
    ? `Payment is charged to your ${account} when the free trial ends.`
    : `Payment is charged to your ${account} when you confirm the purchase.`;
  return (
    `${charge} The subscription renews automatically at ` +
    `${priceWithPeriod(product)} unless you cancel at least 24 hours before ` +
    `the current period ends. Manage or cancel it anytime in your ${store} ` +
    `subscription settings.`
  );
}

/** Fixed, user-safe copy for each purchase error code. */
export function getUpgradeErrorMessage(
  code: PurchaseError["code"] | undefined,
): string {
  switch (code) {
    case "NETWORK":
      return "Network error. Check your connection and try again.";
    case "ALREADY_OWNED":
      return "You already own this subscription.";
    case "STORE_UNAVAILABLE":
      return "The store is currently unavailable. Try again later.";
    case "NOTHING_TO_RESTORE":
      return "No previous purchase was found to restore.";
    case "PENDING_APPROVAL":
      return "Your purchase is waiting for approval. Premium unlocks once it's approved.";
    default:
      return "Could not complete the upgrade. Please try again.";
  }
}
