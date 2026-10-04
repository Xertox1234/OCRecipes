import type { PurchaseError } from "@shared/types/subscription";
import type {
  UpgradeRequest,
  RestoreRequest,
} from "@shared/schemas/subscription";

// expo-iap ErrorCode values (string enum) that decide the outcome on their
// own. Anything else falls back to matching the message.
const STORE_UNAVAILABLE_CODES = new Set([
  "item-unavailable",
  "iap-not-available",
  "billing-unavailable",
  "service-disconnected",
  "not-prepared",
]);

/**
 * The code and message of a store error. expo-iap's purchase listener forwards
 * the native event payload unchanged — a plain { code, message } object, not
 * an Error — so both shapes are read.
 */
function errorParts(
  error: unknown,
): { code: string | null; message: string } | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (
    !(error instanceof Error) &&
    code === undefined &&
    message === undefined
  ) {
    return null;
  }
  return {
    code: typeof code === "string" ? code : null,
    message: typeof message === "string" ? message : "",
  };
}

/** Maps IAP errors to our PurchaseError type: by expo-iap code first, then message. */
export function mapIAPError(error: unknown): PurchaseError {
  const parts = errorParts(error);
  if (parts) {
    const { code } = parts;
    if (code === "user-cancelled") {
      return { code: "USER_CANCELLED", message: "Purchase cancelled" };
    }
    if (code === "network-error") {
      return {
        code: "NETWORK",
        message: "Network error. Check your connection and try again.",
        originalError: error,
      };
    }
    if (code === "already-owned") {
      return {
        code: "ALREADY_OWNED",
        message: "You already own this subscription.",
        originalError: error,
      };
    }
    if (code !== null && STORE_UNAVAILABLE_CODES.has(code)) {
      return {
        code: "STORE_UNAVAILABLE",
        message: "The store is currently unavailable. Try again later.",
        originalError: error,
      };
    }
    if (code === "pending") {
      return {
        code: "PENDING_APPROVAL",
        message: "Your purchase is waiting for approval.",
        originalError: error,
      };
    }

    const msg = parts.message.toLowerCase();

    if (msg.includes("user-cancelled") || msg.includes("user cancelled")) {
      return { code: "USER_CANCELLED", message: "Purchase cancelled" };
    }
    if (msg.includes("network") || msg.includes("timeout")) {
      return {
        code: "NETWORK",
        message: "Network error. Check your connection and try again.",
        originalError: error,
      };
    }
    if (msg.includes("already-owned") || msg.includes("already owned")) {
      return {
        code: "ALREADY_OWNED",
        message: "You already own this subscription.",
        originalError: error,
      };
    }
    if (msg.includes("unavailable") || msg.includes("not available")) {
      return {
        code: "STORE_UNAVAILABLE",
        message: "The store is currently unavailable. Try again later.",
        originalError: error,
      };
    }

    return {
      code: "UNKNOWN",
      message: parts.message || "An unexpected error occurred",
      originalError: error,
    };
  }

  return {
    code: "UNKNOWN",
    message: "An unexpected error occurred",
    originalError: error,
  };
}

/** Returns true if the platform supports IAP. */
export function isSupportedPlatform(os: string): os is "ios" | "android" {
  return os === "ios" || os === "android";
}

/** Builds the upgrade receipt payload to send to the server. */
export function buildReceiptPayload(
  purchase: {
    purchaseToken: string;
    productId: string;
    transactionId: string;
  },
  platform: "ios" | "android",
): UpgradeRequest {
  return {
    receipt: purchase.purchaseToken,
    platform,
    productId: purchase.productId,
    transactionId: purchase.transactionId,
  };
}

/** Builds the restore receipt payload to send to the server. */
export function buildRestorePayload(
  receipt: string,
  platform: "ios" | "android",
): RestoreRequest {
  return { receipt, platform };
}
