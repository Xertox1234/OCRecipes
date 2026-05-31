import { MOCK_PRODUCTS } from "./constants";
import type { IAPPurchaseResult, UseIAPResult } from "./types";
import { logger } from "../logger";

function generateMockReceipt(): string {
  return `mock-receipt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateMockTransactionId(): string {
  return `mock-txn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useIAP(): UseIAPResult {
  return {
    connected: true,
    products: MOCK_PRODUCTS,

    async requestPurchase(productId: string): Promise<IAPPurchaseResult> {
      logger.info(`[MockIAP] requestPurchase: ${productId}`);
      await new Promise((resolve) => setTimeout(resolve, 800));

      const result: IAPPurchaseResult = {
        productId,
        transactionId: generateMockTransactionId(),
        transactionReceipt: generateMockReceipt(),
      };
      logger.info(`[MockIAP] Purchase completed: ${result.transactionId}`);
      return result;
    },

    async restorePurchases(): Promise<IAPPurchaseResult> {
      logger.info("[MockIAP] restorePurchases");
      await new Promise((resolve) => setTimeout(resolve, 800));

      const result: IAPPurchaseResult = {
        productId: MOCK_PRODUCTS[0].productId,
        transactionId: generateMockTransactionId(),
        transactionReceipt: generateMockReceipt(),
      };
      logger.info(`[MockIAP] Restore completed: ${result.transactionId}`);
      return result;
    },

    finishTransaction(purchase: IAPPurchaseResult): Promise<void> {
      logger.info(`[MockIAP] finishTransaction: ${purchase.transactionId}`);
      return Promise.resolve();
    },
  };
}
