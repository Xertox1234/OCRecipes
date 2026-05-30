import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { verifyAppleNotification } from "../receipt-validation";
import { storage } from "../../storage";
import { invalidateCache } from "../subscription-tier-cache";
import {
  handleAppleNotification,
  handleGoogleNotification,
  verifyGooglePushToken,
} from "../store-notifications";

vi.mock("../receipt-validation", () => ({
  verifyAppleNotification: vi.fn(),
}));
vi.mock("../../storage", () => ({
  storage: { revokeSubscriptionByTransactionId: vi.fn() },
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
    );
    expect(invalidateCache).toHaveBeenCalledWith("user-1");
  });

  it("revokes on EXPIRED", async () => {
    vi.mocked(verifyAppleNotification).mockResolvedValue({
      notificationType: "EXPIRED",
      originalTransactionId: "orig-9",
    });
    vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue({
      userId: "user-9",
    });

    await handleAppleNotification("signed-payload");

    expect(storage.revokeSubscriptionByTransactionId).toHaveBeenCalledWith(
      "orig-9",
    );
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
    process.env.GOOGLE_PUBSUB_AUDIENCE = "https://api.ocrecipes.app";
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
      audience: "https://api.ocrecipes.app",
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

  it("revokes on SUBSCRIPTION_EXPIRED (13)", async () => {
    vi.mocked(storage.revokeSubscriptionByTransactionId).mockResolvedValue({
      userId: "user-e",
    });

    await handleGoogleNotification({
      message: { data: rtdnMessage(13, "tok-2") },
    });

    expect(storage.revokeSubscriptionByTransactionId).toHaveBeenCalledWith(
      "tok-2",
    );
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
