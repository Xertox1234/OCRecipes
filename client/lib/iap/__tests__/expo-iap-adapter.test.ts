// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type {
  ProductSubscription,
  ProductSubscriptionIOS,
  Purchase,
  PurchaseIOS,
} from "expo-iap";

import { useExpoIAP } from "../expo-iap-adapter";

const SKU = "com.ocrecipes.premium.annual";

// The fake expo-iap hook hands back whatever `hookState` holds and records the
// callbacks the adapter registers, so a test can fire store events by hand.
const { hookState, callbacks, storeMock } = vi.hoisted(() => {
  const hookState = {
    connected: false,
    subscriptions: [] as ProductSubscription[],
  };
  const callbacks: {
    onPurchaseSuccess?: (purchase: Purchase) => void;
    onPurchaseError?: (error: Error) => void;
  } = {};
  const storeMock = {
    fetchProducts: vi.fn(() => Promise.resolve()),
    requestPurchase: vi.fn(() => Promise.resolve(null)),
    finishTransaction: vi.fn(() => Promise.resolve()),
    restorePurchases: vi.fn(() => Promise.resolve()),
    getAvailablePurchases: vi.fn(() => Promise.resolve([] as Purchase[])),
    isEligibleForIntroOfferIOS: vi.fn(() => Promise.resolve(true)),
  };
  return { hookState, callbacks, storeMock };
});

