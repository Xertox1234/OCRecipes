#!/usr/bin/env node
/**
 * React Compiler Bailout Ratchet
 *
 * React Compiler (`app.json` -> experiments.reactCompiler, wired via
 * babel-preset-expo's babel-plugin-react-compiler) silently skips any
 * component it cannot lower — no build warning, no lint error. The project
 * rule "React Compiler is ACTIVE, manual memo is redundant" (docs/rules/
 * performance.md) is only true for a component that actually compiles.
 * Measured 2026-09-23: 61 of 226 client `.tsx` files contain a skipped
 * component; a 2026-09-25 review found 20 more among the client `.ts` hooks
 * (compilationMode "infer" compiles use*-named hooks in plain `.ts` too).
 * Nothing enforced those numbers staying flat — this script does.
 *
 * Method (same recipe used to derive the 2026-09-23 audit's count): compile
 * every `client/**\/*.{ts,tsx}` file (excluding `__tests__` and `.d.ts`,
 * each parsed as TSX only if it IS `.tsx`, like the real build) through the
 * INSTALLED `babel-plugin-react-compiler`, standalone (`@babel/preset-
 * typescript` + `@babel/plugin-syntax-jsx`, no `babel-preset-expo`) with a
 * logger. A file is a "bailout" iff the logger records anything other than
 * `CompileSuccess` for it, or the transform throws outright. NOTE:
 * `CompileSuccess` is itself a *logged event* (once per compiled function/
 * component) — checking `events.length > 0` alone is wrong and flags nearly
 * every file; the classification must check the *kind* of each event.
 *
 * Caveat (do not build a "reasons" report from this): the pinned
 * `babel-plugin-react-compiler@1.0.0` stops lowering a function at its FIRST
 * error, so a file with two independent bailout causes (e.g. a `try/finally`
 * AND a separate render-body `ref.current =` write) only ever reports the
 * first one found. This script therefore only ever asserts bailout
 * presence/absence per file, never "the reason" — a per-file reason would be
 * an unverifiable claim once the first-found cause is fixed. See
 * docs/rules/hooks.md's `ref.current` render-write rule for a concrete case.
 *
 * Positive control: `client/components/ThemedText.tsx` must always compile
 * clean. If it doesn't, the harness itself is broken (wrong babel/plugin
 * versions, missing peer deps) — that is reported as exit 2, distinct from a
 * real new bailout (exit 1), mirroring scripts/coverage-ratchet.ts's 0/1/2
 * exit convention.
 *
 * Usage:
 *   node scripts/check-react-compiler-bailouts.js
 *     Compares the current bailout set to the checked-in baseline
 *     (scripts/react-compiler-bailout-baseline.json). Fails if any file
 *     bails out that is NOT already in the baseline — i.e. it ratchets: the
 *     known-bad set can only ever be replaced with an equal-or-smaller one,
 *     never silently grow.
 *
 *   node scripts/check-react-compiler-bailouts.js --update-baseline
 *     Regenerates the baseline file from the current measurement. Run this
 *     deliberately after fixing a bailout (to shrink the baseline) or after
 *     knowingly accepting a new one (to grow it) — never as a way to make a
 *     failing check pass without looking at what changed.
 *
 *   --root <path>            Repo root to scan (default: this script's repo).
 *   --baseline-file <path>   Baseline JSON path (default: the checked-in one).
 *   (Both exist mainly so tests can point at a temp fixture tree instead of
 *   the real client/ tree and the real baseline file.)
 *
 * Exit codes:
 *   0  no new bailouts beyond the baseline (or --update-baseline succeeded)
 *   1  one or more files bail out that are not yet in the baseline
 *   2  harness/usage error — the positive control failed, the baseline file
 *      is unreadable/malformed, or an argument is unrecognized
 */

import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);
const DEFAULT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_BASELINE_FILE = path.join(
  __dirname,
  "react-compiler-bailout-baseline.json",
);
const CONTROL_RELATIVE_PATH = "client/components/ThemedText.tsx";

const ESC = "\x1b[";
const colors = {
  red: ESC + "31m",
  yellow: ESC + "33m",
  green: ESC + "32m",
  cyan: ESC + "36m",
  reset: ESC + "0m",
  bold: ESC + "1m",
  dim: ESC + "2m",
};

const babel = require("@babel/core");
const reactCompilerPlugin = require.resolve("babel-plugin-react-compiler");
const presetTypescript = require.resolve("@babel/preset-typescript");
const syntaxJsx = require.resolve("@babel/plugin-syntax-jsx");

