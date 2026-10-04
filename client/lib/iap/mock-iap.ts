import { MOCK_PRODUCTS } from "./constants";
import type { IAPPurchaseResult, UseIAPResult } from "./types";
import { logger } from "../logger";

function generateMockToken(): string {
  return `mock-receipt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateMockTransactionId(): string {
  return `mock-txn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mockPurchase(productId: string): IAPPurchaseResult {
  return {
    productId,
    transactionId: generateMockTransactionId(),
    purchaseToken: generateMockToken(),
    native: null,
  };
}

// Module-level so its identity is stable, as UseIAPResult requires.
function refreshProducts(): void {
  logger.info("[MockIAP] refreshProducts");
}

export function useIAP(): UseIAPResult {
  return {
    connected: true,
    products: MOCK_PRODUCTS,

    async requestPurchase(product): Promise<IAPPurchaseResult> {
      logger.info(`[MockIAP] requestPurchase: ${product.productId}`);
      await new Promise((resolve) => setTimeout(resolve, 800));

      const result = mockPurchase(product.productId);
      logger.info(`[MockIAP] Purchase completed: ${result.transactionId}`);
      return result;
    },

    async restorePurchases(): Promise<IAPPurchaseResult | null> {
      logger.info("[MockIAP] restorePurchases");
      await new Promise((resolve) => setTimeout(resolve, 800));

      const result = mockPurchase(MOCK_PRODUCTS[0].productId);
      logger.info(`[MockIAP] Restore completed: ${result.transactionId}`);
      return result;
    },

    finishTransaction(purchase: IAPPurchaseResult): Promise<void> {
      logger.info(`[MockIAP] finishTransaction: ${purchase.transactionId}`);
      return Promise.resolve();
    },

    refreshProducts,
  };
}
