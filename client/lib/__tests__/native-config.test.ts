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
  // The native projects are generated (CNG), so app.json is the only copy of
  // the runtime version — `expo prebuild` writes Expo.plist / strings.xml.
  // 5.1.0: react-native-webview + modules/webview-site-data are new native
  // code, so 5.0.0 builds must not receive OTAs that render the import WebView.
  // 5.2.0: native patch bumps (expo 58.0.23 + expo-* modules, vision-camera
  // 5.2.4, nitro-modules 0.37.2), so 5.1.0 builds must not receive OTAs built
  // against the newer native code.
  it("bumps the runtime version to 5.2.0 (native module patch bumps)", () => {
    expect(appJson.expo.runtimeVersion).toBe("5.2.0");
  });

  // The plugin writes the com.apple.developer.applesignin entitlement.
  it("lists the expo-apple-authentication plugin in app.json", () => {
    expect(JSON.stringify(appJson.expo.plugins)).toContain(
      "expo-apple-authentication",
    );
  });

  it("depends on expo-apple-authentication, so autolinking installs its pod", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    expect(pkg.dependencies).toHaveProperty("expo-apple-authentication");
  });

  it("makes our Google sign-in pod depend on Google's SDK", () => {
    const podspec = fs.readFileSync(
      "modules/google-sign-in/ios/OCRGoogleSignIn.podspec",
      "utf8",
    );
    expect(podspec).toMatch(/s\.name\s+= 'OCRGoogleSignIn'/);
    expect(podspec).toMatch(/s\.dependency 'GoogleSignIn'/);
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
  // The plugin appends it to Info.plist's URL types at prebuild (CNG).
  it("passes the reversed iOS client ID to the google-sign-in config plugin", () => {
    const entry = (appJson.expo.plugins as unknown[]).find(
      (p): p is [string, { iosUrlScheme: string }] =>
        Array.isArray(p) && p[0] === "./modules/google-sign-in/app.plugin.js",
    );
    expect(entry?.[1].iosUrlScheme).toBe(
      reversedIosClientId(GOOGLE_IOS_CLIENT_ID),
    );
  });
});

// Native settings that used to be hand-edited into ios/ and that a clean
// `expo prebuild` would otherwise reset (CNG migration, 2026-10-13).
describe("native build config survives prebuild", () => {
  const plugins = appJson.expo.plugins as unknown[];

  it("keeps the iOS 16.4 floor and the from-source React Native build", () => {
    const entry = plugins.find(
      (p): p is [string, { ios: Record<string, unknown> }] =>
        Array.isArray(p) && p[0] === "expo-build-properties",
    );
    expect(entry?.[1].ios).toMatchObject({
      deploymentTarget: "16.4",
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

// Privacy audit M11 — the manifest must say what the app really collects.
// The App Store label is typed by hand in App Store Connect; keep the two the same.
describe("App Store privacy manifest matches what the app collects", () => {
  const collected = appJson.expo.ios.privacyManifests
    .NSPrivacyCollectedDataTypes as {
    NSPrivacyCollectedDataType: string;
    NSPrivacyCollectedDataTypeLinked: boolean;
    NSPrivacyCollectedDataTypeTracking: boolean;
    NSPrivacyCollectedDataTypePurposes: string[];
  }[];
  const entry = (type: string) =>
    collected.find(
      (d) =>
        d.NSPrivacyCollectedDataType === `NSPrivacyCollectedDataType${type}`,
    );

  // The crash SDK puts a per-install id on every report when the app sets no
  // user (RNSentry.mm deviceContexts → devicecontext integration), so a crash
  // report can be tied to one phone.
  it("declares crash data as linked", () => {
    expect(entry("CrashData")?.NSPrivacyCollectedDataTypeLinked).toBe(true);
  });

  // Dictation uses the phone's own speech recognition (useSpeechToText); the
  // app never records or uploads sound. Declare Audio Data again before any
  // build sends audio to the server (the /api/food/transcribe route).
  it("does not declare audio data", () => {
    expect(entry("AudioData")).toBeUndefined();
  });

  // Search words go to our server and on to a recipe-search provider whose
  // retention we cannot see. No table stores them against a user, so: not linked.
  it("declares search history, not linked", () => {
    expect(entry("SearchHistory")).toEqual({
      NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeSearchHistory",
      NSPrivacyCollectedDataTypeLinked: false,
      NSPrivacyCollectedDataTypeTracking: false,
      NSPrivacyCollectedDataTypePurposes: [
        "NSPrivacyCollectedDataTypePurposeAppFunctionality",
      ],
    });
  });

  it("tracks nothing", () => {
    expect(collected.every((d) => !d.NSPrivacyCollectedDataTypeTracking)).toBe(
      true,
    );
  });
});
