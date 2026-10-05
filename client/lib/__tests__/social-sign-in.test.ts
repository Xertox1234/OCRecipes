import { describe, it, expect, vi, beforeEach } from "vitest";

import { getProviderToken, NATIVE_PROVIDERS } from "../social-sign-in";

const { mockSignInAsync } = vi.hoisted(() => ({ mockSignInAsync: vi.fn() }));
vi.mock("expo-apple-authentication", () => ({
  signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

beforeEach(() => {
  mockSignInAsync.mockReset();
});

describe("getProviderToken (apple)", () => {
  it("passes the nonce HASH to Apple and returns token, code and name", async () => {
    mockSignInAsync.mockResolvedValue({
      identityToken: "id-tok",
      authorizationCode: "code-1",
      fullName: { givenName: "Ann", familyName: null },
    });
    await expect(getProviderToken("apple", "hash-1")).resolves.toEqual({
      idToken: "id-tok",
      authorizationCode: "code-1",
      fullName: { givenName: "Ann", familyName: null },
    });
    expect(mockSignInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: "hash-1" }),
    );
  });

  it("returns null when the person cancels", async () => {
    mockSignInAsync.mockImplementation(async () => {
      throw Object.assign(new Error("canceled"), {
        code: "ERR_REQUEST_CANCELED",
      });
    });
    await expect(getProviderToken("apple", "h")).resolves.toBeNull();
  });

  it("throws other Apple errors", async () => {
    mockSignInAsync.mockImplementation(async () => {
      throw new Error("boom");
    });
    await expect(getProviderToken("apple", "h")).rejects.toThrow("boom");
  });

  it("throws when Apple returns no identity token", async () => {
    mockSignInAsync.mockResolvedValue({ identityToken: null });
    await expect(getProviderToken("apple", "h")).rejects.toThrow();
  });
});

describe("Google (not shipped yet — owner ruling 2026-10-05)", () => {
  it("is not a native provider in this build", () => {
    expect(NATIVE_PROVIDERS).toEqual({ apple: true, google: false });
  });
  it("getProviderToken refuses google", async () => {
    await expect(getProviderToken("google", "h")).rejects.toThrow(
      /not available/i,
    );
  });
});
