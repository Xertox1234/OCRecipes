import {
  APIException,
  AppStoreServerAPIClient,
  Status,
} from "@apple/app-store-server-library";
import { ErrorCode } from "@shared/constants/error-codes";
import { createServiceLogger, toError } from "../lib/logger";
import { reportError } from "../lib/error-reporter";
import {
  FETCH_TIMEOUT_MS,
  STUB_MODE,
  appleEnvironment,
} from "./receipt-validation";

const log = createServiceLogger("apple-subscription-status");

/** Lazy singleton for the App Store Server API client. */
let appleApiClient: AppStoreServerAPIClient | null = null;

function getAppleApiClient(): AppStoreServerAPIClient {
  if (appleApiClient) return appleApiClient;
  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) {
    throw new Error(
      "APPLE_BUNDLE_ID is required when Apple credentials are configured",
    );
  }
  appleApiClient = new AppStoreServerAPIClient(
    // A "\\n" escape becomes a newline, as for the Google key.
    process.env.APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    process.env.APPLE_KEY_ID!,
    process.env.APPLE_ISSUER_ID!,
    bundleId,
    appleEnvironment(),
  );
  return appleApiClient;
}

/** The statuses that entitle the subscriber: active, or in billing grace. */
const ENTITLED: ReadonlySet<unknown> = new Set([
  Status.ACTIVE,
  Status.BILLING_GRACE_PERIOD,
]);

/**
 * Why a claim of an Apple subscription must be refused, or null when Apple
 * reports it entitled (active or in billing grace). A device receipt is a
 * snapshot: one signed before a refund carries no revocationDate, and the
 * refund notice for a purchase we had not stored yet was never recorded
 * (store-notifications.ts). Where our own row cannot tell — there is none, or
 * it is revoked and the receipt is a re-subscription — only Apple's current
 * status can.
 * Fails closed: no answer, an answer that does not list the transaction, or
 * any status other than entitled or revoked is STORE_API_ERROR, so the client
 * keeps the transaction and retries.
 */
export async function appleFirstClaimRefusal(
  originalTransactionId: string,
): Promise<string | null> {
  if (STUB_MODE) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The library's HTTP call has no timeout of its own.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Apple subscription status timed out")),
        FETCH_TIMEOUT_MS,
      );
    });
    const response = await Promise.race([
      getAppleApiClient().getAllSubscriptionStatuses(originalTransactionId),
      timeout,
    ]);
    const current = (response.data ?? [])
      .flatMap((group) => group.lastTransactions ?? [])
      .find((t) => t.originalTransactionId === originalTransactionId);
    if (!current) {
      throw new Error("Apple subscription status omits the transaction");
    }
    if (current.status === Status.REVOKED) return ErrorCode.TRANSACTION_REVOKED;
    if (ENTITLED.has(current.status)) return null;
    // The receipt that got here is signed as unexpired, so expired, billing
    // retry or a missing status contradicts it. Grant nothing and report it.
    throw new Error(
      `Apple subscription status: unexpected status ${current.status}`,
    );
  } catch (err) {
    // An outage, a wrong API key (HTTP 401) or an unknown transaction: every
    // first Apple purchase fails here until it is fixed, so report it. The
    // library's APIException has an empty message; name the status instead.
    // Any other error is rebuilt without the transaction id: node-fetch puts
    // the request URL, which ends in it, in a network failure's message.
    const cause = toError(err);
    const error =
      err instanceof APIException
        ? new Error(
            `Apple subscription status: HTTP ${err.httpStatusCode}, apiError ${err.apiError ?? "none"}`,
          )
        : new Error(
            `${cause.name}: ${cause.message}`
              .split(originalTransactionId)
              .join("[transaction]"),
          );
    log.error({ err: error }, "Apple subscription status check failed");
    reportError(error, "apple-subscription-status");
    return "STORE_API_ERROR";
  } finally {
    clearTimeout(timer);
  }
}
