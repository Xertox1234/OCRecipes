/**
 * Store server-notification processing (Apple App Store Server Notifications V2;
 * Google RTDN is added alongside). Revoke-class events remove entitlement;
 * renewal events extend the expiry of an already-claimed subscription; all
 * other lifecycle events are informational (first grants stay on the client
 * receipt flow). Entitlement is found by the same stable id the receipt flow
 * stores (`transactions.transactionId`), so a refund/revoke/renewal can locate
 * the user.
 */
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { verifyAppleNotification, validateReceipt } from "./receipt-validation";
import { storage } from "../storage";
import { invalidateCache as invalidateTierCache } from "./subscription-tier-cache";
import { createServiceLogger, toError } from "../lib/logger";
import { reportError } from "../lib/error-reporter";

const log = createServiceLogger("store-notifications");

/**
 * Apple notification types that REMOVE entitlement. Only a refund/revoke marks
 * the row `revoked` (which refuses receipts purchased before it); an expiry is
 * stored as a plain `expired` row so a re-subscription or late renewal works.
 */
const APPLE_REFUND_TYPES = new Set(["REFUND", "REVOKE"]);
const APPLE_EXPIRY_TYPES = new Set(["EXPIRED", "GRACE_PERIOD_EXPIRED"]);

/**
 * Apple notification types that RENEW an existing subscription. DID_RENEW
 * (incl. subtype BILLING_RECOVERY) carries a new transaction with a new
 * expiresDate; Apple's expiresDate is static per transaction, so without this
 * the server expiry would stop at the first period's end.
 */
const APPLE_RENEW_TYPES = new Set(["DID_RENEW"]);

/**
 * Extend entitlement from a verified renewal. Logs and returns on anything
 * short of a clean extension; never throws for a missing row (the receipt
 * flow may not have stored it yet).
 */
async function applyRenewal(
  source: string,
  transactionId: string,
  expiresAt: Date,
  purchasedAt: Date | undefined,
): Promise<void> {
  const result = await storage.extendSubscriptionByTransactionId(
    transactionId,
    expiresAt,
    purchasedAt,
  );
  if (!result) {
    log.warn({ source }, "renewal notification: no matching local transaction");
    return;
  }
  if (result.status === "revoked") {
    log.warn(
      { source, userId: result.userId },
      "renewal notification for a revoked transaction — not extended",
    );
    return;
  }
  if (result.status === "ownerless") {
    log.info(
      { source },
      "renewal notification for a deleted account's purchase — nothing to extend",
    );
    return;
  }
  invalidateTierCache(result.userId);
  log.info(
    { source, userId: result.userId },
    "renewal notification: entitlement extended",
  );
}

/**
 * Verify + process an Apple App Store Server Notification V2. Revokes
 * entitlement on REFUND/REVOKE, records a plain expiry on EXPIRED /
 * GRACE_PERIOD_EXPIRED, reinstates it on REFUND_REVERSED, extends it on
 * DID_RENEW; every other
 * type is informational
 * (notably DID_CHANGE_RENEWAL_STATUS/AUTO_RENEW_DISABLED, which is NOT a
 * revoke — the sub is active until it actually EXPIRES). Throws when the
 * signature cannot be verified, or when a REFUND/REVOKE matches no local
 * transaction yet; the caller maps either to 5xx and Apple retries.
 */
