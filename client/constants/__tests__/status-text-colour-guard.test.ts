import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, it, expect } from "vitest";

// Accessibility audit 2026-11-21 H2: `theme.warning` (#F57C00) and
// `theme.info` (#2196F3) are fill/icon tones. As TEXT on the light-mode cream
// background they measure 2.51:1 and 2.90:1 (AA needs 4.5:1), and they sat
// under the "allergen check failed" safety message among others. Text uses
// `theme.badgeWarningText` / `theme.badgeInfoText`, which pass in both modes.
//
// This matches style-object text colours (`color: theme.warning`, including a
// one-line ternary). An icon's `color={theme.warning}` JSX prop is not matched.
// Known limits: it reads one line at a time, so a ternary split across lines
// is missed, and so is a colour passed through a variable
// (`const color = …theme.warning…; style={{ color }}`) — review still owns those.

const CLIENT = join(__dirname, "..", "..");
// Anywhere in a `color:` value on the same line, so a ternary
// (`color: ok ? theme.success : theme.warning`) is caught too.
const TEXT_COLOUR = /\bcolor:[^,}]*\b(?:theme|colors)\.(?:warning|info)\b/;

// Drawn over the live camera preview (a dark, changing background), where the
// darker badge text tokens would lower contrast instead. Tracked in the
// audit's follow-up todo.
const ALLOWED = new Set(["screens/CookSessionCaptureScreen.tsx"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("status text colours", () => {
  it("never use theme.warning or theme.info as a text colour", () => {
    const offenders = sourceFiles(CLIENT).flatMap((file) => {
      const rel = relative(CLIENT, file);
      if (ALLOWED.has(rel)) return [];
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          TEXT_COLOUR.test(line) ? [`${rel}:${i + 1}`] : [],
        );
    });
    expect(offenders).toEqual([]);
  });
});
