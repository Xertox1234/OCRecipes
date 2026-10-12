import crypto from "node:crypto";
import { logger, toError } from "../logger";
import { reportError } from "../error-reporter";
import { decryptToken, loadIdentityKey } from "./token-crypto";

/**
 * Boot-time check that IDENTITY_TOKEN_ENC_KEY can still read the stored Apple
 * refresh tokens. A replaced key passes the 32-byte env check, and the first
 * sign of it used to be a failed revoke at account deletion — by then the old
 * key may be gone. Owner ruling 5 (2026-10-12): keep running and alert; never
 * refuse to start over this.
 */

/** First 8 hex of sha256 over the decoded key — logged each boot so a key change shows in the logs. */
export function identityKeyFingerprint(key: Buffer): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function checkIdentityKey(
  blobs: string[],
  key: Buffer,
): { checked: number; unreadable: number } {
  let unreadable = 0;
  for (const blob of blobs) {
    try {
      // Plaintext is discarded: only whether it decrypts matters here.
      decryptToken(blob, key);
    } catch {
      unreadable++;
    }
  }
  return { checked: blobs.length, unreadable };
}

interface BootCheckDeps {
  raw: string | undefined;
  sample: () => Promise<string[]>;
  report?: (error: unknown, context?: string) => void;
  log?: Pick<typeof logger, "info" | "warn" | "error">;
}

/** Never rejects: every outcome is a log line, and a wrong key also reports. */
export async function runIdentityKeyBootCheck({
  raw,
  sample,
  report = reportError,
  log = logger,
}: BootCheckDeps): Promise<void> {
  // The key is optional (Apple sign-in off) — nothing to check without it.
  if (!raw) return;
  const key = loadIdentityKey(raw);
  const keyFingerprint = identityKeyFingerprint(key);

  let blobs: string[];
  try {
    blobs = await sample();
  } catch (err) {
    log.warn(
      { err: toError(err), keyFingerprint },
      "identity key check: could not run",
    );
    return;
  }

  const { checked, unreadable } = checkIdentityKey(blobs, key);
  if (checked === 0) {
    log.info(
      { keyFingerprint, checked },
      "identity key check: no stored Apple tokens to check",
    );
  } else if (unreadable === 0) {
    log.info({ keyFingerprint, checked }, "identity key check: passed");
  } else {
    log.error(
      { keyFingerprint, checked, unreadable },
      "identity key check: IDENTITY_TOKEN_ENC_KEY cannot read stored Apple tokens",
    );
    report(
      new Error(
        `IDENTITY_TOKEN_ENC_KEY cannot read ${unreadable} of ${checked} stored Apple refresh tokens — was the key replaced?`,
      ),
      "identity-key-boot-check",
    );
  }
}
