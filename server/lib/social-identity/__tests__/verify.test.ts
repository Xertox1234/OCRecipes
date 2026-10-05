import { describe, it, expect, beforeAll } from "vitest";
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from "jose";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  TokenVerificationError,
} from "../verify";
import { sha256Hex } from "../nonce";

const google = {
  webClientId: "web-id",
  appClientIds: ["ios-id", "android-id"],
};
const apple = {
  teamId: "T",
  keyId: "K",
  privateKey: "unused",
  bundleId: "com.ocrecipes.app",
};
const nonce = "raw-nonce";

let goodKey: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherPrivate: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  otherPrivate = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  goodKey = createLocalJWKSet({ keys: [jwk] });
});

async function sign(
  claims: Record<string, unknown>,
  key = privateKey,
  expSeconds = 300,
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(key);
}

const googleClaims = {
  iss: "https://accounts.google.com",
  aud: "web-id",
  azp: "ios-id",
  sub: "g-1",
  email: "Me@Gmail.com",
  email_verified: true,
  nonce: sha256Hex(nonce),
};
const appleClaims = {
  iss: "https://appleid.apple.com",
  aud: "com.ocrecipes.app",
  sub: "a-1",
  email: "x@privaterelay.appleid.com",
  email_verified: "true",
  is_private_email: "true",
  nonce: sha256Hex(nonce),
};

describe("verifyGoogleIdToken", () => {
  it("accepts a good token and normalises claims", async () => {
    const claims = await verifyGoogleIdToken(
      await sign(googleClaims),
      nonce,
      google,
      goodKey,
    );
    expect(claims).toMatchObject({
      provider: "google",
      sub: "g-1",
      email: "me@gmail.com",
      emailVerified: true,
      hostedDomain: null,
    });
  });
  it.each([
    ["bad signature", async () => sign(googleClaims, otherPrivate)],
    [
      "wrong iss",
      async () => sign({ ...googleClaims, iss: "https://evil.example" }),
    ],
    ["wrong aud", async () => sign({ ...googleClaims, aud: "ios-id" })],
    [
      "azp not ours",
      async () => sign({ ...googleClaims, azp: "someone-else" }),
    ],
    ["expired", async () => sign(googleClaims, privateKey, -120)],
    [
      "nonce mismatch",
      async () => sign({ ...googleClaims, nonce: sha256Hex("other") }),
    ],
    ["nonce missing", async () => sign({ ...googleClaims, nonce: undefined })],
  ])("rejects %s", async (_n, make) => {
    await expect(
      verifyGoogleIdToken(await make(), nonce, google, goodKey),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });
});

it("rejects a token with no exp (would never expire)", async () => {
  const noExp = await new SignJWT(googleClaims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .sign(privateKey);
  await expect(
    verifyGoogleIdToken(noExp, nonce, google, goodKey),
  ).rejects.toBeInstanceOf(TokenVerificationError);
});

describe("verifyAppleIdToken", () => {
  it("accepts a good token and parses string booleans", async () => {
    const claims = await verifyAppleIdToken(
      await sign(appleClaims),
      nonce,
      apple,
      goodKey,
    );
    expect(claims).toMatchObject({
      provider: "apple",
      sub: "a-1",
      emailVerified: true,
      isPrivateRelay: true,
    });
  });
  it("tolerates a missing email (repeat sign-in)", async () => {
    const { email: _e, ...noEmail } = appleClaims;
    const claims = await verifyAppleIdToken(
      await sign(noEmail),
      nonce,
      apple,
      goodKey,
    );
    expect(claims.email).toBeNull();
  });
  it.each([
    ["wrong aud", { aud: "com.other.app" }],
    ["wrong iss", { iss: "https://accounts.google.com" }],
    ["nonce mismatch", { nonce: sha256Hex("x") }],
  ])("rejects %s", async (_n, patch) => {
    await expect(
      verifyAppleIdToken(
        await sign({ ...appleClaims, ...patch }),
        nonce,
        apple,
        goodKey,
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });
});
