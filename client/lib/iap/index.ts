import type { UseIAPResult } from "./types";

/**
 * IAP factory module.
 * In dev (__DEV__), uses a mock that simulates purchases in-memory.
 * In production native builds, delegates to expo-iap.
 */

// Re-export shared types used by consumers
export type { IAPProduct, IAPPurchaseResult, UseIAPResult } from "./types";
export { PRODUCT_IDS, MOCK_PRODUCTS } from "./constants";

/**
 * Use mock IAP in development; real IAP only works on native store builds.
 * This is evaluated at module load time via Metro's __DEV__ global.
 */
const USE_MOCK = __DEV__;

let _useIAP: () => UseIAPResult;

if (USE_MOCK) {
  // Static import for mock — always bundled in dev
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mock = require("./mock-iap");
  _useIAP = mock.useIAP;
} else {
  // Real store path — only resolved in production native builds. The adapter
  // implements UseIAPResult on top of expo-iap, so TypeScript checks the shape
  // (assigning expo-iap's own useIAP here never was checked, and didn't match).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const adapter: typeof import("./expo-iap-adapter") = require("./expo-iap-adapter");
  _useIAP = adapter.useExpoIAP;
}

export const useIAP: () => UseIAPResult = _useIAP;
