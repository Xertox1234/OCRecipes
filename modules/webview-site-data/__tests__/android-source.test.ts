import fs from "node:fs";
import { describe, it, expect } from "vitest";

// Vitest cannot run Kotlin, so this reads the source (the same idiom as the
// podspec checks in client/lib/__tests__/native-config.test.ts).
const kotlin = fs.readFileSync(
  "modules/webview-site-data/android/src/main/java/com/ocrecipes/webviewsitedata/WebviewSiteDataModule.kt",
  "utf8",
);

// Privacy audit 2026-11-10, L5: Android "Clear site data" removed cookies and
// storage but left the WebView HTTP cache (pages and pictures of visited
// recipe sites) on the device. iOS already clears every data type.
describe("Android clearAll", () => {
  it("clears the WebView HTTP cache, disk files included", () => {
    expect(kotlin).toMatch(/\.clearCache\(true\)/);
  });

  it("still clears storage and cookies", () => {
    expect(kotlin).toContain("WebStorage.getInstance().deleteAllData()");
    expect(kotlin).toContain("removeAllCookies");
  });

  // A cache step that throws must not skip the cookie removal or reject the
  // call: a rejected clearAll makes the sign-out wipe report failure and run
  // again at every launch.
  it("keeps the cache step in its own try, apart from cookies and storage", () => {
    const helper = kotlin.slice(kotlin.indexOf("private fun clearHttpCache"));
    expect(helper).toMatch(
      /try\s*\{[\s\S]*\.clearCache\(true\)[\s\S]*\}\s*catch/,
    );
    expect(helper).not.toContain("promise.reject");
  });
});