vi.mock("expo-iap", () => ({
  useIAP: (options: typeof callbacks) => {
    callbacks.onPurchaseSuccess = options.onPurchaseSuccess;
    callbacks.onPurchaseError = options.onPurchaseError;
    return {
      connected: hookState.connected,
      subscriptions: hookState.subscriptions,
      fetchProducts: storeMock.fetchProducts,
      requestPurchase: storeMock.requestPurchase,
      finishTransaction: storeMock.finishTransaction,
    };
  },
  restorePurchases: storeMock.restorePurchases,
  getAvailablePurchases: storeMock.getAvailablePurchases,
  isEligibleForIntroOfferIOS: storeMock.isEligibleForIntroOfferIOS,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function iosTrialSubscription(): ProductSubscriptionIOS {
  return {
    currency: "USD",
    description: "Premium",
    displayNameIOS: "Premium",
    displayPrice: "$29.99",
    id: SKU,
    introductoryPricePaymentModeIOS: "free-trial",
    isFamilyShareableIOS: false,
    jsonRepresentationIOS: "{}",
    platform: "ios",
    title: "Premium",
    type: "subs",
    typeIOS: "auto-renewable-subscription",
    subscriptionInfoIOS: {
      subscriptionGroupId: "group-1",
      subscriptionPeriod: { unit: "year", value: 1 },
      introductoryOffer: {
        displayPrice: "$0.00",
        id: "intro",
        paymentMode: "free-trial",
        period: { unit: "day", value: 3 },
        periodCount: 1,
        price: 0,
        type: "introductory",
      },
    },
  };
}

function iosPurchase(overrides: Partial<PurchaseIOS> = {}): PurchaseIOS {
  return {
    id: "1",
    isAutoRenewing: true,
    platform: "ios",
    productId: SKU,
    purchaseState: "purchased",
    purchaseToken: "eyJ.jws.sig",
    quantity: 1,
    store: "apple",
    transactionDate: 1000,
    transactionId: "2000000001",
    ...overrides,
  };
}

async function connectedWithProduct() {
  hookState.connected = true;
  hookState.subscriptions = [iosTrialSubscription()];
  const hook = renderHook(() => useExpoIAP());
  await waitFor(() => expect(hook.result.current.products).toHaveLength(1));
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  hookState.connected = false;
  hookState.subscriptions = [];
  storeMock.getAvailablePurchases.mockImplementation(() =>
    Promise.resolve([] as Purchase[]),
  );
  storeMock.isEligibleForIntroOfferIOS.mockImplementation(() =>
    Promise.resolve(true),
  );
  storeMock.requestPurchase.mockImplementation(() => Promise.resolve(null));
});

describe("useExpoIAP — loading the subscription", () => {
  it("asks the store for the annual subscription once connected", async () => {
    const hook = renderHook(() => useExpoIAP());
    expect(storeMock.fetchProducts).not.toHaveBeenCalled();

    hookState.connected = true;
    hook.rerender();

    await waitFor(() =>
      expect(storeMock.fetchProducts).toHaveBeenCalledWith({
        skus: [SKU],
        type: "subs",
      }),
    );
  });

  it("shows the free trial only after the store confirms eligibility", async () => {
    const { result } = await connectedWithProduct();

    expect(storeMock.isEligibleForIntroOfferIOS).toHaveBeenCalledWith(
      "group-1",
    );
    expect(result.current.products[0]).toMatchObject({
      displayPrice: "$29.99",
      period: { count: 1, unit: "year" },
      introOffer: { kind: "free-trial", length: { count: 3, unit: "day" } },
    });
  });

  it("hides the free trial when the eligibility check fails", async () => {
    storeMock.isEligibleForIntroOfferIOS.mockImplementation(() =>
      Promise.reject(new Error("storekit")),
    );
    const { result } = await connectedWithProduct();

    expect(result.current.products[0].introOffer).toBeNull();
  });
});

describe("useExpoIAP — refreshing", () => {
  it("does not ask the store before it is connected", () => {
    const { result } = renderHook(() => useExpoIAP());

    act(() => result.current.refreshProducts());

    expect(storeMock.fetchProducts).not.toHaveBeenCalled();
  });
});

describe("useExpoIAP — buying", () => {
  it("resolves with the purchase the store reports", async () => {
    const { result } = await connectedWithProduct();

    let settled: unknown;
    act(() => {
      void result.current
        .requestPurchase(result.current.products[0])
        .then((value) => {
          settled = value;
        });
    });
    expect(storeMock.requestPurchase).toHaveBeenCalledWith({
      type: "subs",
      request: {
        apple: { sku: SKU },
        google: { skus: [SKU] },
      },
    });

    const purchase = iosPurchase();
    act(() => callbacks.onPurchaseSuccess?.(purchase));

    await waitFor(() =>
      expect(settled).toEqual({
        productId: SKU,
        transactionId: "2000000001",
        purchaseToken: "eyJ.jws.sig",
        native: purchase,
      }),
    );
  });

  it("passes the Android offer token Google requires", async () => {
    const { result } = await connectedWithProduct();

    act(() => {
      void result.current
        .requestPurchase({
          ...result.current.products[0],
          androidOfferToken: "offer-token",
        })
        .catch(() => undefined);
    });

    expect(storeMock.requestPurchase).toHaveBeenCalledWith({
      type: "subs",
      request: {
        apple: { sku: SKU },
        google: {
          skus: [SKU],
          subscriptionOffers: [{ sku: SKU, offerToken: "offer-token" }],
        },
      },
    });
  });

  it("rejects with the store's error", async () => {
    const { result } = await connectedWithProduct();

    let failure: unknown;
    act(() => {
      void result.current
        .requestPurchase(result.current.products[0])
        .catch((error: unknown) => {
          failure = error;
        });
    });
    // expo-iap forwards the native event payload unchanged: a plain
    // { code, message } object, not an Error (build/index.js
    // purchaseErrorListener). The adapter turns it into an Error keeping the code.
    const payload = { code: "user-cancelled", message: "User cancelled" };
    act(() => callbacks.onPurchaseError?.(payload as unknown as Error));

    await waitFor(() => expect(failure).toBeInstanceOf(Error));
    expect(failure).toMatchObject({
      code: "user-cancelled",
      message: "User cancelled",
    });
  });

  it("asks the store again when refreshProducts is called", async () => {
    const { result } = await connectedWithProduct();
    storeMock.fetchProducts.mockClear();

    act(() => result.current.refreshProducts());

    expect(storeMock.fetchProducts).toHaveBeenCalledWith({
      skus: [SKU],
      type: "subs",
    });
  });

  it("turns a plain payload from the store's own request into an Error", async () => {
    // The store's own shape: a plain payload, not an Error.
    storeMock.requestPurchase.mockRejectedValue({
      code: "user-cancelled",
      message: "User cancelled",
    });
    const { result } = await connectedWithProduct();

    const failure: unknown = await result.current
      .requestPurchase(result.current.products[0])
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ code: "user-cancelled" });
  });

  it("keeps refreshProducts the same function across renders", async () => {
    // The paywall's retry effect depends on this identity: a new function each
    // render would re-fetch on every render after a failed load.
    const hook = await connectedWithProduct();
    const first = hook.result.current.refreshProducts;

    hook.rerender();

    expect(hook.result.current.refreshProducts).toBe(first);
  });

  it("rejects when the store's own request fails", async () => {
    storeMock.requestPurchase.mockImplementation(() =>
      Promise.reject(new Error("not-prepared")),
    );
    const { result } = await connectedWithProduct();

    await expect(
      result.current.requestPurchase(result.current.products[0]),
    ).rejects.toThrow("not-prepared");
  });

  it("rejects a purchase still waiting on approval with the pending code", async () => {
    const { result } = await connectedWithProduct();

    let failure: unknown;
    act(() => {
      void result.current
        .requestPurchase(result.current.products[0])
        .catch((error: unknown) => {
          failure = error;
        });
    });
    act(() =>
      callbacks.onPurchaseSuccess?.(iosPurchase({ purchaseState: "pending" })),
    );

    await waitFor(() => expect(failure).toMatchObject({ code: "pending" }));
  });
});

