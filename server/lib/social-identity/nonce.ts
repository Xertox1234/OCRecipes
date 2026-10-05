import crypto from "node:crypto";

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** 32 random bytes, base64url — used for nonces and pending-sign-in tickets. */
export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
