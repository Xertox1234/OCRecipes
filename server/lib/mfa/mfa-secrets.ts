import crypto from "node:crypto";

export function newChallengeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashChallengeToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(`mfa-challenge:${token}`)
    .digest("hex");
}

export function newTrustKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashTrustKey(key: string): string {
  return crypto.createHash("sha256").update(`mfa-trust:${key}`).digest("hex");
}
