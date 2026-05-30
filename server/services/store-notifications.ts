/**
 * Store server-notification processing (Apple App Store Server Notifications V2;
 * Google RTDN is added alongside). Revoke-class events remove entitlement; all
 * other lifecycle events are informational (grants stay on the client receipt
 * flow). Entitlement is found by the same stable id the receipt flow stores
 * (`transactions.transactionId`), so a refund/revoke can locate the user.
 */
import { OAuth2Client } from "google-auth-library";
import { verifyAppleNotification } from "./receipt-validation";
import { storage } from "../storage";
import { invalidateCache as invalidateTierCache } from "./subscription-tier-cache";
import { createServiceLogger, toError } from "../lib/logger";

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

/** Reused client for verifying Pub/Sub push OIDC tokens. */
const googleOAuthClient = new OAuth2Client();

/** Google RTDN notificationType values that REMOVE entitlement. */
const GOOGLE_REVOKE_TYPES = new Set([
  12, // SUBSCRIPTION_REVOKED
  13, // SUBSCRIPTION_EXPIRED
]);

interface PubSubPushBody {
  message?: { data?: string; messageId?: string };
  subscription?: string;
}

/**
 * Verify a Google Pub/Sub PUSH request's OIDC bearer token. Returns true only
 * for a token signed by Google whose `aud` matches our configured audience and
 * whose `email` matches the configured push service account. Returns false (NOT
 * throws) on any failure so the route answers 401 — a forged push is rejected,
 * not retried.
 */
export async function verifyGooglePushToken(
  authorizationHeader: string | undefined,
): Promise<boolean> {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE;
  const expectedEmail = process.env.GOOGLE_PUBSUB_SA_EMAIL;
  if (!audience || !expectedEmail) {
    log.error("google pub/sub verification not configured — rejecting RTDN");
    return false;
  }
  if (!authorizationHeader?.startsWith("Bearer ")) return false;

  try {
    const ticket = await googleOAuthClient.verifyIdToken({
      idToken: authorizationHeader.slice("Bearer ".length),
      audience,
    });
    const payload = ticket.getPayload();
    return (
      !!payload &&
      payload.email === expectedEmail &&
      payload.email_verified === true
    );
  } catch (err) {
    log.warn({ err: toError(err) }, "google pub/sub oidc verification failed");
    return false;
  }
}

/**
 * Process a (pre-authenticated) Google RTDN Pub/Sub push. Revokes entitlement
 * for revoke-class subscription events; every other type is informational.
 *
 * We deliberately do NOT call the Play Developer API here: each purchaseToken is
 * stored as its own `transactions` row by the receipt flow, so the RTDN's token
 * resolves the owning row directly; the payer guard in
 * `revokeSubscriptionByTransactionId` keeps a re-subscribed user premium, and
 * `resolveEffectiveTier` already downgrades expired-premium at read time.
 */
export async function handleGoogleNotification(
  body: PubSubPushBody,
): Promise<void> {
  const data = body.message?.data;
  if (!data) return; // e.g. a Pub/Sub test publish — nothing to do.

  let decoded: {
    subscriptionNotification?: {
      notificationType?: number;
      purchaseToken?: string;
    };
  };
  try {
    decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch (err) {
    log.warn({ err: toError(err) }, "google rtdn: undecodable message data");
    return;
  }

  const sub = decoded.subscriptionNotification;
  if (sub?.notificationType === undefined || !sub.purchaseToken) {
    log.info(
      "google rtdn: non-subscription or incomplete notification, ignored",
    );
    return;
  }

  if (!GOOGLE_REVOKE_TYPES.has(sub.notificationType)) {
    log.info(
      { type: sub.notificationType },
      "google rtdn: informational, no entitlement change",
    );
    return;
  }

  const result = await storage.revokeSubscriptionByTransactionId(
    sub.purchaseToken,
  );
  if (result) {
    invalidateTierCache(result.userId);
    log.info(
      { type: sub.notificationType, userId: result.userId },
      "google rtdn: entitlement revoke processed",
    );
  } else {
    log.warn(
      { type: sub.notificationType },
      "google rtdn: no matching local transaction",
    );
  }
}
