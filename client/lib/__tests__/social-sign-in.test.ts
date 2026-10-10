import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  getProviderToken,
  isGoogleAvailable,
  NATIVE_PROVIDERS,
} from "../social-sign-in";
import { socialSignInErrorMessage } from "../social-auth-utils";
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from "@/constants/google-oauth";

const { mockSignInAsync } = vi.hoisted(() => ({ mockSignInAsync: vi.fn() }));
vi.mock("expo-apple-authentication", () => ({
  signInAsync: (...args: unknown[]) => mockSignInAsync(...args),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

const { mockGoogleSignIn, mockReportError } = vi.hoisted(() => ({
  mockGoogleSignIn: vi.fn(),
  mockReportError: vi.fn(),
}));
vi.mock("../../../modules/google-sign-in", () => ({
  signIn: (...args: unknown[]) => mockGoogleSignIn(...args),
}));
vi.mock("../reporter", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

beforeEach(() => {
  mockSignInAsync.mockReset();
  mockGoogleSignIn.mockReset();
  mockReportError.mockReset();
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

describe("getProviderToken (google)", () => {
  it("passes the nonce HASH verbatim and both client IDs", async () => {
    mockGoogleSignIn.mockResolvedValue({
      idToken: "g-tok",
      email: "a@gmail.com",
    });
    await expect(getProviderToken("google", "hash-9")).resolves.toEqual({
      idToken: "g-tok",
    });
    expect(mockGoogleSignIn).toHaveBeenCalledWith({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: GOOGLE_IOS_CLIENT_ID,
      nonce: "hash-9",
    });
  });

  it("returns null when the person cancels, and reports nothing", async () => {
    mockGoogleSignIn.mockResolvedValue(null);
    await expect(getProviderToken("google", "h")).resolves.toBeNull();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("reports a failure with its code and rethrows it", async () => {
    const err = Object.assign(new Error("no acct"), { code: "NO_ACCOUNT" });
    mockGoogleSignIn.mockRejectedValue(err);
    await expect(getProviderToken("google", "h")).rejects.toBe(err);
    expect(mockReportError).toHaveBeenCalledWith(
      err,
      "google-sign-in:NO_ACCOUNT",
    );
  });

  it("shows the generic sign-in message for a native failure", () => {
    const err = Object.assign(new Error("x"), { code: "PLAY_SERVICES" });
    expect(socialSignInErrorMessage(err)).toBe(
      "Sign-in didn't work. Please try again.",
    );
  });
});

describe("isGoogleAvailable", () => {
  it.each([
    ["ios", "web", "ios", true],
    ["ios", "web", "", false],
    ["ios", "", "ios", false],
    ["android", "web", "", true],
    ["android", "", "", false],
    ["web", "web", "ios", false],
  ])("%s web=%j ios=%j → %s", (os, web, ios, expected) => {
    expect(isGoogleAvailable(os, web, ios)).toBe(expected);
  });

  it("is on in this build (iOS test platform, both IDs committed)", () => {
    expect(NATIVE_PROVIDERS).toEqual({ apple: true, google: true });
  });
});
