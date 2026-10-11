import crypto from "node:crypto";
import bcrypt from "bcrypt";

/**
 * bcrypt 6 silently ignores input past 72 bytes. New passwords are condensed
 * to a 44-byte base64 SHA-256 first, so every character counts and no NUL
 * byte reaches bcrypt. The prefix marks the scheme; unprefixed hashes are
 * legacy and verify the old way. Spec §3.
 */
export const PASSWORD_HASH_PREFIX = "pv2$";
const COST = 12;

export function preHash(pw: string): string {
  return crypto
    .createHash("sha256")
    .update(pw.normalize("NFC"), "utf8")
    .digest("base64");
}

export async function hashPassword(pw: string): Promise<string> {
  return PASSWORD_HASH_PREFIX + (await bcrypt.hash(preHash(pw), COST));
}

export function isLegacyHash(hash: string): boolean {
  return !hash.startsWith(PASSWORD_HASH_PREFIX);
}
