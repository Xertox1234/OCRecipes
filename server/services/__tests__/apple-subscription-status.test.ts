import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Environment, Status } from "@apple/app-store-server-library";

const mockGetAllSubscriptionStatuses = vi.fn();
const mockApiClientArgs = vi.fn();

vi.mock("@apple/app-store-server-library", async () => {
  const actual = await vi.importActual<
    typeof import("@apple/app-store-server-library")
  >("@apple/app-store-server-library");
  return {
    ...actual,
    AppStoreServerAPIClient: class MockAppStoreServerAPIClient {
      constructor(...args: unknown[]) {
        mockApiClientArgs(...args);
      }
      getAllSubscriptionStatuses = mockGetAllSubscriptionStatuses;
    },
  };
});

const { mockLog, mockReportError } = vi.hoisted(() => ({
  mockLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  mockReportError: vi.fn(),
}));
vi.mock("../../lib/logger", async () => {
  const actual =
    await vi.importActual<typeof import("../../lib/logger")>(
      "../../lib/logger",
    );
  return { ...actual, createServiceLogger: () => mockLog };
});
vi.mock("../../lib/error-reporter", () => ({
  reportError: mockReportError,
}));

describe("appleFirstClaimRefusal", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.APPLE_ISSUER_ID = "test-issuer";
    process.env.APPLE_KEY_ID = "test-key-id";
    process.env.APPLE_PRIVATE_KEY = "line-one\\nline-two";
    process.env.APPLE_BUNDLE_ID = "com.ocrecipes.app";
    delete process.env.APPLE_ENVIRONMENT;
    mockGetAllSubscriptionStatuses.mockReset();
    mockApiClientArgs.mockReset();
    mockLog.error.mockClear();
    mockReportError.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  async function load() {
    vi.resetModules();
    const mod = await import("../apple-subscription-status");
    return mod.appleFirstClaimRefusal;
  }

  /** A status response holding one other subscription and ours. */
  function statusResponse(status: Status) {
    return {
      data: [
        {
          lastTransactions: [
            { originalTransactionId: "other-txn", status: Status.ACTIVE },
          ],
        },
        { lastTransactions: [{ originalTransactionId: "txn-1", status }] },
      ],
    };
  }

  it("does not refuse a subscription Apple reports as active", async () => {
    mockGetAllSubscriptionStatuses.mockResolvedValue(
      statusResponse(Status.ACTIVE),
    );
    const refusal = await load();

    expect(await refusal("txn-1")).toBeNull();
    expect(mockGetAllSubscriptionStatuses).toHaveBeenCalledWith("txn-1");
  });

  it("refuses a subscription Apple reports as refunded or revoked", async () => {
    mockGetAllSubscriptionStatuses.mockResolvedValue(
      statusResponse(Status.REVOKED),
    );
    const refusal = await load();

    expect(await refusal("txn-1")).toBe("TRANSACTION_REVOKED");
  });

  it("does not refuse a subscription in its billing grace period", async () => {
    mockGetAllSubscriptionStatuses.mockResolvedValue(
      statusResponse(Status.BILLING_GRACE_PERIOD),
    );
    const refusal = await load();

    expect(await refusal("txn-1")).toBeNull();
  });

  // Only an entitled status may pass. The receipt reaching this check is
  // signed as unexpired, so any other answer contradicts it: grant nothing.
  it.each([
    ["expired", Status.EXPIRED],
    ["in billing retry", Status.BILLING_RETRY],
    ["with no status", undefined],
    ["with an unknown status", 99],
  ])(
    "refuses with STORE_API_ERROR a subscription Apple lists as %s",
    async (_label, status) => {
      mockGetAllSubscriptionStatuses.mockResolvedValue(
        statusResponse(status as Status),
      );
      const refusal = await load();

      expect(await refusal("txn-1")).toBe("STORE_API_ERROR");
      expect(mockReportError).toHaveBeenCalledTimes(1);
      expect((mockReportError.mock.calls[0]?.[0] as Error).message).toContain(
        String(status),
      );
    },
  );

  // node-fetch puts the request URL, which ends in the transaction id, in a
  // network failure's message; it must not reach the log or Sentry.
  it("keeps the transaction id out of a network failure's reported message", async () => {
    mockGetAllSubscriptionStatuses.mockRejectedValue(
      Object.assign(
        new Error(
          "request to https://api.storekit.itunes.apple.com/inApps/v1/subscriptions/2000000999888777? failed, reason: socket hang up",
        ),
        { name: "FetchError" },
      ),
    );
    const refusal = await load();

    expect(await refusal("2000000999888777")).toBe("STORE_API_ERROR");
    const reported = mockReportError.mock.calls[0]?.[0] as Error;
    expect(reported.message).not.toContain("2000000999888777");
    expect(reported.message).toContain("FetchError");
    expect(reported.message).toContain("socket hang up");
    expect(reported.stack ?? "").not.toContain("2000000999888777");
    const logged = (mockLog.error.mock.calls[0]?.[0] as { err?: unknown })?.err;
    expect(logged).toBe(reported);
  });

  it("refuses with STORE_API_ERROR and reports one Error when Apple's API fails", async () => {
    mockGetAllSubscriptionStatuses.mockRejectedValue(new Error("HTTP 500"));
    const refusal = await load();

    expect(await refusal("txn-1")).toBe("STORE_API_ERROR");
    const logged = (mockLog.error.mock.calls[0]?.[0] as { err?: unknown })?.err;
    expect(logged).toBeInstanceOf(Error);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls[0]?.[0]).toBe(logged);
  });

  // APIException has an empty message: without this the report says nothing,
  // and a wrong API key (401) looks the same as an outage.
  it("names Apple's HTTP status and error code in the reported error", async () => {
    const refusal = await load();
    const { APIException } = await import("@apple/app-store-server-library");
    mockGetAllSubscriptionStatuses.mockRejectedValue(
      new APIException(404, 4040010, "Transaction id not found."),
    );

    expect(await refusal("txn-1")).toBe("STORE_API_ERROR");
    const reported = mockReportError.mock.calls[0]?.[0] as Error;
    expect(reported.message).toContain("HTTP 404");
    expect(reported.message).toContain("4040010");
    expect(reported.message).not.toContain("txn-1");
  });

  it("refuses with STORE_API_ERROR when the answer does not list the transaction", async () => {
    mockGetAllSubscriptionStatuses.mockResolvedValue({
      data: [
        {
          lastTransactions: [
            { originalTransactionId: "other-txn", status: Status.ACTIVE },
          ],
        },
      ],
    });
    const refusal = await load();

    expect(await refusal("txn-1")).toBe("STORE_API_ERROR");
    expect(mockReportError).toHaveBeenCalledTimes(1);
  });

  it("refuses with STORE_API_ERROR when Apple does not answer within 10 seconds", async () => {
    mockGetAllSubscriptionStatuses.mockReturnValue(new Promise(() => {}));
    const refusal = await load();
    vi.useFakeTimers();

    const pending = refusal("txn-1");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await pending).toBe("STORE_API_ERROR");
  });

  it("builds the API client from the Apple credentials, sandbox unless production is set", async () => {
    mockGetAllSubscriptionStatuses.mockResolvedValue(
      statusResponse(Status.ACTIVE),
    );
    const refusal = await load();
    await refusal("txn-1");

    // "\\n" in the env value becomes a real newline, as for the Google key.
    expect(mockApiClientArgs).toHaveBeenCalledWith(
      "line-one\nline-two",
      "test-key-id",
      "test-issuer",
      "com.ocrecipes.app",
      Environment.SANDBOX,
    );

    process.env.APPLE_ENVIRONMENT = "production";
    mockApiClientArgs.mockReset();
    const refusalProd = await load();
    await refusalProd("txn-1");
    expect(mockApiClientArgs.mock.calls[0]?.[4]).toBe(Environment.PRODUCTION);
  });

  it("does not ask Apple in dev stub mode", async () => {
    delete process.env.APPLE_ISSUER_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    process.env.RECEIPT_VALIDATION_STUB = "true";
    const refusal = await load();

    expect(await refusal("stub-abc")).toBeNull();
    expect(mockGetAllSubscriptionStatuses).not.toHaveBeenCalled();
  });
});
