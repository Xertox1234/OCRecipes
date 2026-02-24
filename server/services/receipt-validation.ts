import crypto from "crypto";
import fs from "fs";
import path from "path";
import { z } from "zod";
import {
  SignedDataVerifier,
  Environment,
  VerificationException,
  VerificationStatus,
} from "@apple/app-store-server-library";
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import type { Platform } from "@shared/schemas/subscription";

export interface ReceiptValidationResult {
  valid: boolean;
  productId?: string;
  expiresAt?: Date;
  originalTransactionId?: string;
  errorCode?: string;
}

// --- Credential detection ---

const HAS_APPLE_CREDENTIALS = !!(
  process.env.APPLE_ISSUER_ID &&
  process.env.APPLE_KEY_ID &&
  process.env.APPLE_PRIVATE_KEY
);

const HAS_GOOGLE_CREDENTIALS = !!(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY
);

/**
 * Stub mode requires explicit opt-in via RECEIPT_VALIDATION_STUB=true AND
 * no platform credentials configured. This prevents accidental auto-approve
 * in non-production environments.
 */
const STUB_MODE =
  process.env.RECEIPT_VALIDATION_STUB === "true" &&
  !HAS_APPLE_CREDENTIALS &&
  !HAS_GOOGLE_CREDENTIALS;

/** Timeout for outbound API requests to Google (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Validate a purchase receipt from the appropriate platform store.
 *
 * When credentials are not configured for any platform, falls back to stub mode:
 * - Development: auto-approves with a 1-year expiry
 * - Production: rejects with NOT_IMPLEMENTED
 *
 * When credentials are partially configured (e.g. Apple only), requests for
 * the unconfigured platform return PLATFORM_NOT_CONFIGURED.
 */
export async function validateReceipt(
  receipt: string,
  platform: Platform,
  productId?: string,
): Promise<ReceiptValidationResult> {
  if (STUB_MODE) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "Receipt validation is stubbed in production — rejecting. Configure Apple/Google credentials to enable.",
      );
      return { valid: false, errorCode: "NOT_IMPLEMENTED" };
    }
    console.warn("Receipt validation is stubbed — auto-approving in dev.");
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    return { valid: true, expiresAt };
  }

  if (platform === "ios") {
    if (!HAS_APPLE_CREDENTIALS) {
      return { valid: false, errorCode: "PLATFORM_NOT_CONFIGURED" };
    }
    return validateAppleReceipt(receipt, productId);
  }

  if (!HAS_GOOGLE_CREDENTIALS) {
    return { valid: false, errorCode: "PLATFORM_NOT_CONFIGURED" };
  }
  return validateGoogleReceipt(receipt, productId);
}

// --- Apple App Store Server API v2 ---

/** Load Apple root CA certificates from disk. */
function loadAppleRootCAs(): Buffer[] {
  const certDir =
    process.env.APPLE_ROOT_CA_DIR || path.join(__dirname, "..", "certs");
  const certFiles = [
    "AppleRootCA-G2.cer",
    "AppleRootCA-G3.cer",
    "AppleIncRootCertificate.cer",
  ];
  return certFiles.map((file) => fs.readFileSync(path.join(certDir, file)));
}

/** Lazy singleton for the Apple SignedDataVerifier. */
let appleVerifier: SignedDataVerifier | null = null;

function getAppleVerifier(): SignedDataVerifier {
  if (appleVerifier) return appleVerifier;

  const bundleId = process.env.APPLE_BUNDLE_ID;
  if (!bundleId) {
    throw new Error(
      "APPLE_BUNDLE_ID is required when Apple credentials are configured",
    );
  }
  const environment =
    process.env.APPLE_ENVIRONMENT === "production"
      ? Environment.PRODUCTION
      : Environment.SANDBOX;
  const rawAppId = process.env.APPLE_APP_ID;
  const appAppleId = rawAppId ? Number(rawAppId) : undefined;
  if (appAppleId !== undefined && Number.isNaN(appAppleId)) {
    throw new Error("APPLE_APP_ID must be a numeric value");
  }
  const enableOnlineChecks = true;

  appleVerifier = new SignedDataVerifier(
    loadAppleRootCAs(),
    enableOnlineChecks,
    environment,
    bundleId,
    appAppleId,
  );
  return appleVerifier;
}

/** Reset the cached Apple verifier (exported for test isolation). */
export function resetAppleVerifier(): void {
  appleVerifier = null;
}

/** Map Apple VerificationStatus codes to our error codes. */
function mapVerificationError(status: VerificationStatus): string {
  switch (status) {
    case VerificationStatus.INVALID_APP_IDENTIFIER:
      return "BUNDLE_MISMATCH";
    case VerificationStatus.INVALID_ENVIRONMENT:
      return "INVALID_ENVIRONMENT";
    case VerificationStatus.INVALID_CERTIFICATE:
      return "INVALID_CERTIFICATE";
    default:
      return "INVALID_RECEIPT";
  }
}

