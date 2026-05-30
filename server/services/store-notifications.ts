/**
 * Store server-notification processing (Apple App Store Server Notifications V2;
 * Google RTDN is added alongside). Revoke-class events remove entitlement; all
 * other lifecycle events are informational (grants stay on the client receipt
 * flow). Entitlement is found by the same stable id the receipt flow stores
 * (`transactions.transactionId`), so a refund/revoke can locate the user.
 */
import { verifyAppleNotification } from "./receipt-validation";
import { storage } from "../storage";
import { invalidateCache as invalidateTierCache } from "./subscription-tier-cache";
import { createServiceLogger } from "../lib/logger";

const log = createServiceLogger("store-notifications");

/** Apple notification types that REMOVE entitlement (revoke-class). */
const APPLE_REVOKE_TYPES = new Set([
  "REFUND",
  "REVOKE",
  "EXPIRED",
  "GRACE_PERIOD_EXPIRED",
]);

/**
 * Verify + process an Apple App Store Server Notification V2. Revokes
 * entitlement for revoke-class events; every other type is informational
 * (notably DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_DISABLED, which is NOT a
 * revoke — the sub is active until it actually EXPIRES). Throws only when the
 * signature cannot be verified, so the caller maps that to 5xx and Apple retries.
 */
export async function handleAppleNotification(
  signedPayload: string,
): Promise<void> {
  const n = await verifyAppleNotification(signedPayload);

  if (!APPLE_REVOKE_TYPES.has(n.notificationType)) {
    log.info(
      { type: n.notificationType, subtype: n.subtype },
      "apple notification: informational, no entitlement change",
    );
    return;
  }

  if (!n.originalTransactionId) {
    log.warn(
      { type: n.notificationType, uuid: n.notificationUUID },
      "apple revoke notification has no originalTransactionId — cannot revoke",
    );
    return;
  }

  const result = await storage.revokeSubscriptionByTransactionId(
    n.originalTransactionId,
  );
  if (result) {
    invalidateTierCache(result.userId);
    log.info(
      { type: n.notificationType, userId: result.userId },
      "apple notification: entitlement revoke processed",
    );
  } else {
    log.warn(
      { type: n.notificationType },
      "apple revoke notification: no matching local transaction",
    );
  }
}
