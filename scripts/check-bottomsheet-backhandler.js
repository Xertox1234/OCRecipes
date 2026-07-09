#!/usr/bin/env node
/**
 * BottomSheetModal BackHandler Wiring Checker
 *
 * Flags a `.tsx` file that renders a `<BottomSheetModal>` (an actual JSX
 * element — not the `BottomSheetModalProvider` wrapper, and not a
 * `useRef<BottomSheetModal>()` type argument) without also calling
 * `useSheetBackHandler(` somewhere in the same file.
 *
 * Why this exists:
 *   @gorhom/bottom-sheet has no built-in Android hardware-back wiring (see
 *   `client/hooks/useSheetBackHandler.ts`) — every BottomSheetModal host
 *   must call the hook explicitly, or a hardware back press falls through
 *   to React Navigation and pops the screen underneath an open sheet
 *   instead of dismissing it. Nothing in the type system enforces this;
 *   this script is the explicit static guard, matching the precedent set
 *   by `check-accessibility.js` / `check-jsdom-pragma.js` (component
 *   present without its required companion).
 *
 * Usage:
 *   node scripts/check-bottomsheet-backhandler.js [files...]
 *   node scripts/check-bottomsheet-backhandler.js client/screens/meal-plan/MealPlanHomeScreen.tsx
 *
 * When run with no arguments, scans all `client/**\/*.tsx` files.
 *
 * Limitations:
 *   - This is a file-level presence check (does ANY `useSheetBackHandler(`
 *     call exist in the same file as ANY BottomSheetModal JSX), not a
 *     per-ref correlation — a file with multiple sheets where only one is
 *     wired will not be caught.
 *   - The JSX match is on the literal name `BottomSheetModal`. An aliased
 *     import (`import { BottomSheetModal as Sheet } from "@gorhom/bottom-sheet"`)
 *     would render `<Sheet ...>` and silently bypass this check (fail-open
 *     false negative). No aliased import exists in the codebase today.
 * See the todo that added this script, archived at
 * `todos/archive/P3-2026-07-07-usesheetbackhandler-edge-cases.md`.
 */

import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ESC = "\x1b[";
const colors = {
  red: ESC + "31m",
  yellow: ESC + "33m",
  green: ESC + "32m",
  cyan: ESC + "36m",
  reset: ESC + "0m",
  bold: ESC + "1m",
};

const skipPatterns = [
  "node_modules",
  "__tests__",
  ".test.",
  ".spec.",
  "dist",
  "build",
];

function shouldSkipFile(filePath) {
  return skipPatterns.some((pattern) => filePath.includes(pattern));
}

// Matches an actual JSX `<BottomSheetModal` opening/self-closing tag against
// the WHOLE file content (not line-by-line, so a tag name immediately
// followed by a line break — attributes on the next line — still matches).
// The char before `<` must not be a word char or `.` (excludes
// `useRef<BottomSheetModal>` generics and a hypothetical `Foo.BottomSheetModal`
// namespaced usage); the char after the name must be whitespace, `/`, or `>`
// (excludes `BottomSheetModalProvider`).
const JSX_TAG_PATTERN = /(^|[^\w.])<BottomSheetModal(?=[\s/>])/;
const HOOK_CALL_PATTERN = /useSheetBackHandler\(/;

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!JSX_TAG_PATTERN.test(content)) return null;
  if (HOOK_CALL_PATTERN.test(content)) return null;
  return filePath;
}

/**
 * Recursively find all `.tsx` files under `dir`, skipping the same
 * directories/patterns as `shouldSkipFile`.
 */
function findTsxFiles(dir) {
  const results = [];

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (shouldSkipFile(full)) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && full.endsWith(".tsx")) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

function main() {
  const args = process.argv.slice(2).filter((f) => !shouldSkipFile(f));

  if (args.length === 0) {
    console.log("No files provided, checking all client/**/*.tsx files...\n");
    const clientDir = path.join(__dirname, "..", "client");
    args.push(...findTsxFiles(clientDir));
  }

  const failures = [];
  let filesChecked = 0;

  for (const file of args) {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath) || !filePath.endsWith(".tsx")) continue;
    filesChecked++;
    const failure = checkFile(filePath);
    if (failure) failures.push(failure);
  }

  if (failures.length === 0) {
    console.log(
      `${colors.green}✓ No unwired BottomSheetModal hosts found in ${filesChecked} files${colors.reset}`,
    );
    process.exit(0);
  }

  console.log(
    `${colors.bold}Unwired BottomSheetModal hosts found:${colors.reset}\n`,
  );
  for (const failure of failures) {
    console.log(
      `${colors.cyan}${failure}${colors.reset}: renders <BottomSheetModal> but never calls useSheetBackHandler(...) — Android hardware back will fall through to navigation instead of dismissing the sheet. See client/hooks/useSheetBackHandler.ts.`,
    );
  }

  console.log(`\n${colors.bold}Summary:${colors.reset}`);
  console.log(`  Files checked: ${filesChecked}`);
  console.log(`  ${colors.red}Errors: ${failures.length}${colors.reset}`);
  console.log(
    `\n${colors.cyan}Wire useSheetBackHandler(sheetRef, isOpen) (state-driven hosts) or useSheetBackHandler(sheetRef) + onSheetChange/onSheetAnimate (imperative hosts) onto every BottomSheetModal host.${colors.reset}`,
  );

  process.exit(1);
}

main();
