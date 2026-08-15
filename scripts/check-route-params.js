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
 * Form 1 — an inline object literal as the ParamList argument to `RouteProp`.
 *
 * The `\s*` is load-bearing, not defensive tidiness. Prettier owns formatting
 * in this repo, so the construct may already be committed wrapped:
 *
 *   useRoute<
 *     RouteProp<
 *       { params: SomeLongerAliasName },
 *       "params"
 *     >
 *   >();
 *
 * A bare `RouteProp<{` literal match passes that silently. This is not a
 * hypothetical: `ItemDetailScreen` was committed in exactly that shape and
 * escaped BOTH greps used to bound the defect class (see the 2026-08-15
 * conventions doc in `## Prevention` below).
 *
 * Note the ordering is NOT guaranteed either way — `prettier --write` sits in
 * the `*.{ts,tsx}` lint-staged entry while this check sits in
 * `client/**\/*.{ts,tsx}`, and lint-staged runs separate glob entries
 * concurrently. The regex must therefore tolerate both forms on its own merits
 * rather than relying on running after the formatter.
 */
const INLINE_PARAMLIST = /RouteProp\s*<\s*\{/g;

/**
 * Form 2 — a NAMED local alias as the ParamList argument:
 *
 *   type LocalParams = { LabelAnalysis: { imageUri: string } };
 *   type ScreenRoute = RouteProp<LocalParams, "LabelAnalysis">;
 *
 * Semantically identical to form 1 and equally invisible to `tsc`, but a
 * two-line extract-variable refactor walks straight past a form-1-only rule.
 *
 * (Note the alias must be keyed BY ROUTE NAME — `RouteProp<P, "X">` resolves to
 * `P["X"]`, and `ParamListBase` is `Record<string, object | undefined>`, so a
 * flat `{ imageUri: string }` is a TS2344 and could never be committed.)
 *
 * The discriminator is `export`: every canonical ParamList in this repo is
 * declared `export type <Name>ParamList = {` in its navigator module, so an
 * EXPORTED object-literal alias is a source of truth and an unexported one is
 * a shadow.
 *
 * That is implemented literally — capture group 1 collects the declaration's
 * leading modifiers and the caller skips the alias when `export` is among them.
 * Two earlier revisions got this wrong in ways worth recording, because both
 * looked right:
 *
 *   - A `(?!export\b)` lookahead in front of the literal `type` was DEAD CODE.
 *     `[ \t]*` cannot consume `export`, so wherever the literal `type` matches,
 *     the text there cannot also be `export…` — the lookahead could never reject
 *     anything the literal did not already reject.
 *   - Relying on the bare `^[ \t]*type` anchor instead made the rule POSITIONAL,
 *     not semantic: it excluded every declaration with any leading token, so
 *     `declare type P = { … }` — valid, committable TypeScript — silently passed.
 *     Only `export` was ever meant to be excused.
 *
 * KNOWN RESIDUALS — shapes this scanner does NOT catch. Listed because the
 * paired conventions doc is specifically about not overclaiming what a scan
 * proves. This list is what has been *considered*; it is not itself a proof of
 * exhaustiveness:
 *
 *   1. Anything that breaks the literal `type <Name> = {` adjacency this pattern
 *      requires. Two distinct mechanisms, both evading:
 *        a. a type-parameter list between the name and `=` — `type P<T> = { … }`,
 *           and note it evades even when the parameter is unused and the RHS is a
 *           plain object literal (`type P<Unused = void> = { … }`), so the cause is
 *           the adjacency, NOT the RHS shape;
 *        b. a non-object-literal RHS — `type P = Readonly<{ … }>`, `type P = { … } & T`.
 *      Deliberately not chased: skipping a generic parameter list textually needs
 *      something like `(?:\s*<[^{]*>)?`, which itself breaks on a constraint
 *      containing braces (`<T extends { x: string }>`). That trade buys little and
 *      adds a new wrong case.
 *   2. An exported alias inside a screen: `export type P = { … }` — indistinguishable
 *      here from a navigator's own canonical declaration.
 *   3. A shadow declared in ANOTHER module and imported. Unreachable in principle
 *      for a single-file text scanner, and the natural next mutation of the bug
 *      this rule was written for ("extract to a shared file").
 *   4. A same-line comment before the declaration (`/* x *\/ type P = { … }`),
 *      which defeats the line anchor. Pathological rather than plausible, unlike
 *      `declare`, which is why that one is matched rather than listed.
 *
 * An `interface`-based shadow is NOT in this list: interfaces get no implicit
 * index signature, so `tsc` rejects them against `ParamListBase` and the
 * compiler is already the authority there.
 */
const LOCAL_OBJECT_ALIAS =
  /^[ \t]*((?:(?:export|declare)[ \t]+)*)type\s+([A-Za-z_$][\w$]*)\s*=\s*\{/gm;
const ROUTEPROP_NAMED_ARG = /RouteProp\s*<\s*([A-Za-z_$][\w$]*)\s*,/g;

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

/** 1-indexed line number for a match offset. Regexes here can span newlines. */
function lineAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

/**
 * Returns one `{ line, detail }` entry per shadowed ParamList, covering both
 * forms: an inline object literal, and a named local (unexported)
 * object-literal alias passed as the ParamList argument.
 */
function findViolations(content) {
  const violations = [];
  let match;

  INLINE_PARAMLIST.lastIndex = 0;
  while ((match = INLINE_PARAMLIST.exec(content)) !== null) {
    violations.push({
      line: lineAt(content, match.index),
      detail: "an inline object literal",
    });
  }

  // Collect the file's unexported object-literal type aliases first, then flag
  // any RouteProp whose ParamList argument names one of them.
  const localAliases = new Set();
  LOCAL_OBJECT_ALIAS.lastIndex = 0;
  while ((match = LOCAL_OBJECT_ALIAS.exec(content)) !== null) {
    // Group 1 is the declaration's leading modifiers. `export` means this is a
    // canonical ParamList (every navigator declares its own that way), so it is
    // a source of truth, not a shadow. Anything else — bare, or `declare` — is
    // local to this file and shadows whatever the navigator says.
    if (/\bexport\b/.test(match[1])) continue;
    localAliases.add(match[2]);
  }

  if (localAliases.size > 0) {
    ROUTEPROP_NAMED_ARG.lastIndex = 0;
    while ((match = ROUTEPROP_NAMED_ARG.exec(content)) !== null) {
      if (localAliases.has(match[1])) {
        violations.push({
          line: lineAt(content, match.index),
          detail: `the local type alias \`${match[1]}\``,
        });
      }
    }
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
    for (const { line, detail } of findViolations(content)) {
      failures.push({ filePath, line, detail });
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
        `${colors.green}✓ No route-param shadows in ${filesChecked} file${
          filesChecked === 1 ? "" : "s"
        }${colors.reset}`,
      );
    }
    process.exit(0);
  }

  console.log(
    `${colors.bold}Local route params shadow the navigator:${colors.reset}\n`,
  );
  for (const { filePath, line, detail } of failures) {
    console.log(
      `${colors.cyan}${filePath}:${line}${colors.reset}: RouteProp takes ${detail} instead of indexing RootStackParamList`,
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
