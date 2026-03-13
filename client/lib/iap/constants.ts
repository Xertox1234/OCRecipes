import type { IAPProduct } from "./types";

export const PRODUCT_IDS = {
  ANNUAL_PREMIUM: "com.ocrecipes.premium.annual",
} as const;

export const MOCK_PRODUCTS: IAPProduct[] = [
  {
    productId: PRODUCT_IDS.ANNUAL_PREMIUM,
    title: "OCRecipes Premium (Annual)",
    description: "Unlimited scans, AI recipes, macro goals & more",
    price: "$29.99",
    currency: "USD",
  },
];
