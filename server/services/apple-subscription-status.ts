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

/**
 * Why the FIRST claim of an Apple subscription must be refused, or null when
 * Apple reports it in good standing. A device receipt is a snapshot: one
 * signed before a refund carries no revocationDate, and the refund notice for
 * a purchase we had not stored yet was never recorded (store-notifications.ts).
 * For a transaction with no row, only Apple's current status can tell.
 * Fails closed: no answer, or an answer that does not list the transaction, is
 * STORE_API_ERROR, so the client keeps the transaction and retries.
 */
export async function appleFirstClaimRefusal(
  originalTransactionId: string,
): Promise<string | null> {
  if (STUB_MODE) return null;
  let timer: NodeJS.Timeout | undefined;
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
    return current.status === Status.REVOKED
      ? ErrorCode.TRANSACTION_REVOKED
      : null;
  } catch (err) {
    // An outage, a wrong API key (HTTP 401) or an unknown transaction: every
    // first Apple purchase fails here until it is fixed, so report it. The
    // library's APIException has an empty message; name the status instead.
    const error =
      err instanceof APIException
        ? new Error(
            `Apple subscription status: HTTP ${err.httpStatusCode}, apiError ${err.apiError ?? "none"}`,
          )
        : toError(err);
    log.error({ err: error }, "Apple subscription status check failed");
    reportError(error, "apple-subscription-status");
    return "STORE_API_ERROR";
  } finally {
    clearTimeout(timer);
  }
}
