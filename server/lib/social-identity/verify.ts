import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type { AppleConfig, GoogleConfig } from "./config";
import { normaliseEmail } from "./linking-policy";
import { sha256Hex } from "./nonce";
import type { ProviderClaims } from "./types";

export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenVerificationError";
  }
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function verifyJwt(
  idToken: string,
  getKey: JWTVerifyGetKey,
  issuer: string | string[],
  audience: string,
): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(idToken, getKey, {
      issuer,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 60,
      // jwtVerify only checks exp when present; a token without one would
      // never expire.
      requiredClaims: ["exp", "sub"],
    });
    return payload;
  } catch (err) {
    throw new TokenVerificationError(
      err instanceof Error ? err.message : "invalid token",
    );
  }
}

function checkNonce(payload: JWTPayload, nonce: string): void {
  if (payload.nonce !== sha256Hex(nonce)) {
    throw new TokenVerificationError("nonce mismatch");
  }
}

function requireSub(payload: JWTPayload): string {
  if (!payload.sub) throw new TokenVerificationError("missing sub");
  return payload.sub;
}

export async function verifyGoogleIdToken(
  idToken: string,
  nonce: string,
  cfg: GoogleConfig,
  getKey: JWTVerifyGetKey = GOOGLE_JWKS,
): Promise<ProviderClaims> {
  const payload = await verifyJwt(
    idToken,
    getKey,
    ["accounts.google.com", "https://accounts.google.com"],
    cfg.webClientId,
  );
  if (
    typeof payload.azp !== "string" ||
    !cfg.appClientIds.includes(payload.azp)
  ) {
    throw new TokenVerificationError("azp not an OCRecipes app client");
  }
  checkNonce(payload, nonce);
  const email = str(payload.email);
  return {
    provider: "google",
    sub: requireSub(payload),
    email: email ? normaliseEmail(email) : null,
    emailVerified: bool(payload.email_verified),
    hostedDomain: str(payload.hd),
    isPrivateRelay: false,
    nonce: str(payload.nonce),
  };
}

export async function verifyAppleIdToken(
  idToken: string,
  nonce: string,
  cfg: AppleConfig,
  getKey: JWTVerifyGetKey = APPLE_JWKS,
): Promise<ProviderClaims> {
  const payload = await verifyJwt(
    idToken,
    getKey,
    "https://appleid.apple.com",
    cfg.bundleId,
  );
  checkNonce(payload, nonce);
  const email = str(payload.email);
  return {
    provider: "apple",
    sub: requireSub(payload),
    email: email ? normaliseEmail(email) : null,
    emailVerified: bool(payload.email_verified),
    hostedDomain: null,
    isPrivateRelay: bool(payload.is_private_email),
    nonce: str(payload.nonce),
  };
}
