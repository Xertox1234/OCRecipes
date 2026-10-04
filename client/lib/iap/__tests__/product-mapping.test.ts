import { describe, it, expect } from "vitest";
import type {
  ProductSubscriptionAndroid,
  ProductSubscriptionAndroidOfferDetails,
  ProductSubscriptionIOS,
  PurchaseAndroid,
  PurchaseIOS,
} from "expo-iap";
import {
  parseIsoPeriod,
  toIAPProductAndroid,
  toIAPProductIOS,
  toPurchaseResult,
} from "../product-mapping";

const SKU = "com.ocrecipes.premium.annual";

function iosSubscription(
  overrides: Partial<ProductSubscriptionIOS> = {},
): ProductSubscriptionIOS {
  return {
    currency: "USD",
    description: "Premium",
    displayNameIOS: "Premium",
    displayPrice: "$29.99",
    id: SKU,
    introductoryPricePaymentModeIOS: "empty",
    isFamilyShareableIOS: false,
    jsonRepresentationIOS: "{}",
    platform: "ios",
    title: "Premium",
    type: "subs",
    typeIOS: "auto-renewable-subscription",
    subscriptionInfoIOS: {
      subscriptionGroupId: "group-1",
      subscriptionPeriod: { unit: "year", value: 1 },
      introductoryOffer: null,
    },
    ...overrides,
  };
}

const THREE_DAY_TRIAL_IOS = {
  subscriptionGroupId: "group-1",
  subscriptionPeriod: { unit: "year" as const, value: 1 },
  introductoryOffer: {
    displayPrice: "$0.00",
    id: "intro",
    paymentMode: "free-trial" as const,
    period: { unit: "day" as const, value: 3 },
    periodCount: 1,
    price: 0,
    type: "introductory" as const,
  },
};

function androidOffer(
  phases: { price: string; micros: string; period: string }[],
  offerId: string | null,
  token: string,
): ProductSubscriptionAndroidOfferDetails {
  return {
    basePlanId: "annual",
    offerId,
    offerTags: [],
    offerToken: token,
    pricingPhases: {
      pricingPhaseList: phases.map((p, i) => ({
        billingCycleCount: i === phases.length - 1 ? 0 : 1,
        billingPeriod: p.period,
        formattedPrice: p.price,
        priceAmountMicros: p.micros,
        priceCurrencyCode: "USD",
        recurrenceMode: i === phases.length - 1 ? 1 : 2,
      })),
    },
  };
}

function androidSubscription(
  offers: ProductSubscriptionAndroidOfferDetails[],
): ProductSubscriptionAndroid {
  return {
    currency: "USD",
    description: "Premium",
    displayPrice: "$29.99",
    id: SKU,
    nameAndroid: "Premium",
    platform: "android",
    subscriptionOfferDetailsAndroid: offers,
    subscriptionOffers: [],
    title: "Premium",
    type: "subs",
  };
}

describe("parseIsoPeriod", () => {
  it.each([
    ["P1Y", { count: 1, unit: "year" }],
    ["P1M", { count: 1, unit: "month" }],
    ["P1W", { count: 1, unit: "week" }],
    ["P3D", { count: 3, unit: "day" }],
  ])("reads %s", (iso, expected) => {
    expect(parseIsoPeriod(iso)).toEqual(expected);
  });

  it.each([[""], ["1Y"], ["P"], ["P1Y2M"], ["P0D"]])("rejects %p", (iso) => {
    expect(parseIsoPeriod(iso)).toBeNull();
  });
});

