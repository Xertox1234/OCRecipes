import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";

/**
 * scripts/harness/platform-scope.sh decides whether a PR needs a real-platform
 * (E2E) run before merge. These pin its `sdk` rule: an app SDK bump is in scope,
 * a server-only package that happens to be named expo-* is not.
 *
 * Exit codes are the contract both guards read: 0 in scope, 1 not in scope,
 * 2 unreadable diff. "Not in scope" must be exactly 1.
 */
const SCRIPT = path.resolve(__dirname, "..", "harness", "platform-scope.sh");

function scope(diff: string) {
  const r = spawnSync("bash", [SCRIPT], { input: diff, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout };
}

/** A package.json diff that bumps each named package from 1.0.0 to 2.0.0. */
function bump(...names: string[]): string {
  const lines = names.flatMap((n) => [
    `-    "${n}": "^1.0.0",`,
    `+    "${n}": "^2.0.0",`,
  ]);
  return [
    "diff --git a/package.json b/package.json",
    "index 1111111..2222222 100644",
    "--- a/package.json",
    "+++ b/package.json",
    "@@ -10,3 +10,3 @@",
    '     "express": "^5.0.0",',
    ...lines,
    "",
  ].join("\n");
}

describe("platform-scope.sh sdk rule", () => {
  it("a bump of only the server-only expo-server-sdk is not in scope", () => {
    const { status, stdout } = scope(bump("expo-server-sdk"));
    expect(stdout).toBe("");
    expect(status).toBe(1);
  });

  it.each([
    "expo",
    "expo-file-system",
    "react-native",
    "react-native-reanimated",
    "@expo/vector-icons",
    "@react-native-async-storage/async-storage",
  ])("a bump of %s is in scope", (name) => {
    const { status, stdout } = scope(bump(name));
    expect(status).toBe(0);
    expect(stdout).toBe("sdk package.json\n");
  });

  it("expo-server-sdk together with an app SDK package is in scope", () => {
    const { status, stdout } = scope(bump("expo-server-sdk", "expo"));
    expect(status).toBe(0);
    expect(stdout).toBe("sdk package.json\n");
  });

  it.each(["expo-server-sdk-extras", "expo-server", "@expo/server"])(
    "the exclusion is an exact name: %s stays in scope",
    (name) => {
      const { status, stdout } = scope(bump(name));
      expect(status).toBe(0);
      expect(stdout).toBe("sdk package.json\n");
    },
  );

  it("a non-SDK package is not in scope (control)", () => {
    expect(scope(bump("express")).status).toBe(1);
  });

  it("empty input is unreadable, never 'not in scope'", () => {
    expect(scope("").status).toBe(2);
  });
});