describe("useExpoIAP — restoring", () => {
  it("returns a purchase that arrived with nothing waiting for it, without asking the store", async () => {
    // StoreKit redelivers an unfinished transaction on connect, e.g. when the
    // user was charged but the server never confirmed it.
    const { result } = await connectedWithProduct();
    const purchase = iosPurchase({ transactionId: "unclaimed" });
    act(() => callbacks.onPurchaseSuccess?.(purchase));

    const restored = await result.current.restorePurchases();

    expect(restored?.transactionId).toBe("unclaimed");
    expect(storeMock.getAvailablePurchases).not.toHaveBeenCalled();
  });

  it("returns the newest completed purchase of ours", async () => {
    storeMock.getAvailablePurchases.mockImplementation(() =>
      Promise.resolve([
        iosPurchase({ productId: "other.product", transactionId: "x" }),
        iosPurchase({ transactionId: "old", transactionDate: 1 }),
        iosPurchase({ transactionId: "new", transactionDate: 2 }),
        iosPurchase({
          transactionId: "pending",
          transactionDate: 3,
          purchaseState: "pending",
        }),
      ]),
    );
    const { result } = await connectedWithProduct();

    const restored = await result.current.restorePurchases();

    expect(storeMock.restorePurchases).toHaveBeenCalled();
    expect(restored?.transactionId).toBe("new");
  });

  it("returns null when the store has nothing of ours", async () => {
    const { result } = await connectedWithProduct();

    expect(await result.current.restorePurchases()).toBeNull();
  });
});

describe("useExpoIAP — finishing", () => {
  it("hands the store's own purchase back as a non-consumable", async () => {
    const { result } = await connectedWithProduct();
    const purchase = iosPurchase();

    await result.current.finishTransaction({
      productId: SKU,
      transactionId: "2000000001",
      purchaseToken: "eyJ.jws.sig",
      native: purchase,
    });

    expect(storeMock.finishTransaction).toHaveBeenCalledWith({
      purchase,
      isConsumable: false,
    });
  });
});
