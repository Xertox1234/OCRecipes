import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  verifyAppleNotification,
  validateReceipt,
} from "../receipt-validation";
import { storage } from "../../storage";
import { invalidateCache } from "../subscription-tier-cache";
import {
  handleAppleNotification,
  handleGoogleNotification,
  verifyGooglePushToken,
} from "../store-notifications";

vi.mock("../receipt-validation", () => ({
  verifyAppleNotification: vi.fn(),
  validateReceipt: vi.fn(),
}));
vi.mock("../../storage", () => ({
  storage: {
    revokeSubscriptionByTransactionId: vi.fn(),
    expireSubscriptionByTransactionId: vi.fn(),
    extendSubscriptionByTransactionId: vi.fn(),
  },
}));
vi.mock("../subscription-tier-cache", () => ({
  invalidateCache: vi.fn(),
}));
const { mockVerifyIdToken } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
}));
vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = mockVerifyIdToken;
  },
}));

/** base64-encode a Google RTDN DeveloperNotification for the Pub/Sub envelope. */
function rtdnMessage(notificationType: number, purchaseToken: string): string {
  return Buffer.from(
    JSON.stringify({
      subscriptionNotification: { notificationType, purchaseToken },
    }),
  ).toString("base64");
}

describe("handleAppleNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes entitlement on a REFUND, keyed by the receipt's originalTransactionId", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "REFUND",
      originalTransactionId: "orig-123",
    });
    vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue({
      userId: "user-1",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.revokeSubscriptionByTransactionId).toHaveBeenCalledWith(
      "orig-123",
      undefined,
    );
    expect(invalidateCache).toHaveBeenCalledWith("user-1");
  });

  it.each(["REFUND", "REVOKE"])(
    "times a %s by the store's revocationDate",
    async (notificationType) => {
      const revokedAt = new Date(Date.now() - 60 * 60 * 1000);
      vi.mocked(verifyAppleNotification).mockResolvedValue({
        notificationType,
        originalTransactionId: "orig-123",
        revokedAt,
        signedAt: new Date(),
      });
      vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue({
        userId: "user-1",
      });

      await handleAppleNotification("signed-payload");

      expect(storage.revokeSubscriptionByTransactionId).toHaveBeenCalledWith(
        "orig-123",
        revokedAt,
      );
    },
  );

  it("falls back to the notification's signedDate when the transaction has no revocationDate", async () => {
    const signedAt = new Date(Date.now() - 60 * 1000);
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "REFUND",
      originalTransactionId: "orig-123",
      signedAt,
    });
    vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue({
      userId: "user-1",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.revokeSubscriptionByTransactionId).toHaveBeenCalledWith(
      "orig-123",
      signedAt,
    );
  });

  it.each(["EXPIRED", "GRACE_PERIOD_EXPIRED"])(
    "stores %s as a plain expiry, not a revoke",
    async (notificationType) => {
      vi.mocked(verifyAppleNotification).mockResolvedValue({
        notificationType,
        originalTransactionId: "orig-9",
        signedAt: new Date(),
      });
      vi.mocked(storage.expireSubscriptionByTransactionId).mockResolvedValue({
        userId: "user-9",
      });

      await handleAppleNotification("signed-payload");

      expect(storage.expireSubscriptionByTransactionId).toHaveBeenCalledWith(
        "orig-9",
      );
      expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
      expect(invalidateCache).toHaveBeenCalledWith("user-9");
    },
  );

  it("does not invalidate the cache when an expiry matches no local transaction", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "EXPIRED",
      originalTransactionId: "orig-unknown",
    });
    vi.mocked(storage.expireSubscriptionByTransactionId).mockResolvedValue(
      null,
    );

    await handleAppleNotification("signed-payload");

    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("no-ops an expiry that carries no originalTransactionId", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "EXPIRED",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.expireSubscriptionByTransactionId).not.toHaveBeenCalled();
    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
  });

  it("does NOT revoke on an informational notification (AUTO_RENEW_DISABLED)", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "DID_CHANGE_RENEWAL_STATUS",
      subtype: "AUTO_RENEW_DISABLED",
      originalTransactionId: "orig-123",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("no-ops a revoke-class notification that carries no originalTransactionId", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "REFUND",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
  });

  it("does not invalidate the cache when no local transaction matches", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "REFUND",
      originalTransactionId: "orig-unknown",
    });
    vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue(
      null,
    );

    await handleAppleNotification("signed-payload");

    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("propagates a signature-verification error (caller maps to 5xx so Apple retries)", async () => {
    vi.mocked(verifyAppleNotification).mockRejectedValue(
      new Error("bad signature"),
    );

    await expect(handleAppleNotification("forged")).rejects.toThrow();
    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
  });
});

