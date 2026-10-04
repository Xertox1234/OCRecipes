export type SubscriptionPeriodUnit = "day" | "week" | "month" | "year";

export interface SubscriptionPeriod {
  count: number;
  unit: SubscriptionPeriodUnit;
}

/** A free trial the store says this user can start, or nothing. */
export interface FreeTrialOffer {
  kind: "free-trial";
  length: SubscriptionPeriod;
}

export interface IAPProduct {
  productId: string;
  /** Localized price string from the store, e.g. "$29.99". */
  displayPrice: string;
  /** How often that price is charged; null when the store didn't say. */
  period: SubscriptionPeriod | null;
  introOffer: FreeTrialOffer | null;
  /** Google Play requires the chosen offer's token to start a subscription. */
  androidOfferToken: string | null;
}

export interface IAPPurchaseResult {
  productId: string;
  transactionId: string;
  /** What the server verifies: the iOS JWS signed transaction or the Google purchase token. */
  purchaseToken: string;
  /** The store's own purchase object, handed back to finishTransaction. */
  native: unknown;
}

export interface UseIAPResult {
  connected: boolean;
  products: IAPProduct[];
  requestPurchase: (product: IAPProduct) => Promise<IAPPurchaseResult>;
  /** Resolves null when the store has no purchase of ours to restore. */
  restorePurchases: () => Promise<IAPPurchaseResult | null>;
  finishTransaction: (purchase: IAPPurchaseResult) => Promise<void>;
  /** Asks the store for the product again, e.g. after a failed first load. Stable identity. */
  refreshProducts: () => void;
}
