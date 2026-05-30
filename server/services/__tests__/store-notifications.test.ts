import { describe, it, expect, vi, beforeEach } from "vitest";

import { verifyAppleNotification } from "../receipt-validation";
import { storage } from "../../storage";
import { invalidateCache } from "../subscription-tier-cache";
import { handleAppleNotification } from "../store-notifications";

vi.mock("../receipt-validation", () => ({
  verifyAppleNotification: vi.fn(),
}));
vi.mock("../../storage", () => ({
  storage: { revokeSubscriptionByTransactionId: vi.fn() },
}));
vi.mock("../subscription-tier-cache", () => ({
  invalidateCache: vi.fn(),
}));

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