export async function handleAppleNotification(
  signedPayload: string,
): Promise<void> {
  const n = await verifyAppleNotification(signedPayload);

  if (n.notificationType === "REFUND_REVERSED") {
    // Apple reversed a refund: the signed transaction must exist and no longer
    // carry a revocationDate. Skips the purchase-date gate — the verified
    // notification itself authorizes restoring the row. signedDate is required
    // (fail closed): without it a late retry cannot be ordered against a
    // newer refund on the row.
    if (!n.originalTransactionId || n.revoked !== false || !n.signedAt) {
      log.warn(
        {
          type: n.notificationType,
          uuid: n.notificationUUID,
          revoked: n.revoked,
          hasSignedAt: n.signedAt !== undefined,
        },
        "apple refund-reversed notification lacks an unrevoked transaction or signedDate — not reinstated",
      );
      return;
    }
    const reinstated = await storage.reinstateSubscriptionByTransactionId(
      n.originalTransactionId,
      n.expiresAt ?? null,
      n.signedAt,
    );
    if (!reinstated) {
      log.warn(
        { type: n.notificationType },
        "apple refund-reversed notification: no matching local transaction",
      );
      return;
    }
    if (reinstated.stale) {
      log.warn(
        {
          type: n.notificationType,
          uuid: n.notificationUUID,
          userId: reinstated.userId,
        },
        "apple refund-reversed notification predates the row's refund (out-of-order delivery) — not reinstated",
      );
      return;
    }
    if (reinstated.userId !== null) invalidateTierCache(reinstated.userId);
    log.info(
      { type: n.notificationType, userId: reinstated.userId },
      "apple notification: refund reversed, entitlement reinstated",
    );
    return;
  }

  if (APPLE_RENEW_TYPES.has(n.notificationType)) {
    if (!n.originalTransactionId || !n.expiresAt || n.revoked) {
      log.warn(
        {
          type: n.notificationType,
          subtype: n.subtype,
          uuid: n.notificationUUID,
          revoked: n.revoked,
        },
        "apple renewal notification lacks a usable transaction — not extended",
      );
      return;
    }
    await applyRenewal(
      `apple:${n.notificationType}`,
      n.originalTransactionId,
      n.expiresAt,
      n.purchasedAt,
    );
    return;
  }

  const isRefund = APPLE_REFUND_TYPES.has(n.notificationType);
  if (!isRefund && !APPLE_EXPIRY_TYPES.has(n.notificationType)) {
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

  // Time a refund by the store (Apple revocationDate, else when Apple signed
  // the notification), never by when we processed it.
  const result = isRefund
    ? await storage.revokeSubscriptionByTransactionId(
        n.originalTransactionId,
        n.revokedAt ?? n.signedAt,
      )
    : await storage.expireSubscriptionByTransactionId(n.originalTransactionId);
  if (result && "stale" in result && result.stale) {
    log.warn(
      {
        type: n.notificationType,
        uuid: n.notificationUUID,
        userId: result.userId,
      },
      "apple refund notification is dated at or before a refund already reversed on this row (redelivered) — not revoked",
    );
    return;
  }
  if (result) {
    // An ownerless row (deleted account) still records the refund/expiry.
    if (result.userId !== null) invalidateTierCache(result.userId);
    log.info(
      { type: n.notificationType, userId: result.userId },
      "apple notification: entitlement revoke processed",
    );
    return;
  }
  if (isRefund) {
    // The phone's receipt is a pre-refund snapshot (it carries no
    // revocationDate), so a refund dropped here could never be applied: a
    // later claim of that receipt would grant premium. Throw → 5xx → Apple
    // redelivers over the next hours, by when the receipt flow has stored the
    // row. Apple stops retrying after about 6.5 days; a purchase first claimed
    // after that is caught by appleFirstClaimRefusal, which asks Apple for the
    // current status before the first grant.
    throw new Error(
      `apple refund for an unknown transaction (${n.notificationType}, uuid ${n.notificationUUID ?? "none"}) — retry requested`,
    );
  }
  log.warn(
    { type: n.notificationType },
    "apple expiry notification: no matching local transaction",
  );
}

/** Reused client for verifying Pub/Sub push OIDC tokens. */
const googleOAuthClient = new OAuth2Client();

/** At most one push-verification report per hour (forged pushes can repeat). */
const PUSH_VERIFICATION_ALERT_INTERVAL_MS = 60 * 60 * 1000;
let lastPushVerificationAlertAt = 0;

/**
 * Report a failed Pub/Sub push verification to Sentry, rate-limited. A wrong
 * GOOGLE_PUBSUB_AUDIENCE / GOOGLE_PUBSUB_SA_EMAIL fails EVERY real push, so
 * Play refunds and renewals silently stop applying; one report an hour is
 * enough to see it without letting forged pushes flood Sentry.
 */
function alertPushVerificationFailure(error: Error): void {
  const now = Date.now();
  if (now - lastPushVerificationAlertAt < PUSH_VERIFICATION_ALERT_INTERVAL_MS) {
    return;
  }
  lastPushVerificationAlertAt = now;
  reportError(error, "google-pubsub-oidc");
}

/** Reset the push-verification alert throttle (exported for tests). */
export function resetPushVerificationAlert(): void {
  lastPushVerificationAlertAt = 0;
}

/** Google RTDN notificationType values that REMOVE entitlement. */
const GOOGLE_REVOKED = 12; // SUBSCRIPTION_REVOKED — refund-class, blocks
const GOOGLE_EXPIRED = 13; // SUBSCRIPTION_EXPIRED — plain expiry

/** Google RTDN notificationType values that RENEW an existing subscription. */
const GOOGLE_RENEW_TYPES = new Set([
  1, // SUBSCRIPTION_RECOVERED
  2, // SUBSCRIPTION_RENEWED
]);

/**
 * validateReceipt error codes that must NOT ack a renewal RTDN: a Play outage
 * (STORE_API_ERROR), or a deploy missing Google config / still on the
 * production receipt stub — retrying succeeds once it is fixed.
 */
const GOOGLE_RENEWAL_RETRY_CODES = new Set([
  "STORE_API_ERROR",
  "PLATFORM_NOT_CONFIGURED",
  "NOT_IMPLEMENTED",
]);

/** The decoded RTDN DeveloperNotification fields this handler reads. */
const rtdnPayloadSchema = z.object({
  subscriptionNotification: z
    .object({
      notificationType: z.number().int(),
      purchaseToken: z.string().min(1),
    })
    .optional(),
});

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
    const ok =
      !!payload &&
      payload.email === expectedEmail &&
      payload.email_verified === true;
    if (!ok) {
      log.warn("google pub/sub token is not from the configured push account");
      alertPushVerificationFailure(
        new Error(
          "google pub/sub token is not from the configured push account",
        ),
      );
    }
    return ok;
  } catch (err) {
    const error = toError(err);
    log.warn({ err: error }, "google pub/sub oidc verification failed");
    alertPushVerificationFailure(error);
    return false;
  }
}