/**
 * Recursively find all client source files (`.ts` and `.tsx`, not `.d.ts`)
 * under `dir`, excluding any `__tests__` or `node_modules` directory. Returns
 * paths relative to `root`, with forward slashes.
 */
export function findClientSourceFiles(dir, root) {
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
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__tests__")
          continue;
        walk(full);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith(".tsx") ||
          (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")))
      ) {
        results.push(path.relative(root, full).replace(/\\/g, "/"));
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * True iff the file at `absPath` fails to fully compile through
 * babel-plugin-react-compiler — i.e. it logs anything other than
 * `CompileSuccess`, or the transform throws.
 */
export function isBailout(absPath) {
  const eventKinds = [];
  // Parse like the real build: TSX only for .tsx (an angle-bracket type
  // assertion is valid .ts but a TSX parse error).
  const isTSX = absPath.endsWith(".tsx");
  try {
    babel.transformFileSync(absPath, {
      babelrc: false,
      configFile: false,
      presets: [[presetTypescript, { isTSX, allExtensions: true }]],
      plugins: [
        ...(isTSX ? [[syntaxJsx]] : []),
        [
          reactCompilerPlugin,
          {
            logger: {
              logEvent: (_fn, e) => eventKinds.push(e.kind),
            },
          },
        ],
      ],
    });
  } catch {
    return true;
  }
  return eventKinds.some((kind) => kind !== "CompileSuccess");
}

/**
 * Reads the baseline file. A missing file is treated as an empty baseline
 * (ok — the ratchet just starts from zero known bailouts); malformed JSON or
 * a non-array shape is a harness error.
 * @param {string} baselineFile
 * @returns {{kind: "ok", data: string[]} | {kind: "error", message: string}}
 */
export function loadBaseline(baselineFile) {
  if (!fs.existsSync(baselineFile)) return { kind: "ok", data: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  } catch (err) {
    return {
      kind: "error",
      message: `Could not parse baseline file ${baselineFile}: ${err.message}`,
    };
  }
  if (!Array.isArray(data)) {
    return {
      kind: "error",
      message: `Baseline file ${baselineFile} is not a JSON array.`,
    };
  }
  return { kind: "ok", data };
}

/** Writes a sorted, de-duplicated baseline file. Returns the sorted list. */
export function writeBaseline(list, baselineFile) {
  const sorted = [...new Set(list)].sort();
  fs.writeFileSync(
    baselineFile,
    JSON.stringify(sorted, null, 2) + "\n",
    "utf8",
  );
  return sorted;
}

/**
 * Pure ratchet logic: given the currently-measured bailouts and the baseline,
 * returns which current bailouts are NEW (not in the baseline — a regression)
 * and which baseline entries no longer bail out (fixed — the baseline could
 * shrink).
 */
export function diffBailouts(currentBailouts, baseline) {
  const baselineSet = new Set(baseline);
  const currentSet = new Set(currentBailouts);
  return {
    newBailouts: currentBailouts.filter((f) => !baselineSet.has(f)),
    fixed: baseline.filter((f) => !currentSet.has(f)),
  };
}

/**
 * @param {string[]} args
 * @returns {{kind: "ok", updateMode: boolean, root: string, baselineFile: string} | {kind: "error", message: string}}
 */
export function parseArgs(args) {
  let updateMode = false;
  let root = DEFAULT_ROOT;
  let baselineFile = DEFAULT_BASELINE_FILE;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--update-baseline") {
      updateMode = true;
    } else if (args[i] === "--root" && args[i + 1]) {
      root = path.resolve(args[++i]);
    } else if (args[i] === "--baseline-file" && args[i + 1]) {
      baselineFile = path.resolve(args[++i]);
    } else {
      // This script's default invocation is chained onto `npm run lint`
      // (package.json), so `npm run lint -- <anything>` forwards args here,
      // not to `expo lint` — a typo must not silently run in report-only
      // mode (same convention as scripts/coverage-ratchet.ts).
      return { kind: "error", message: `Unknown argument: ${args[i]}` };
    }
  }

  return { kind: "ok", updateMode, root, baselineFile };
}

/**
 * The check is only meaningful if it runs the SAME babel-plugin-react-compiler
 * copy the real build uses. babel-preset-expo declares it as its own
 * dependency, so a future Expo bump can nest a different copy for the build
 * while this script keeps resolving the root one.
 */
/** True iff both resolved plugin paths are the same file. Pure, so testable. */
export function pluginPathsMatch(checkPath, expoPath) {
  return checkPath === expoPath;
}

