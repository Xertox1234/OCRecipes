import { describe, it, expect } from "vitest";
import fs from "node:fs";
import appJson from "../../../app.json";
import {
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
  reversedIosClientId,
} from "@/constants/google-oauth";

// Pins the native pieces Sign in with Apple and Google need, which a reviewer
// would otherwise have to eyeball. Google uses our own module
// (modules/google-sign-in, spec 2026-10-09).
describe("native sign-in config", () => {
  it("bumps the runtime version to 1.5.0 everywhere (Google native module)", () => {
    expect(appJson.expo.runtimeVersion).toBe("1.5.0");
    expect(
      fs.readFileSync("ios/OCRecipes/Supporting/Expo.plist", "utf8"),
    ).toContain("<string>1.5.0</string>");
    expect(
      fs.readFileSync("android/app/src/main/res/values/strings.xml", "utf8"),
    ).toContain('<string name="expo_runtime_version">1.5.0</string>');
  });

  it("declares the Sign in with Apple entitlement", () => {
    const xml = fs.readFileSync("ios/OCRecipes/OCRecipes.entitlements", "utf8");
    expect(xml).toContain("<key>com.apple.developer.applesignin</key>");
    expect(xml).toContain("<string>Default</string>");
  });

  it("lists the expo-apple-authentication plugin in app.json", () => {
    expect(JSON.stringify(appJson.expo.plugins)).toContain(
      "expo-apple-authentication",
    );
  });

  it("installs the expo-apple-authentication native pod", () => {
    const lock = fs.readFileSync("ios/Podfile.lock", "utf8");
    expect(lock).toMatch(/^ {2}- ExpoAppleAuthentication /m);
  });

  it("ships the Google client IDs", () => {
    expect(GOOGLE_WEB_CLIENT_ID).toMatch(
      /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
    );
    expect(GOOGLE_IOS_CLIENT_ID).toMatch(
      /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
    );
  });

  it("reverses an iOS client ID into its URL scheme", () => {
    expect(reversedIosClientId("123-abc.apps.googleusercontent.com")).toBe(
      "com.googleusercontent.apps.123-abc",
    );
  });

  // Google's iOS SDK closes the app if this scheme is missing (spec §3.2).
  it("registers the reversed iOS client ID as a URL scheme in Info.plist", () => {
    const plist = fs.readFileSync("ios/OCRecipes/Info.plist", "utf8");
    expect(plist).toContain(
      `<string>${reversedIosClientId(GOOGLE_IOS_CLIENT_ID)}</string>`,
    );
  });
});
