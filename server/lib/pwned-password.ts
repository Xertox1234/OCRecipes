import crypto from "node:crypto";
import { createServiceLogger } from "./logger";

const log = createServiceLogger("pwned-password");
export const PWNED_TIMEOUT_MS = 3000;

/**
 * Have I Been Pwned range check (k-anonymity): only the first 5 hex chars of
 * the SHA-1 leave the server. Fails OPEN (spec P2): any error → "unavailable",
 * and the caller accepts the password. Never logs password material.
 */
export async function isBreached(
  pw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | "unavailable"> {
  const hash = crypto
    .createHash("sha1")
    .update(pw.normalize("NFC"), "utf8")
    .digest("hex")
    .toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetchImpl(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true", "User-Agent": "OCRecipes" },
        signal: AbortSignal.timeout(PWNED_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      log.warn({ status: res.status }, "breach check unavailable");
      return "unavailable";
    }
    for (const line of (await res.text()).split(/\r?\n/)) {
      const [s, count] = line.split(":");
      if (s === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch (err) {
    log.warn({ err: (err as Error).name }, "breach check unavailable");
    return "unavailable";
  }
}
