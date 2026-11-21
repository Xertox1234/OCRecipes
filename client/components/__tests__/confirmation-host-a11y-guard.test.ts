import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, it, expect } from "vitest";

// Accessibility audit 2026-11-21 M9: the confirm sheet is a gorhom
// BottomSheetModal, and accessibilityViewIsModal is iOS-only, so on Android
// TalkBack swipes straight into the screen behind an open confirm (the health
// consent prompt, destructive confirms). The hook's behindContentA11yProps
// hides that content; every host must spread it onto its top-level content.
// This only proves a host spreads it somewhere — that every sibling of the
// sheet (e.g. a sticky footer) is covered is still a review check.

const CLIENT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe("useConfirmationModal hosts", () => {
  it("spread behindContentA11yProps onto the content behind the sheet", () => {
    const missing = sourceFiles(CLIENT)
      .filter((file) => !file.endsWith("components/ConfirmationModal.tsx"))
      // An actual call, not a mention in a comment.
      .filter((file) =>
        /=\s*useConfirmationModal\(\)/.test(readFileSync(file, "utf8")),
      )
      .filter(
        (file) =>
          !readFileSync(file, "utf8").includes("{...behindContentA11yProps}"),
      )
      .map((file) => relative(CLIENT, file));
    expect(missing).toEqual([]);
  });
});
