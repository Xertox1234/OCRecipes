import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// `app.json` declares the EAS Update runtimeVersion, but the value only reaches
// a build through two GENERATED native files that this repo commits. They are
// rewritten by `expo prebuild` / `expo run:<platform>`, so a bump that lands
// without running both platforms strands the un-run one on the old lane —
// silently: the binary simply never sees updates published to the new version.
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const IOS_PLIST = "ios/OCRecipes/Supporting/Expo.plist";
const ANDROID_STRINGS = "android/app/src/main/res/values/strings.xml";

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function declaredRuntimeVersion(): string {
  const appJson = JSON.parse(read("app.json"));
  return appJson.expo.runtimeVersion;
}

/** `<key>EXUpdatesRuntimeVersion</key><string>X</string>` — value follows the key. */
function iosRuntimeVersion(): string | undefined {
  return read(IOS_PLIST).match(
    /<key>EXUpdatesRuntimeVersion<\/key>\s*<string>([^<]*)<\/string>/,
  )?.[1];
}

/** `<string name="expo_runtime_version">X</string>` */
function androidRuntimeVersion(): string | undefined {
  return read(ANDROID_STRINGS).match(
    /<string name="expo_runtime_version">([^<]*)<\/string>/,
  )?.[1];
}

describe("EAS Update runtimeVersion parity", () => {
  it("declares an explicit runtimeVersion in app.json", () => {
    // A `runtimeVersion` policy object instead of a string would make the
    // native files derive from `version` — these asserts would then be wrong.
    expect(typeof declaredRuntimeVersion()).toBe("string");
  });

  it("matches EXUpdatesRuntimeVersion in the iOS Expo.plist", () => {
    expect(iosRuntimeVersion()).toBe(declaredRuntimeVersion());
  });

  it("matches expo_runtime_version in the Android strings.xml", () => {
    expect(androidRuntimeVersion()).toBe(declaredRuntimeVersion());
  });

  it("routes the Android manifest through the strings.xml resource", () => {
    // The manifest holds no literal — if it ever inlines one, the strings.xml
    // assert above stops guarding what the build actually ships.
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain(
      'android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"',
    );
  });
});
