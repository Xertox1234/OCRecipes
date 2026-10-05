import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { getSocialConfig } from "../config";

const encKey = crypto.randomBytes(32).toString("base64");
const pem = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";

describe("getSocialConfig", () => {
  it("both providers off with no env", () => {
    expect(getSocialConfig({})).toEqual({ google: null, apple: null });
  });

  it("google needs the web client id AND at least one app client id", () => {
    expect(
      getSocialConfig({ GOOGLE_OAUTH_WEB_CLIENT_ID: "web" }).google,
    ).toBeNull();
    expect(
      getSocialConfig({
        GOOGLE_OAUTH_WEB_CLIENT_ID: "web",
        GOOGLE_OAUTH_APP_CLIENT_IDS: " ios , android ",
      }).google,
    ).toEqual({ webClientId: "web", appClientIds: ["ios", "android"] });
  });

  it("apple needs team, key id, key, bundle id AND the encryption key", () => {
    const env = {
      APPLE_TEAM_ID: "T",
      APPLE_SIGN_IN_KEY_ID: "K",
      APPLE_SIGN_IN_PRIVATE_KEY: pem,
      APPLE_BUNDLE_ID: "com.ocrecipes.app",
    };
    expect(getSocialConfig(env).apple).toBeNull();
    const apple = getSocialConfig({
      ...env,
      IDENTITY_TOKEN_ENC_KEY: encKey,
    }).apple;
    expect(apple?.bundleId).toBe("com.ocrecipes.app");
    expect(apple?.privateKey).toContain("\nabc\n"); // literal \n expanded
  });
});
