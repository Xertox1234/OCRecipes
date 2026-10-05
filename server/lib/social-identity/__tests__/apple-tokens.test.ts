import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  generateKeyPair,
  exportPKCS8,
  decodeJwt,
  decodeProtectedHeader,
} from "jose";
import {
  buildAppleClientSecret,
  exchangeAppleCode,
  revokeAppleToken,
} from "../apple-tokens";

let cfg: {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
};
beforeAll(async () => {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  cfg = {
    teamId: "TEAM",
    keyId: "KEY",
    privateKey: await exportPKCS8(privateKey),
    bundleId: "com.ocrecipes.app",
  };
});

describe("apple-tokens", () => {
  it("client secret has Apple's required claims", async () => {
    const jwt = await buildAppleClientSecret(cfg, 1_700_000_000_000);
    expect(decodeProtectedHeader(jwt)).toMatchObject({
      alg: "ES256",
      kid: "KEY",
    });
    expect(decodeJwt(jwt)).toMatchObject({
      iss: "TEAM",
      sub: "com.ocrecipes.app",
      aud: "https://appleid.apple.com",
      iat: 1_700_000_000,
      exp: 1_700_000_300,
    });
  });

  it("exchange posts the code and returns the refresh token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ refresh_token: "r1" }), { status: 200 }),
      );
    await expect(exchangeAppleCode("code-1", cfg, fetchImpl)).resolves.toBe(
      "r1",
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://appleid.apple.com/auth/token");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("client_id")).toBe("com.ocrecipes.app");
  });

  it("exchange throws on a non-200 or a missing refresh token", async () => {
    await expect(
      exchangeAppleCode(
        "c",
        cfg,
        vi.fn().mockResolvedValue(new Response("{}", { status: 400 })),
      ),
    ).rejects.toThrow();
    await expect(
      exchangeAppleCode(
        "c",
        cfg,
        vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
      ),
    ).rejects.toThrow();
  });

  it("revoke posts the refresh token with the hint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    await revokeAppleToken("r1", cfg, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    const body = new URLSearchParams(init.body);
    expect(body.get("token")).toBe("r1");
    expect(body.get("token_type_hint")).toBe("refresh_token");
  });

  it("revoke throws on failure", async () => {
    await expect(
      revokeAppleToken(
        "r1",
        cfg,
        vi.fn().mockResolvedValue(new Response("", { status: 500 })),
      ),
    ).rejects.toThrow();
  });
});
