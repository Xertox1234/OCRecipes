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

  it("installs our Google sign-in pod and Google's SDK", () => {
    const lock = fs.readFileSync("ios/Podfile.lock", "utf8");
    expect(lock).toMatch(/^ {2}- OCRGoogleSignIn /m);
    expect(lock).toMatch(/^ {2}- GoogleSignIn \(/m);
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
  // app.json is the source `expo prebuild` generates Info.plist from (CNG).
  it("passes the reversed iOS client ID to the google-sign-in config plugin", () => {
    const entry = (appJson.expo.plugins as unknown[]).find(
      (p): p is [string, { iosUrlScheme: string }] =>
        Array.isArray(p) && p[0] === "./modules/google-sign-in/app.plugin.js",
    );
    expect(entry?.[1].iosUrlScheme).toBe(
      reversedIosClientId(GOOGLE_IOS_CLIENT_ID),
    );
  });

  it("registers the reversed iOS client ID as a URL scheme in Info.plist", () => {
    const plist = fs.readFileSync("ios/OCRecipes/Info.plist", "utf8");
    expect(plist).toContain(
      `<string>${reversedIosClientId(GOOGLE_IOS_CLIENT_ID)}</string>`,
    );
  });
});

// Native settings that used to be hand-edited into ios/ and that a clean
// `expo prebuild` would otherwise reset (CNG migration, 2026-10-13).
describe("native build config survives prebuild", () => {
  const plugins = appJson.expo.plugins as unknown[];

  it("keeps the iOS 16.0 floor and the from-source React Native build", () => {
    const entry = plugins.find(
      (p): p is [string, { ios: Record<string, unknown> }] =>
        Array.isArray(p) && p[0] === "expo-build-properties",
    );
    expect(entry?.[1].ios).toMatchObject({
      deploymentTarget: "16.0",
      buildReactNativeFromSource: true,
    });
  });

  it("runs the Podfile fixes plugin", () => {
    expect(plugins).toContain("./plugins/ios-podfile-fixes");
  });

  it("signs local device builds with the team", () => {
    expect(appJson.expo.ios.appleTeamId).toBe("3442937R38");
  });

  it("declares the App Store privacy manifest", () => {
    const manifest = appJson.expo.ios.privacyManifests;
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyAccessedAPITypes.length).toBeGreaterThan(0);
    expect(manifest.NSPrivacyCollectedDataTypes.length).toBeGreaterThan(0);
  });
});
