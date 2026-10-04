import type { IAPProduct } from "./types";

export const PRODUCT_IDS = {
  ANNUAL_PREMIUM: "com.ocrecipes.premium.annual",
} as const;

/** Dev-only stand-in for the store's product (see ./mock-iap.ts). */
export const MOCK_PRODUCTS: IAPProduct[] = [
  {
    productId: PRODUCT_IDS.ANNUAL_PREMIUM,
    displayPrice: "$29.99",
    period: { count: 1, unit: "year" },
    introOffer: { kind: "free-trial", length: { count: 3, unit: "day" } },
    androidOfferToken: null,
  },
];
