import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The Android half of the import WebView lockdown lives in a patch-package
 * patch: react-native-webview would otherwise grant camera/mic to any page
 * when the app already holds those permissions, and save downloads to public
 * storage with the site's cookies. Deleting or regenerating the patch without
 * these hunks must fail CI.
 */
const PATCH_PATH = fileURLToPath(
  new URL(
    "../../../../patches/react-native-webview+14.0.1.patch",
    import.meta.url,
  ),
);

function readPatch(): string {
  return readFileSync(PATCH_PATH, "utf8");
}

/** Lines the patch adds, without the leading "+". */
function addedLines(patch: string): string[] {
  return patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
}

/** The diff section for one file (from its `diff --git` header to the next). */
function fileSection(patch: string, fileName: string): string {
  const sections = patch.split(/^(?=diff --git )/m);
  return sections.find((s) => s.split("\n")[0].includes(fileName)) ?? "";
}

describe("react-native-webview Android patch", () => {
  it("exists", () => {
    expect(existsSync(PATCH_PATH)).toBe(true);
  });

  it("denies media capture inside onPermissionRequest", () => {
    const section = fileSection(readPatch(), "RNCWebChromeClient.java");
    expect(section).toContain("onPermissionRequest");
    const added = addedLines(section).join("\n");
    expect(added).toContain("request.deny()");
    expect(added).toContain("RESOURCE_VIDEO_CAPTURE");
    expect(added).toContain("RESOURCE_AUDIO_CAPTURE");
  });

  it("turns the download listener into a no-op", () => {
    const section = fileSection(readPatch(), "RNCWebViewManagerImpl.kt");
    expect(section).not.toBe("");
    const added = addedLines(section);
    expect(added.join("\n")).toContain("OCRecipes: downloads off");
    // The public-Downloads save must not survive in the patched listener.
    expect(added.some((l) => l.includes("DownloadManager.Request("))).toBe(
      false,
    );
    expect(section).toMatch(/^-.*setDestinationInExternalPublicDir/m);
  });

  it("touches only the two locked-down files", () => {
    const headers = readPatch().match(/^diff --git .*$/gm) ?? [];
    expect(headers).toHaveLength(2);
  });
});
