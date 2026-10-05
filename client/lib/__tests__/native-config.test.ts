import { describe, it, expect } from "vitest";
import fs from "node:fs";
import appJson from "../../../app.json";

// Pins the native pieces Sign in with Apple needs, which a reviewer would
// otherwise have to eyeball. Owner ruling 2026-10-05: Apple-only first; the
// Google SDK (paid Universal Sign In) is added later.
describe("native sign-in config", () => {
  it("bumps the runtime version past 1.3.0 (new native module)", () => {
    expect(appJson.expo.runtimeVersion).toBe("1.4.0");
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
});
