// The real store path: implements the app's UseIAPResult on top of expo-iap
// 3.x. Loaded only outside __DEV__ (see ./index.ts), because importing
// expo-iap loads its native module. TypeScript checks this module against
// UseIAPResult, which the old direct `useIAP` assignment never did.
import { useEffect, useRef, useState } from "react";
import {
  getAvailablePurchases,
  isEligibleForIntroOfferIOS,
  restorePurchases as restoreStorePurchases,
  useIAP,
} from "expo-iap";
import type { ProductSubscription, Purchase } from "expo-iap";
import { logger } from "../logger";
import { PRODUCT_IDS } from "./constants";
import {
  toIAPProductAndroid,
  toIAPProductIOS,
  toPurchaseResult,
} from "./product-mapping";
import type { IAPProduct, IAPPurchaseResult, UseIAPResult } from "./types";

const SKU = PRODUCT_IDS.ANNUAL_PREMIUM;

interface PendingPurchase {
  resolve: (result: IAPPurchaseResult) => void;
  reject: (error: unknown) => void;
}

function storeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

async function resolveProduct(
  subscription: ProductSubscription,
): Promise<IAPProduct | null> {
  if (subscription.platform === "android") {
    return toIAPProductAndroid(subscription);
  }
  const info = subscription.subscriptionInfoIOS;
  let eligible = false;
  if (info?.introductoryOffer) {
    try {
      eligible = await isEligibleForIntroOfferIOS(info.subscriptionGroupId);
    } catch (error) {
      // Unknown eligibility: never promise a free trial the store may not give.
      logger.warn("Intro offer eligibility check failed:", error);
    }
  }
  return toIAPProductIOS(subscription, eligible);
}

function newestOurs(purchases: Purchase[]): Purchase[] {
  return purchases
    .filter(
      (purchase) =>
        purchase.productId === SKU && purchase.purchaseState === "purchased",
    )
    .sort((a, b) => b.transactionDate - a.transactionDate);
}

export function useExpoIAP(): UseIAPResult {
  const pending = useRef<PendingPurchase | null>(null);
  // A purchase the store delivered with nothing waiting for it: StoreKit
  // redelivers an unfinished transaction on connect, e.g. when the user was
  // charged but the server never confirmed it. Restore hands it over first.
  const unclaimed = useRef<IAPPurchaseResult | null>(null);
  const [products, setProducts] = useState<IAPProduct[]>([]);

  const settle = (
    outcome: { result: IAPPurchaseResult } | { error: unknown },
  ) => {
    const waiting = pending.current;
    pending.current = null;
    if (!waiting) return false;
    if ("result" in outcome) waiting.resolve(outcome.result);
    else waiting.reject(outcome.error);
    return true;
  };

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      if (purchase.productId !== SKU) return;
      if (purchase.purchaseState === "pending") {
        settle({
          error: storeError("pending", "Purchase is waiting for approval"),
        });
        return;
      }
      const result = toPurchaseResult(purchase);
      if (!result) {
        settle({
          error: storeError("unknown", "The store returned no purchase token"),
        });
        return;
      }
      if (!settle({ result })) {
        logger.warn(
          "Store delivered a purchase with none pending; kept for restore",
        );
        unclaimed.current = result;
      }
    },
    onPurchaseError: (error) => {
      settle({ error });
    },
  });

  const { connected, fetchProducts, subscriptions } = iap;

  useEffect(() => {
    if (!connected) return;
    fetchProducts({ skus: [SKU], type: "subs" }).catch((error: unknown) => {
      logger.error("Failed to load the subscription from the store:", error);
    });
  }, [connected, fetchProducts]);

  useEffect(() => {
    const subscription = subscriptions.find((item) => item.id === SKU);
    if (!subscription) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    void resolveProduct(subscription).then((product) => {
      if (!cancelled) setProducts(product ? [product] : []);
    });
    return () => {
      cancelled = true;
    };
  }, [subscriptions]);

  return {
    connected,
    products,

    requestPurchase(product) {
      return new Promise<IAPPurchaseResult>((resolve, reject) => {
        if (pending.current) {
          reject(storeError("unknown", "A purchase is already in progress"));
          return;
        }
        pending.current = { resolve, reject };
        const google = product.androidOfferToken
          ? {
              skus: [product.productId],
              subscriptionOffers: [
                {
                  sku: product.productId,
                  offerToken: product.androidOfferToken,
                },
              ],
            }
          : { skus: [product.productId] };
        iap
          .requestPurchase({
            type: "subs",
            request: { apple: { sku: product.productId }, google },
          })
          .catch((error: unknown) => {
            settle({ error });
          });
      });
    },

    async restorePurchases() {
      if (unclaimed.current) {
        const result = unclaimed.current;
        unclaimed.current = null;
        return result;
      }
      await restoreStorePurchases();
      const purchases = await getAvailablePurchases();
      for (const purchase of newestOurs(purchases)) {
        const result = toPurchaseResult(purchase);
        if (result) return result;
      }
      return null;
    },

    async finishTransaction(result) {
      await iap.finishTransaction({
        purchase: result.native as Purchase,
        isConsumable: false,
      });
    },
  };
}