async function validateAppleReceipt(
  receipt: string,
  expectedProductId?: string,
): Promise<ReceiptValidationResult> {
  let payload: JWSTransactionDecodedPayload;
  try {
    payload = await getAppleVerifier().verifyAndDecodeTransaction(receipt);
  } catch (err) {
    if (err instanceof VerificationException) {
      const errorCode = mapVerificationError(err.status);
      console.error(
        `Apple receipt verification failed: ${VerificationStatus[err.status]}`,
      );
      return { valid: false, errorCode };
    }
    console.error("Apple receipt verification error:", err);
    return { valid: false, errorCode: "INVALID_RECEIPT" };
  }

  if (expectedProductId && payload.productId !== expectedProductId) {
    return { valid: false, errorCode: "PRODUCT_MISMATCH" };
  }

  if (payload.revocationDate) {
    return { valid: false, errorCode: "TRANSACTION_REVOKED" };
  }

  if (payload.expiresDate) {
    const expiresAt = new Date(payload.expiresDate);
    if (expiresAt.getTime() < Date.now()) {
      return { valid: false, errorCode: "SUBSCRIPTION_EXPIRED" };
    }
    return {
      valid: true,
      productId: payload.productId,
      expiresAt,
      originalTransactionId: payload.originalTransactionId,
    };
  }

  // Non-subscription purchase (no expiry) — valid
  return {
    valid: true,
    productId: payload.productId,
    originalTransactionId: payload.originalTransactionId,
  };
}

// --- Google Play Developer API v3 ---

/** Module-level cache for the Google OAuth access token. */
let googleAccessToken: string | null = null;
let googleTokenExpiresAt = 0;

const googleOAuthResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

const googleSubscriptionResponseSchema = z.object({
  subscriptionState: z.string().optional(),
  lineItems: z
    .array(
      z.object({
        productId: z.string().optional(),
        expiryTime: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * Build a JWT for Google service account authentication and exchange it
 * for an OAuth2 access token. Caches the token until expiry.
 */
async function getGoogleAccessToken(): Promise<string> {
  if (googleAccessToken && Date.now() < googleTokenExpiresAt) {
    return googleAccessToken;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const privateKeyPem = process.env.GOOGLE_SERVICE_ACCOUNT_KEY!.replace(
    /\\n/g,
    "\n",
  );

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: email,
    scope: "https://www.googleapis.com/auth/androidpublisher",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url").replace(/=+$/, "");

  const signingInput = `${encode(header)}.${encode(payload)}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  const signature = sign.sign(privateKeyPem, "base64url").replace(/=+$/, "");

  const jwt = `${signingInput}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Google OAuth token exchange failed:", text);
    throw new Error("Failed to obtain Google access token");
  }

  const raw = await response.json();
  const parsed = googleOAuthResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Unexpected Google OAuth response shape:", parsed.error);
    throw new Error("Invalid Google OAuth response");
  }

  // Cache with 5-minute buffer before actual expiry
  googleAccessToken = parsed.data.access_token;
  googleTokenExpiresAt = Date.now() + (parsed.data.expires_in - 300) * 1000;

  return googleAccessToken;
}

/** Reset the cached Google token (exported for testing). */
export function resetGoogleTokenCache(): void {
  googleAccessToken = null;
  googleTokenExpiresAt = 0;
}

async function validateGoogleReceipt(
  purchaseToken: string,
  expectedProductId?: string,
): Promise<ReceiptValidationResult> {
  const packageName = process.env.GOOGLE_PACKAGE_NAME;
  if (!packageName) {
    return { valid: false, errorCode: "PLATFORM_NOT_CONFIGURED" };
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch {
    return { valid: false, errorCode: "STORE_API_ERROR" };
  }

  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("Google Play subscription request failed:", err);
    return { valid: false, errorCode: "STORE_API_ERROR" };
  }

  if (!response.ok) {
    const text = await response.text();
    console.error("Google Play subscription check failed:", text);
    return { valid: false, errorCode: "STORE_API_ERROR" };
  }

  const raw = await response.json();
  const parsed = googleSubscriptionResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("Unexpected Google subscription response:", parsed.error);
    return { valid: false, errorCode: "STORE_API_ERROR" };
  }

  const data = parsed.data;

  const activeStates = [
    "SUBSCRIPTION_STATE_ACTIVE",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
  ];
  if (
    !data.subscriptionState ||
    !activeStates.includes(data.subscriptionState)
  ) {
    if (data.subscriptionState === "SUBSCRIPTION_STATE_EXPIRED") {
      return { valid: false, errorCode: "SUBSCRIPTION_EXPIRED" };
    }
    return { valid: false, errorCode: "PURCHASE_NOT_ACTIVE" };
  }

  const lineItem = data.lineItems?.[0];
  if (expectedProductId && lineItem?.productId !== expectedProductId) {
    return { valid: false, errorCode: "PRODUCT_MISMATCH" };
  }

  const expiresAt = lineItem?.expiryTime
    ? new Date(lineItem.expiryTime)
    : undefined;

  return {
    valid: true,
    productId: lineItem?.productId,
    expiresAt,
  };
}
