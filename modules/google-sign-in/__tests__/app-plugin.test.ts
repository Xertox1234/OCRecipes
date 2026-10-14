import { describe, it, expect } from "vitest";
import withGoogleSignIn from "../app.plugin";

const { addUrlScheme } = withGoogleSignIn;

const SCHEME = "com.googleusercontent.apps.123-abc";

describe("google-sign-in config plugin", () => {
  it("appends the scheme without touching the app's own URL types", () => {
    const own = [
      { CFBundleURLSchemes: ["ocrecipes", "com.example.app"] },
      { CFBundleURLSchemes: ["exp+ocrecipes"] },
    ];
    const out = addUrlScheme(
      { CFBundleURLTypes: structuredClone(own) },
      SCHEME,
    );
    expect(out.CFBundleURLTypes).toEqual([
      ...own,
      { CFBundleURLSchemes: [SCHEME] },
    ]);
  });

  it("creates the URL types list when there is none", () => {
    expect(addUrlScheme({}, SCHEME).CFBundleURLTypes).toEqual([
      { CFBundleURLSchemes: [SCHEME] },
    ]);
  });

  it("is idempotent", () => {
    const once = addUrlScheme({}, SCHEME);
    expect(addUrlScheme(once, SCHEME).CFBundleURLTypes).toHaveLength(1);
  });

  // Google's iOS SDK closes the app when the scheme is missing — fail the
  // prebuild instead of shipping that.
  it("throws when no iosUrlScheme option is given", () => {
    expect(() => withGoogleSignIn({ name: "x", slug: "x" }, {})).toThrow(
      /iosUrlScheme/,
    );
  });
});