describe("toIAPProductIOS", () => {
  it("maps price and billing period", () => {
    expect(toIAPProductIOS(iosSubscription(), false)).toEqual({
      productId: SKU,
      displayPrice: "$29.99",
      period: { count: 1, unit: "year" },
      introOffer: null,
      androidOfferToken: null,
    });
  });

  it("reports the free trial when the store offers one and the user is eligible", () => {
    const product = toIAPProductIOS(
      iosSubscription({ subscriptionInfoIOS: THREE_DAY_TRIAL_IOS }),
      true,
    );
    expect(product.introOffer).toEqual({
      kind: "free-trial",
      length: { count: 3, unit: "day" },
    });
  });

  it("hides the free trial from a user who is not eligible", () => {
    const product = toIAPProductIOS(
      iosSubscription({ subscriptionInfoIOS: THREE_DAY_TRIAL_IOS }),
      false,
    );
    expect(product.introOffer).toBeNull();
  });

  it("does not call a paid introductory price a free trial", () => {
    const product = toIAPProductIOS(
      iosSubscription({
        subscriptionInfoIOS: {
          ...THREE_DAY_TRIAL_IOS,
          introductoryOffer: {
            ...THREE_DAY_TRIAL_IOS.introductoryOffer,
            paymentMode: "pay-up-front",
            price: 0.99,
          },
        },
      }),
      true,
    );
    expect(product.introOffer).toBeNull();
  });

  it("multiplies the offer period by its count", () => {
    const product = toIAPProductIOS(
      iosSubscription({
        subscriptionInfoIOS: {
          ...THREE_DAY_TRIAL_IOS,
          introductoryOffer: {
            ...THREE_DAY_TRIAL_IOS.introductoryOffer,
            period: { unit: "week", value: 1 },
            periodCount: 2,
          },
        },
      }),
      true,
    );
    expect(product.introOffer?.length).toEqual({ count: 2, unit: "week" });
  });

  it("falls back to the flat period fields when subscription info is missing", () => {
    const product = toIAPProductIOS(
      iosSubscription({
        subscriptionInfoIOS: null,
        subscriptionPeriodNumberIOS: "1",
        subscriptionPeriodUnitIOS: "month",
      }),
      true,
    );
    expect(product.period).toEqual({ count: 1, unit: "month" });
    expect(product.introOffer).toBeNull();
  });
});

describe("toIAPProductAndroid", () => {
  it("uses the base plan's recurring price and token", () => {
    const product = toIAPProductAndroid(
      androidSubscription([
        androidOffer(
          [{ price: "$29.99", micros: "29990000", period: "P1Y" }],
          null,
          "base-token",
        ),
      ]),
    );
    expect(product).toEqual({
      productId: SKU,
      displayPrice: "$29.99",
      period: { count: 1, unit: "year" },
      introOffer: null,
      androidOfferToken: "base-token",
    });
  });

  it("prefers an offer with a free phase and reports its length", () => {
    const product = toIAPProductAndroid(
      androidSubscription([
        androidOffer(
          [{ price: "$29.99", micros: "29990000", period: "P1Y" }],
          null,
          "base-token",
        ),
        androidOffer(
          [
            { price: "Free", micros: "0", period: "P3D" },
            { price: "$29.99", micros: "29990000", period: "P1Y" },
          ],
          "trial",
          "trial-token",
        ),
      ]),
    );
    expect(product?.androidOfferToken).toBe("trial-token");
    expect(product?.displayPrice).toBe("$29.99");
    expect(product?.introOffer).toEqual({
      kind: "free-trial",
      length: { count: 3, unit: "day" },
    });
  });

  it("returns null when Google lists no offers", () => {
    expect(toIAPProductAndroid(androidSubscription([]))).toBeNull();
  });
});

describe("toPurchaseResult", () => {
  const base = {
    id: "1",
    isAutoRenewing: true,
    productId: SKU,
    purchaseState: "purchased" as const,
    quantity: 1,
    transactionDate: 0,
  };

  it("sends the iOS JWS as the token", () => {
    const purchase: PurchaseIOS = {
      ...base,
      platform: "ios",
      store: "apple",
      transactionId: "2000000001",
      purchaseToken: "eyJ.jws.sig",
    };
    expect(toPurchaseResult(purchase)).toEqual({
      productId: SKU,
      transactionId: "2000000001",
      purchaseToken: "eyJ.jws.sig",
      native: purchase,
    });
  });

  it("falls back to the purchase id when Google gives no transaction id", () => {
    const purchase: PurchaseAndroid = {
      ...base,
      id: "GPA.1234",
      platform: "android",
      store: "google",
      purchaseToken: "google-token",
    };
    expect(toPurchaseResult(purchase)?.transactionId).toBe("GPA.1234");
  });

  it("returns null without a token", () => {
    const purchase: PurchaseIOS = {
      ...base,
      platform: "ios",
      store: "apple",
      transactionId: "2000000001",
      purchaseToken: null,
    };
    expect(toPurchaseResult(purchase)).toBeNull();
  });
});