describe("verifyGooglePushToken", () => {
  const OLD_AUD = process.env.GOOGLE_PUBSUB_AUDIENCE;
  const OLD_EMAIL = process.env.GOOGLE_PUBSUB_SA_EMAIL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_PUBSUB_AUDIENCE = "https://api.ocrecipes.com";
    process.env.GOOGLE_PUBSUB_SA_EMAIL =
      "pubsub@ocrecipes.iam.gserviceaccount.com";
  });

  afterEach(() => {
    process.env.GOOGLE_PUBSUB_AUDIENCE = OLD_AUD;
    process.env.GOOGLE_PUBSUB_SA_EMAIL = OLD_EMAIL;
  });

  it("accepts a token signed by the configured service account for our audience", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        email: "pubsub@ocrecipes.iam.gserviceaccount.com",
        email_verified: true,
      }),
    });

    await expect(verifyGooglePushToken("Bearer good-token")).resolves.toBe(
      true,
    );
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: "good-token",
      audience: "https://api.ocrecipes.com",
    });
  });

  it("rejects a token from a different service account (anti-spoof)", async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: "attacker@evil.com", email_verified: true }),
    });

    await expect(verifyGooglePushToken("Bearer x")).resolves.toBe(false);
  });

  it("rejects a token that fails signature verification", async () => {
    mockVerifyIdToken.mockRejectedValue(new Error("invalid signature"));

    await expect(verifyGooglePushToken("Bearer forged")).resolves.toBe(false);
  });

  it("rejects a missing / non-Bearer Authorization header", async () => {
    await expect(verifyGooglePushToken(undefined)).resolves.toBe(false);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects when push verification is not configured", async () => {
    delete process.env.GOOGLE_PUBSUB_AUDIENCE;
    await expect(verifyGooglePushToken("Bearer good-token")).resolves.toBe(
      false,
    );
  });
});

describe("handleGoogleNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes on SUBSCRIPTION_REVOKED (12), keyed by purchaseToken", async () => {
    vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue({
      userId: "user-g",
    });

    await handleGoogleNotification({
      message: { data: rtdnMessage(12, "tok-1") },
    });

    expect(storage.revokeSubscriptionByTransactionId).toHaveBeenCalledWith(
      "tok-1",
    );
    expect(invalidateCache).toHaveBeenCalledWith("user-g");
  });

  it("stores SUBSCRIPTION_EXPIRED (13) as a plain expiry, not a revoke", async () => {
    vi.mocked(storage.expireSubscriptionByTransactionId).mockResolvedValue({
      userId: "user-e",
    });

    await handleGoogleNotification({
      message: { data: rtdnMessage(13, "tok-2") },
    });

    expect(storage.expireSubscriptionByTransactionId).toHaveBeenCalledWith(
      "tok-2",
    );
    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
    expect(invalidateCache).toHaveBeenCalledWith("user-e");
  });

  it("does not invalidate the cache when an expiry matches no local transaction", async () => {
    vi.mocked(storage.expireSubscriptionByTransactionId).mockResolvedValue(
      null,
    );

    await handleGoogleNotification({
      message: { data: rtdnMessage(13, "tok-unknown") },
    });

    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("does NOT revoke on SUBSCRIPTION_CANCELED (3) — active until expiry", async () => {
    await handleGoogleNotification({
      message: { data: rtdnMessage(3, "tok-3") },
    });

    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
  });

  it("ignores a Pub/Sub envelope with no message data", async () => {
    await handleGoogleNotification({});

    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
  });

  it("does not invalidate the cache when no local transaction matches", async () => {
    vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue(
      null,
    );

    await handleGoogleNotification({
      message: { data: rtdnMessage(12, "tok-unknown") },
    });

    expect(invalidateCache).not.toHaveBeenCalled();
  });
});

