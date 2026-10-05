import { SignJWT, importPKCS8 } from "jose";
import type { AppleConfig } from "./config";

const APPLE = "https://appleid.apple.com";
const TIMEOUT_MS = 5000;

export async function buildAppleClientSecret(
  cfg: AppleConfig,
  nowMs = Date.now(),
): Promise<string> {
  const key = await importPKCS8(cfg.privateKey, "ES256");
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setSubject(cfg.bundleId)
    .setAudience(APPLE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(key);
}

async function post(
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
) {
  return fetchImpl(`${APPLE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function exchangeAppleCode(
  code: string,
  cfg: AppleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await post(
    "/auth/token",
    {
      grant_type: "authorization_code",
      code,
      client_id: cfg.bundleId,
      client_secret: await buildAppleClientSecret(cfg),
    },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`Apple token exchange failed: ${res.status}`);
  const body = (await res.json()) as { refresh_token?: unknown };
  if (typeof body.refresh_token !== "string")
    throw new Error("Apple returned no refresh_token");
  return body.refresh_token;
}

export async function revokeAppleToken(
  refreshToken: string,
  cfg: AppleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await post(
    "/auth/revoke",
    {
      client_id: cfg.bundleId,
      client_secret: await buildAppleClientSecret(cfg),
      token: refreshToken,
      token_type_hint: "refresh_token",
    },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`Apple revoke failed: ${res.status}`);
}
