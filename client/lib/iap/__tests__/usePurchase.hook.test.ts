// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { IAPProduct, IAPPurchaseResult, UseIAPResult } from "../types";

import { usePurchase } from "../usePurchase";

const PRODUCT: IAPProduct = {
  productId: "com.ocrecipes.premium.annual",
  displayPrice: "$29.99",
  period: { count: 1, unit: "year" },
  introOffer: null,
  androidOfferToken: null,
};

const PURCHASE: IAPPurchaseResult = {
  productId: PRODUCT.productId,
  transactionId: "2000000001",
  purchaseToken: "eyJ.jws.sig",
  native: { from: "store" },
};

const GRANTED = JSON.stringify({ success: true, tier: "premium" });
const DECLINED = JSON.stringify({
  success: false,
  error: "Receipt validation failed",
  code: "STORE_API_ERROR",
});

const { iap, apiRequest, refreshSubscription } = vi.hoisted(() => ({
  iap: {
    connected: true,
    products: [] as IAPProduct[],
    requestPurchase: vi.fn(),
    restorePurchases: vi.fn(),
    finishTransaction: vi.fn(() => Promise.resolve()),
    refreshProducts: vi.fn(),
  },
  apiRequest: vi.fn(() => Promise.resolve(new Response(GRANTED))),
  refreshSubscription: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/iap/index", () => ({
  useIAP: (): UseIAPResult => iap,
  PRODUCT_IDS: { ANNUAL_PREMIUM: "com.ocrecipes.premium.annual" },
}));
vi.mock("@/lib/query-client", () => ({ apiRequest }));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ refreshSubscription }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  iap.products = [PRODUCT];
  iap.requestPurchase.mockResolvedValue(PURCHASE);
  iap.restorePurchases.mockResolvedValue(PURCHASE);
  apiRequest.mockImplementation(() => Promise.resolve(new Response(GRANTED)));
});

describe("usePurchase.purchase", () => {
  it("sends the store's token to the server, then finishes the transaction", async () => {
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.purchase());

    expect(iap.requestPurchase).toHaveBeenCalledWith(PRODUCT);
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/subscription/upgrade",
      {
        receipt: "eyJ.jws.sig",
        platform: "ios",
        productId: PRODUCT.productId,
        transactionId: "2000000001",
      },
    );
    expect(iap.finishTransaction).toHaveBeenCalledWith(PURCHASE);
    expect(result.current.state.status).toBe("success");
  });

  it("treats a cancelled store sheet as cancelled, not as an error", async () => {
    // The shape expo-iap's purchase listener actually delivers.
    iap.requestPurchase.mockRejectedValue({
      code: "user-cancelled",
      message: "User cancelled",
    });
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.purchase());

    expect(result.current.state.status).toBe("cancelled");
  });

  it("reports the store as unavailable when no product has loaded", async () => {
    iap.products = [];
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.purchase());

    expect(iap.requestPurchase).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "error",
      error: { code: "STORE_UNAVAILABLE" },
    });
  });

  it("does not finish the transaction when the server rejects it", async () => {
    apiRequest.mockImplementation(() =>
      Promise.reject(new Error("400: invalid receipt")),
    );
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.purchase());

    expect(iap.finishTransaction).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });

  it("does not finish the transaction when the server answers 200 with success: false", async () => {
    apiRequest.mockImplementation(() =>
      Promise.resolve(new Response(DECLINED)),
    );
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.purchase());

    expect(iap.finishTransaction).not.toHaveBeenCalled();
    expect(refreshSubscription).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "error",
      error: { code: "STORE_UNAVAILABLE" },
    });
  });

  it("does not finish the transaction when the 200 body is not JSON", async () => {
    apiRequest.mockImplementation(() =>
      Promise.resolve(new Response("<html>proxy</html>")),
    );
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.purchase());

    expect(iap.finishTransaction).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "error",
      error: { code: "UNKNOWN" },
    });
  });
});

describe("usePurchase.refreshProduct", () => {
  it("passes the store's refresh through unchanged", () => {
    const { result } = renderHook(() => usePurchase());

    expect(result.current.refreshProduct).toBe(iap.refreshProducts);
  });
});

describe("usePurchase.restore", () => {
  it("sends the restored token to the server", async () => {
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.restore());

    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/subscription/restore",
      {
        receipt: "eyJ.jws.sig",
        platform: "ios",
      },
    );
    expect(iap.finishTransaction).toHaveBeenCalledWith(PURCHASE);
    expect(result.current.state.status).toBe("success");
  });

  it("does not finish the restored transaction when the server declines it with 200", async () => {
    apiRequest.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ success: false, code: "PURCHASE_NOT_ACTIVE" }),
        ),
      ),
    );
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.restore());

    expect(iap.finishTransaction).not.toHaveBeenCalled();
    expect(refreshSubscription).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "error",
      error: { code: "UNKNOWN" },
    });
  });

  it("says there is nothing to restore when the store has no purchase", async () => {
    iap.restorePurchases.mockResolvedValue(null);
    const { result } = renderHook(() => usePurchase());

    await act(() => result.current.restore());

    expect(apiRequest).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({
      status: "error",
      error: { code: "NOTHING_TO_RESTORE" },
    });
  });
});