/**
 * Process a (pre-authenticated) Google RTDN Pub/Sub push. Revokes entitlement
 * on SUBSCRIPTION_REVOKED, records a plain expiry on SUBSCRIPTION_EXPIRED and
 * extends it for renewals; every
 * other type is informational.
 *
 * Renewals re-read live state from the Play Developer API (the RTDN carries no
 * expiry). Revokes deliberately do NOT call it: each purchaseToken is
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

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch (err) {
    log.warn({ err: toError(err) }, "google rtdn: undecodable message data");
    return;
  }

  const decoded = rtdnPayloadSchema.safeParse(raw);
  const sub = decoded.success
    ? decoded.data.subscriptionNotification
    : undefined;
  if (!sub) {
    log.info(
      "google rtdn: non-subscription or malformed notification, ignored",
    );
    return;
  }

  if (GOOGLE_RENEW_TYPES.has(sub.notificationType)) {
    // The RTDN carries no expiry: re-read live state from the Play API (the
    // same path the receipt flow uses) and extend from that.
    const live = await validateReceipt(sub.purchaseToken, "android");
    if (!live.valid) {
      if (live.errorCode && GOOGLE_RENEWAL_RETRY_CODES.has(live.errorCode)) {
        // Transient (5xx/429/401/403/network/token fetch) or a fixable server
        // misconfiguration: throw so the route answers 5xx and Pub/Sub
        // redelivers. A permanent answer (e.g. PURCHASE_TOKEN_INVALID for a
        // Play 400/404/410) is logged and acked.
        throw new Error(
          `google rtdn renewal: Play state unavailable (${live.errorCode})`,
        );
      }
      log.warn(
        { type: sub.notificationType, errorCode: live.errorCode },
        "google rtdn renewal: subscription not active — not extended",
      );
      return;
    }
    if (!live.expiresAt) {
      log.warn(
        { type: sub.notificationType },
        "google rtdn renewal: Play state has no expiry — not extended",
      );
      return;
    }
    await applyRenewal(
      `google:${sub.notificationType}`,
      sub.purchaseToken,
      live.expiresAt,
      undefined,
    );
    return;
  }

  if (
    sub.notificationType !== GOOGLE_REVOKED &&
    sub.notificationType !== GOOGLE_EXPIRED
  ) {
    log.info(
      { type: sub.notificationType },
      "google rtdn: informational, no entitlement change",
    );
    return;
  }

  const result =
    sub.notificationType === GOOGLE_REVOKED
      ? await storage.revokeSubscriptionByTransactionId(sub.purchaseToken)
      : await storage.expireSubscriptionByTransactionId(sub.purchaseToken);
  if (result) {
    if (result.userId !== null) invalidateTierCache(result.userId);
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
