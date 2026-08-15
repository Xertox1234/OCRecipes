#!/usr/bin/env node
/**
 * Route-Param Shadow Checker
 *
 * Rejects a `RouteProp<...>` whose ParamList argument is an inline object
 * literal — the `useRoute<RouteProp<{ params: RouteParams }, "params">>()`
 * shape. Screens must index the canonical `RootStackParamList` instead.
 *
 * Why this exists:
 *   A local restatement of the route params is not a duplicate, it is a
 *   SHADOW. TypeScript cannot warn that you ignored a field your own type
 *   says does not exist, so a param added to the navigator produces no error
 *   at any layer and silently never arrives at the screen. `NutritionDetail`
 *   lost two user-captured photo URIs to exactly this (PR #742) — the user
 *   completed a three-step capture flow and got back a stock image, with
 *   strict mode and CI green throughout.
 *
 *   See docs/solutions/logic-errors/
 *       local-route-param-type-shadows-canonical-paramlist-2026-07-30.md
 *
 * The rule is STRUCTURAL, not nominal. Banning the identifier `RouteParams`
 * would reject `type RouteParams = RootStackParamList["Foo"]`, which is a
 * derivation and exactly the thing we want people to write. The inline object
 * literal standing in for a ParamList is the defect itself.
 *
 * Usage:
 *   node scripts/check-route-params.js [files...]
 *   node scripts/check-route-params.js client/screens/LabelAnalysisScreen.tsx
 *
 * With no arguments, scans every `.ts`/`.tsx` file under `client/`.
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

/**
 * An inline object literal as the ParamList argument to `RouteProp`.
 *
 * The `\s*` is load-bearing, not defensive tidiness. Prettier owns formatting
 * and runs BEFORE this check in the same lint-staged array, so a violation
 * with a longer alias name reaches us already wrapped:
 *
 *   useRoute<
 *     RouteProp<
 *       { params: SomeLongerAliasName },
 *       "params"
 *     >
 *   >();
 *
 * A bare `RouteProp<{` literal match would pass that silently — which is the
 * shape a real future violation is most likely to take.
 */
const INLINE_PARAMLIST = /RouteProp\s*<\s*\{/g;

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

/** Recursively collect `.ts`/`.tsx` files under a directory. */
function findSourceFiles(rootDir) {
  const results = [];

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (entry.isFile() && isSourceFile(full)) {
        results.push(full);
      }
    }
  }

  walk(rootDir);
  return results;
}

/**
 * Returns one `{ line }` entry per inline-ParamList occurrence. The regex can
 * span newlines, so the line number is derived from the match index rather
 * than from a per-line scan.
 */
function findViolations(content) {
  const violations = [];
  INLINE_PARAMLIST.lastIndex = 0;
  let match;
  while ((match = INLINE_PARAMLIST.exec(content)) !== null) {
    const line = content.slice(0, match.index).split("\n").length;
    violations.push({ line });
  }
  return violations;
}

function main() {
  const args = process.argv.slice(2);
  const scanningWholeTree = args.length === 0;

  let files;
  if (scanningWholeTree) {
    const clientDir = path.resolve(__dirname, "..", "client");
    if (!fs.existsSync(clientDir)) {
      console.log(
        `${colors.yellow}client directory not found — nothing to check.${colors.reset}`,
      );
      process.exit(0);
    }
    files = findSourceFiles(clientDir);
  } else {
    files = args.map((f) => path.resolve(f)).filter(isSourceFile);
  }

  const failures = [];
  let filesChecked = 0;

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    filesChecked++;
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      console.error(
        `${colors.red}Error reading ${filePath}:${colors.reset} ${err.message}`,
      );
      process.exit(1);
    }
    for (const { line } of findViolations(content)) {
      failures.push({ filePath, line });
    }
  }

  // A whole-tree run that scanned nothing is green and meaningless — that means
  // the tree moved, not that the code is clean. Arg mode may legitimately get
  // zero (lint-staged handed us a deleted path), so only the sweep hard-fails.
  if (scanningWholeTree && filesChecked === 0) {
    console.error(
      `${colors.red}Scanned 0 files under client/ — the check did not run.${colors.reset}`,
    );
    process.exit(1);
  }

  if (failures.length === 0) {
    if (filesChecked > 0) {
      console.log(
        `${colors.green}✓ No inline route-param shadows in ${filesChecked} file${
          filesChecked === 1 ? "" : "s"
        }${colors.reset}`,
      );
    }
    process.exit(0);
  }

  console.log(
    `${colors.bold}Local route params shadow the navigator:${colors.reset}\n`,
  );
  for (const { filePath, line } of failures) {
    console.log(
      `${colors.cyan}${filePath}:${line}${colors.reset}: RouteProp takes an inline object literal instead of indexing RootStackParamList`,
    );
  }
  console.log(`\n${colors.bold}Summary:${colors.reset}`);
  console.log(`  Files checked: ${filesChecked}`);
  console.log(`  ${colors.red}Errors: ${failures.length}${colors.reset}`);
  console.log(
    `\n${colors.cyan}Index the canonical list instead:\n` +
      `  ${colors.bold}type FooRouteProp = RouteProp<RootStackParamList, "Foo">;${colors.reset}\n` +
      `${colors.cyan}A local restatement is a shadow — a param added to the navigator will\n` +
      `silently never reach the screen, with no error at any layer. See\n` +
      `docs/solutions/logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md${colors.reset}`,
  );
  process.exit(1);
}

main();