export function compilerMatchesExpoBuild() {
  const checkPath = reactCompilerPlugin;
  let expoPath;
  try {
    const expoRequire = createRequire(
      require.resolve("babel-preset-expo/package.json"),
    );
    expoPath = expoRequire.resolve("babel-plugin-react-compiler");
  } catch (error) {
    return { ok: false, checkPath, expoPath: `unresolvable (${error})` };
  }
  return { ok: pluginPathsMatch(checkPath, expoPath), checkPath, expoPath };
}

export function main(args) {
  const parsed = parseArgs(args);
  if (parsed.kind === "error") {
    console.error(`${colors.red}${parsed.message}${colors.reset}`);
    console.error(
      "Usage: node scripts/check-react-compiler-bailouts.js [--update-baseline] [--root <path>] [--baseline-file <path>]",
    );
    return 2;
  }
  const { updateMode, root, baselineFile } = parsed;

  const clientDir = path.join(root, "client");
  if (!fs.existsSync(clientDir)) {
    console.log(
      `${colors.yellow}client/ directory not found under ${root} — nothing to check.${colors.reset}`,
    );
    return 0;
  }

  const compiler = compilerMatchesExpoBuild();
  if (!compiler.ok) {
    console.error(
      `${colors.red}${colors.bold}Harness error:${colors.reset}${colors.red} this check resolves ` +
        `babel-plugin-react-compiler at ${compiler.checkPath}, but babel-preset-expo (the real build) ` +
        `resolves ${compiler.expoPath}. Align the root devDependency with the version Expo uses.${colors.reset}`,
    );
    return 2;
  }

  const controlPath = path.join(root, CONTROL_RELATIVE_PATH);
  if (!fs.existsSync(controlPath)) {
    console.error(
      `${colors.red}Positive control file missing: ${CONTROL_RELATIVE_PATH}${colors.reset}`,
    );
    return 2;
  }
  if (isBailout(controlPath)) {
    console.error(
      `${colors.red}${colors.bold}Harness error:${colors.reset}${colors.red} positive control ` +
        `${CONTROL_RELATIVE_PATH} failed to compile through babel-plugin-react-compiler.${colors.reset}\n` +
        "This means the measurement harness itself is broken (wrong babel/plugin versions, " +
        "missing peer deps, a config change) — NOT that new components regressed. Fix the " +
        "harness before trusting this check.",
    );
    return 2;
  }

  const files = findClientSourceFiles(clientDir, root).sort();
  const currentBailouts = files.filter((f) => isBailout(path.join(root, f)));

  if (updateMode) {
    const written = writeBaseline(currentBailouts, baselineFile);
    console.log(
      `${colors.green}✓ baseline updated: ${written.length}/${files.length} files recorded as ` +
        `known React Compiler bailouts.${colors.reset}`,
    );
    return 0;
  }

  const loaded = loadBaseline(baselineFile);
  if (loaded.kind === "error") {
    console.error(`${colors.red}${loaded.message}${colors.reset}`);
    return 2;
  }

  const { newBailouts, fixed } = diffBailouts(currentBailouts, loaded.data);

  if (newBailouts.length > 0) {
    console.log(
      `${colors.bold}New React Compiler bailouts (not in the checked-in baseline):${colors.reset}\n`,
    );
    for (const f of newBailouts) {
      console.log(`  ${colors.cyan}${f}${colors.reset}`);
    }
    console.log(
      `\n${colors.red}${newBailouts.length} new bailout(s).${colors.reset} A component that used ` +
        "to compile through React Compiler no longer does — manual memoization is no longer " +
        "redundant for it. See docs/rules/performance.md and " +
        "docs/solutions/best-practices/react-compiler-memoization-audits-2026-06-10.md.\n" +
        "If this is intentional, or you fixed OTHER bailouts and are updating the baseline, run:\n" +
        `  ${colors.bold}node scripts/check-react-compiler-bailouts.js --update-baseline${colors.reset}\n`,
    );
    return 1;
  }

  if (fixed.length > 0) {
    console.log(
      `${colors.yellow}${fixed.length} file(s) in the baseline no longer bail out (fixed!). ` +
        `Run --update-baseline to shrink the baseline:${colors.reset}`,
    );
    for (const f of fixed) {
      console.log(`  ${f}`);
    }
    console.log();
  }

  console.log(
    `${colors.green}✓ React Compiler bailout check passed — ${currentBailouts.length}/${files.length} ` +
      `files are known bailouts (baseline), 0 new.${colors.reset}`,
  );
  return 0;
}

// Only run the CLI when invoked directly — importing this module (e.g. from
// the test suite) must not scan the real tree or call process.exit.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
