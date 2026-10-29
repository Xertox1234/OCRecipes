import { describe, it, expect } from "vitest";
import type {
  ProductSubscriptionAndroid,
  ProductSubscriptionIOS,
  PurchaseAndroid,
  PurchaseIOS,
  SubscriptionOffer,
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
    subscriptionGroupIdIOS: "group-1",
    subscriptionPeriodNumberIOS: "1",
    subscriptionPeriodUnitIOS: "year",
    subscriptionOffers: null,
    ...overrides,
  };
}

// StoreKit's intro offer as OpenIAP apple 4.0.5 builds it: periodCount and
// numberOfPeriodsIOS both carry StoreKit's periodCount.
const THREE_DAY_TRIAL_OFFER: SubscriptionOffer = {
  displayPrice: "$0.00",
  id: "intro",
  numberOfPeriodsIOS: 1,
  paymentMode: "free-trial",
  period: { unit: "day", value: 3 },
  periodCount: 1,
  price: 0,
  type: "introductory",
};

function androidOffer(
  phases: { price: string; micros: string; period: string }[],
  offerId: string | null,
  token: string | null,
): SubscriptionOffer {
  // OpenIAP google 4.0.6: a base plan's id is its basePlanId, and every offer
  // carries basePlanIdAndroid.
  return {
    basePlanIdAndroid: "annual",
    displayPrice: phases[0]?.price ?? "",
    id: offerId ?? "annual",
    offerTagsAndroid: [],
    offerTokenAndroid: token,
    price: Number(phases[0]?.micros ?? 0) / 1_000_000,
    type: offerId ? "promotional" : "introductory",
    pricingPhasesAndroid: {
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
  offers: SubscriptionOffer[],
): ProductSubscriptionAndroid {
  return {
    currency: "USD",
    description: "Premium",
    displayPrice: "$29.99",
    id: SKU,
    nameAndroid: "Premium",
    platform: "android",
    subscriptionOffers: offers,
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
      iosSubscription({ subscriptionOffers: [THREE_DAY_TRIAL_OFFER] }),
      true,
    );
    expect(product.introOffer).toEqual({
      kind: "free-trial",
      length: { count: 3, unit: "day" },
    });
  });

  it("hides the free trial from a user who is not eligible", () => {
    const product = toIAPProductIOS(
      iosSubscription({ subscriptionOffers: [THREE_DAY_TRIAL_OFFER] }),
      false,
    );
    expect(product.introOffer).toBeNull();
  });

  it("does not call a paid introductory price a free trial", () => {
    const product = toIAPProductIOS(
      iosSubscription({
        subscriptionOffers: [
          {
            ...THREE_DAY_TRIAL_OFFER,
            paymentMode: "pay-up-front",
            price: 0.99,
          },
        ],
      }),
      true,
    );
    expect(product.introOffer).toBeNull();
  });

  it("multiplies the offer period by its count", () => {
    const product = toIAPProductIOS(
      iosSubscription({
        subscriptionOffers: [
          {
            ...THREE_DAY_TRIAL_OFFER,
            period: { unit: "week", value: 1 },
            periodCount: 2,
            numberOfPeriodsIOS: 2,
          },
        ],
      }),
      true,
    );
    expect(product.introOffer?.length).toEqual({ count: 2, unit: "week" });
  });

  it("reads the flat period fields and shows no trial when the store lists no offers", () => {
    const product = toIAPProductIOS(
      iosSubscription({
        subscriptionOffers: null,
        subscriptionPeriodNumberIOS: "1",
        subscriptionPeriodUnitIOS: "month",
      }),
      true,
    );
    expect(product.period).toEqual({ count: 1, unit: "month" });
    expect(product.introOffer).toBeNull();
  });

  it("reads the trial count from numberOfPeriodsIOS when periodCount is missing", () => {
    const offer = {
      ...THREE_DAY_TRIAL_OFFER,
      periodCount: null,
      numberOfPeriodsIOS: 2,
    };
    const product = toIAPProductIOS(
      iosSubscription({ subscriptionOffers: [offer] }),
      true,
    );
    expect(product.introOffer).toEqual({
      kind: "free-trial",
      length: { count: 6, unit: "day" },
    });
  });

  it("shows no trial when the offer has no usable count", () => {
    const offer = {
      ...THREE_DAY_TRIAL_OFFER,
      periodCount: null,
      numberOfPeriodsIOS: null,
    };
    const product = toIAPProductIOS(
      iosSubscription({ subscriptionOffers: [offer] }),
      true,
    );
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

  it("does not call a free-then-paid-intro offer a plain free trial", () => {
    // "Free for 3 days, then $29.99 per year" would hide the paid middle phase.
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
            { price: "$0.99", micros: "990000", period: "P1M" },
            { price: "$29.99", micros: "29990000", period: "P1Y" },
          ],
          "trial-then-intro",
          "three-phase-token",
        ),
      ]),
    );
    expect(product?.introOffer).toBeNull();
    expect(product?.androidOfferToken).toBe("base-token");
  });

  it("uses the first offer when Google lists no base plan", () => {
    const product = toIAPProductAndroid(
      androidSubscription([
        androidOffer(
          [{ price: "$24.99", micros: "24990000", period: "P1Y" }],
          "winback",
          "winback-token",
        ),
      ]),
    );
    expect(product?.androidOfferToken).toBe("winback-token");
    expect(product?.displayPrice).toBe("$24.99");
  });

  it("buys by SKU alone when the chosen offer has no token", () => {
    const product = toIAPProductAndroid(
      androidSubscription([
        androidOffer(
          [{ price: "$29.99", micros: "29990000", period: "P1Y" }],
          null,
          null,
        ),
      ]),
    );
    expect(product?.androidOfferToken).toBeNull();
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
    storeId: "1",
    transactionDate: 0,
  };

  it("sends the iOS JWS as the token", () => {
    const purchase: PurchaseIOS = {
      ...base,
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
      store: "google",
      purchaseToken: "google-token",
    };
    expect(toPurchaseResult(purchase)?.transactionId).toBe("GPA.1234");
  });

  it("returns null without a token", () => {
    const purchase: PurchaseIOS = {
      ...base,
      store: "apple",
      transactionId: "2000000001",
      purchaseToken: null,
    };
    expect(toPurchaseResult(purchase)).toBeNull();
  });
});
