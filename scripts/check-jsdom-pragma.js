#!/usr/bin/env node
/**
 * JSDOM Pragma Checker
 *
 * Enforces that every `.test.tsx` file under `client/components/**\/__tests__/`
 * declares `// @vitest-environment jsdom` (or the JSDoc form) in its first 3
 * lines.
 *
 * Why this exists:
 *   vitest.config.ts no longer uses `environmentMatchGlobs` (removed in PR
 *   #148 / audit 2026-05-11 L1). Without the glob, a new component test that
 *   forgets the pragma silently falls back to the `node` environment, where
 *   `document` and other DOM APIs are undefined — leading to either spurious
 *   passes or confusing `ReferenceError` failures.
 *
 * This check is the explicit replacement for that implicit safety net.
 *
 * Usage:
 *   node scripts/check-jsdom-pragma.js [files...]
 *   node scripts/check-jsdom-pragma.js client/components/__tests__/Foo.test.tsx
 *
 * When run with no arguments, scans all `.test.tsx` files under
 * `client/components/**\/__tests__/`.
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

// Permissive whitespace inside the pragma — anyone hand-formatting may add spaces.
const LINE_PRAGMA = /^\s*\/\/\s*@vitest-environment\s+jsdom\s*$/;
const BLOCK_PRAGMA = /^\s*\/\*\*\s*@vitest-environment\s+jsdom\s*\*\/\s*$/;

/**
 * Returns true if the file path is a `.test.tsx` file under any
 * `client/components/**\/__tests__/` directory.
 *
 * Normalizes to POSIX separators so the check works on Windows as well, even
 * though the project itself is macOS/Linux-only.
 */
function isInScope(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.endsWith(".test.tsx")) return false;
  // Matches `client/components/__tests__/` and `client/components/<any-path>/__tests__/`.
  return /(^|\/)client\/components\/(?:.+\/)?__tests__\//.test(normalized);
}

function hasPragma(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const firstThreeLines = content.split("\n", 3);
  return firstThreeLines.some(
    (line) => LINE_PRAGMA.test(line) || BLOCK_PRAGMA.test(line),
  );
}

/**
 * Recursively find all `.test.tsx` files under `client/components/` that live
 * in a `__tests__` directory.
 */
function findScopedTestFiles(rootDir) {
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
      } else if (entry.isFile() && isInScope(full)) {
        results.push(full);
      }
    }
  }

  walk(rootDir);
  return results;
}

function main() {
  const args = process.argv.slice(2);

  let files;
  if (args.length === 0) {
    const componentsDir = path.resolve(__dirname, "..", "client", "components");
    if (!fs.existsSync(componentsDir)) {
      console.log(
        `${colors.yellow}client/components directory not found — nothing to check.${colors.reset}`,
      );
      process.exit(0);
    }
    files = findScopedTestFiles(componentsDir);
  } else {
    files = args.map((f) => path.resolve(f)).filter((f) => isInScope(f));
  }

  const failures = [];
  let filesChecked = 0;

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    filesChecked++;
    try {
      if (!hasPragma(filePath)) {
        failures.push(filePath);
      }
    } catch (err) {
      console.error(
        `${colors.red}Error reading ${filePath}:${colors.reset} ${err.message}`,
      );
      process.exit(1);
    }
  }

  if (failures.length === 0) {
    if (filesChecked > 0) {
      console.log(
        `${colors.green}✓ jsdom pragma present in ${filesChecked} files${colors.reset}`,
      );
    }
    process.exit(0);
  }

  console.log(`${colors.bold}Missing jsdom pragma:${colors.reset}\n`);
  for (const filePath of failures) {
    console.log(
      `${colors.cyan}${filePath}${colors.reset}: missing '// @vitest-environment jsdom' pragma (required since vitest.config.ts no longer matches via environmentMatchGlobs)`,
    );
  }
  console.log(`\n${colors.bold}Summary:${colors.reset}`);
  console.log(`  Files checked: ${filesChecked}`);
  console.log(`  ${colors.red}Errors: ${failures.length}${colors.reset}`);
  console.log(
    `\n${colors.cyan}Add ${colors.bold}// @vitest-environment jsdom${colors.reset}${colors.cyan} as the first line. See docs/patterns/testing.md.${colors.reset}`,
  );
  process.exit(1);
}

main();