describe("handleAppleNotification renewals", () => {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const purchasedAt = new Date();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extends entitlement on DID_RENEW from the verified transaction's expiry", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "DID_RENEW",
      originalTransactionId: "orig-r1",
      expiresAt,
      purchasedAt,
      revoked: false,
    });
    vi.mocked(storage.extendSubscriptionByTransactionId).mockResolvedValue({
      status: "extended",
      userId: "user-r1",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.extendSubscriptionByTransactionId).toHaveBeenCalledWith(
      "orig-r1",
      expiresAt,
      purchasedAt,
    );
    expect(invalidateCache).toHaveBeenCalledWith("user-r1");
    expect(storage.revokeSubscriptionByTransactionId).not.toHaveBeenCalled();
  });

  it("extends on a DID_RENEW BILLING_RECOVERY too", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "DID_RENEW",
      subtype: "BILLING_RECOVERY",
      originalTransactionId: "orig-r2",
      expiresAt,
      purchasedAt,
      revoked: false,
    });
    vi.mocked(storage.extendSubscriptionByTransactionId).mockResolvedValue({
      status: "extended",
      userId: "user-r2",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.extendSubscriptionByTransactionId).toHaveBeenCalledWith(
      "orig-r2",
      expiresAt,
      purchasedAt,
    );
  });

  it("does not invalidate the cache when the row is revoked or unknown", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "DID_RENEW",
      originalTransactionId: "orig-r3",
      expiresAt,
      purchasedAt,
      revoked: false,
    });
    vi.mocked(storage.extendSubscriptionByTransactionId)
      .mockResolvedValueOnce({ status: "revoked", userId: "user-r3" })
      .mockResolvedValueOnce(null);

    await handleAppleNotification("signed-payload");
    await handleAppleNotification("signed-payload");

    expect(storage.extendSubscriptionByTransactionId).toHaveBeenCalledTimes(2);
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it.each([
    ["a revoked transaction", { revoked: true }],
    ["no expiry", { expiresAt: undefined }],
    ["no originalTransactionId", { originalTransactionId: undefined }],
  ])("does not extend a DID_RENEW with %s", async (_label, override) => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "DID_RENEW",
      originalTransactionId: "orig-r4",
      expiresAt,
      purchasedAt,
      revoked: false,
      ...override,
    });

    await handleAppleNotification("signed-payload");

    expect(storage.extendSubscriptionByTransactionId).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it.each([
    "SUBSCRIBED",
    "DID_CHANGE_RENEWAL_PREF",
    "DID_CHANGE_RENEWAL_STATUS",
  ])("does not extend on %s (not a renewal)", async (notificationType) => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType,
      originalTransactionId: "orig-r5",
      expiresAt,
      purchasedAt,
      revoked: false,
    });

    await handleAppleNotification("signed-payload");

    expect(storage.extendSubscriptionByTransactionId).not.toHaveBeenCalled();
  });
});

describe("handleGoogleNotification renewals", () => {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [2, "SUBSCRIPTION_RENEWED"],
    [1, "SUBSCRIPTION_RECOVERED"],
  ])("re-reads live Play state and extends on %i (%s)", async (type) => {
    vi.mocked(validateReceipt).mockResolvedValue({
      valid: true,
      expiresAt,
      originalTransactionId: "tok-r",
    });
    vi.mocked(storage.extendSubscriptionByTransactionId).mockResolvedValue({
      status: "extended",
      userId: "user-gr",
    });

    await handleGoogleNotification({
      message: { data: rtdnMessage(type, "tok-r") },
    });

    expect(validateReceipt).toHaveBeenCalledWith("tok-r", "android");
    expect(storage.extendSubscriptionByTransactionId).toHaveBeenCalledWith(
      "tok-r",
      expiresAt,
      undefined,
    );
    expect(invalidateCache).toHaveBeenCalledWith("user-gr");
  });

  it("throws on a transient Play API failure so Pub/Sub redelivers", async () => {
    vi.mocked(validateReceipt).mockResolvedValue({
      valid: false,
      errorCode: "STORE_API_ERROR",
    });

    await expect(
      handleGoogleNotification({ message: { data: rtdnMessage(2, "tok-t") } }),
    ).rejects.toThrow();
    expect(storage.extendSubscriptionByTransactionId).not.toHaveBeenCalled();
  });

  it("does not extend (or throw) when Play says the subscription is not active", async () => {
    vi.mocked(validateReceipt).mockResolvedValue({
      valid: false,
      errorCode: "SUBSCRIPTION_EXPIRED",
    });

    await handleGoogleNotification({
      message: { data: rtdnMessage(2, "tok-x") },
    });

    expect(storage.extendSubscriptionByTransactionId).not.toHaveBeenCalled();
    expect(invalidateCache).not.toHaveBeenCalled();
  });

  it("does not extend when Play returns no expiry", async () => {
    vi.mocked(validateReceipt).mockResolvedValue({
      valid: true,
      originalTransactionId: "tok-n",
    });

    await handleGoogleNotification({
      message: { data: rtdnMessage(2, "tok-n") },
    });

    expect(storage.extendSubscriptionByTransactionId).not.toHaveBeenCalled();
  });

  it("does not call the Play API for a non-renewal type (SUBSCRIPTION_CANCELED)", async () => {
    await handleGoogleNotification({
      message: { data: rtdnMessage(3, "tok-c") },
    });

    expect(validateReceipt).not.toHaveBeenCalled();
  });
});
