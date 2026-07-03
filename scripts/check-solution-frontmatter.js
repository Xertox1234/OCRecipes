#!/usr/bin/env node
/**
 * Solution Frontmatter Checker
 *
 * Enforces the retrieval-critical format invariants of the canonical
 * docs/solutions/ corpus. Since the 2026-07 markdown-canonical cutover,
 * line-anchored greps are the ONLY retrieval mechanism (inject-patterns.sh
 * `^tags:` matching, session-recent-issues.sh frontmatter awk) — a file that
 * violates these invariants is silently invisible to pattern injection and
 * the session digest, with no error anywhere. This check is the write-time
 * replacement for the retired solutions-db ingest validation.
 *
 * Checks (per docs/solutions/README.md schema):
 *   1. Frontmatter opens on line 1 and closes.
 *   2. Required keys: title, track, category, tags, module, created
 *      (bug-track additionally: severity, symptoms).
 *   3. tags / applies_to / symptoms are SINGLE-LINE inline-flow arrays
 *      ([a, b, c]) — a wrapped array defeats the `^tags:.*<tag>` grep.
 *   4. created is an ISO date (YYYY-MM-DD, optionally quoted).
 *   5. category matches the parent directory name.
 *   6. Filename carries the -YYYY-MM-DD.md suffix (newest-first injection
 *      sorts by it); 4 pre-2026-05-12 legacy files are grandfathered.
 *   7. No column-0 `tags:`/`applies_to:` line in the BODY — the inject grep
 *      is not frontmatter-scoped, so a column-0 example line acts as a decoy
 *      (indent quoted frontmatter examples by one space).
 *
 * Usage:
 *   node scripts/check-solution-frontmatter.js [files...]   # lint-staged
 *   node scripts/check-solution-frontmatter.js              # whole corpus
 */

import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ESC = "\x1b[";
const colors = {
  red: ESC + "31m",
  green: ESC + "32m",
  cyan: ESC + "36m",
  reset: ESC + "0m",
  bold: ESC + "1m",
};

// Pre-2026-05-12 files predate the dated-filename convention and carry many
// inbound cross-links — grandfathered (see docs/solutions/README.md).
const LEGACY_DATELESS = new Set([
  "docs/solutions/logic-errors/useeffect-cleanup-memory-leak.md",
  "docs/solutions/logic-errors/stale-closure-callback-refs.md",
  "docs/solutions/code-quality/react-native-style-typing.md",
  "docs/solutions/runtime-errors/unsafe-type-cast-zod-validation.md",
]);

const REQUIRED_KEYS = [
  "title",
  "track",
  "category",
  "tags",
  "module",
  "created",
];
const BUG_REQUIRED_KEYS = ["severity", "symptoms"];
const INLINE_FLOW_KEYS = ["tags", "applies_to", "symptoms"];

/** Repo-relative POSIX path for a (possibly absolute) input path. */
function relPath(filePath) {
  const repoRoot = path.resolve(__dirname, "..");
  return path.relative(repoRoot, path.resolve(filePath)).replace(/\\/g, "/");
}

function isInScope(filePath) {
  const rel = relPath(filePath);
  if (!rel.startsWith("docs/solutions/") || !rel.endsWith(".md")) return false;
  if (rel === "docs/solutions/README.md") return false;
  if (rel.includes("/_manifests/")) return false;
  return true;
}

/** Returns an array of problem strings for one file (empty = clean). */
function checkFile(filePath) {
  const rel = relPath(filePath);
  const problems = [];
  const lines = fs.readFileSync(filePath, "utf8").split("\n");

  if (lines[0].trim() !== "---") {
    return [`frontmatter must open with '---' on line 1`];
  }
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (closeIdx === -1) {
    return [`frontmatter never closes (no second '---')`];
  }

  const fm = new Map();
  for (const line of lines.slice(1, closeIdx)) {
    const m = line.match(/^([a-z_]+):[ \t]*(.*)$/);
    if (m) fm.set(m[1], m[2].trim());
  }

  for (const key of REQUIRED_KEYS) {
    if (!fm.has(key) || fm.get(key) === "")
      problems.push(`missing required frontmatter key '${key}:'`);
  }
  const track = fm.get("track");
  if (track && track !== "bug" && track !== "knowledge") {
    problems.push(`track must be 'bug' or 'knowledge' (got '${track}')`);
  }
  if (track === "bug") {
    for (const key of BUG_REQUIRED_KEYS) {
      if (!fm.has(key) || fm.get(key) === "")
        problems.push(`bug-track requires '${key}:'`);
    }
  }
  for (const key of INLINE_FLOW_KEYS) {
    if (fm.has(key) && fm.get(key) !== "" && !/^\[.*\]$/.test(fm.get(key))) {
      problems.push(
        `'${key}:' must be a SINGLE-LINE inline-flow array ([a, b, c]) — a wrapped array is invisible to the '^${key}:' grep`,
      );
    }
  }
  const created = fm.get("created");
  if (created && !/^'?\d{4}-\d{2}-\d{2}'?$/.test(created)) {
    problems.push(`created must be an ISO date YYYY-MM-DD (got '${created}')`);
  }
  const category = fm.get("category");
  const parentDir = path.basename(path.dirname(filePath));
  if (category && category !== parentDir) {
    problems.push(
      `category '${category}' does not match parent directory '${parentDir}/'`,
    );
  }
  if (!/-\d{4}-\d{2}-\d{2}\.md$/.test(rel) && !LEGACY_DATELESS.has(rel)) {
    problems.push(
      `filename must end with -YYYY-MM-DD.md (newest-first injection sorts by it)`,
    );
  }
  for (let i = closeIdx + 1; i < lines.length; i++) {
    if (/^(tags|applies_to):/.test(lines[i])) {
      problems.push(
        `line ${i + 1}: column-0 '${lines[i].split(":")[0]}:' in the body decoys the inject grep — indent the example by one space`,
      );
    }
  }
  return problems;
}

function findCorpusFiles(dir) {
  const results = [];
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isInScope(full)) results.push(full);
    }
  }
  walk(dir);
  return results;
}

function main() {
  const args = process.argv.slice(2);
  const files =
    args.length === 0
      ? findCorpusFiles(path.resolve(__dirname, "..", "docs", "solutions"))
      : args
          .map((f) => path.resolve(f))
          .filter((f) => isInScope(f) && fs.existsSync(f));

  let failures = 0;
  for (const filePath of files) {
    const problems = checkFile(filePath);
    if (problems.length > 0) {
      failures++;
      console.log(`${colors.cyan}${relPath(filePath)}${colors.reset}`);
      for (const p of problems)
        console.log(`  ${colors.red}✗${colors.reset} ${p}`);
    }
  }

  if (failures === 0) {
    console.log(
      `${colors.green}✓ solution frontmatter OK in ${files.length} file(s)${colors.reset}`,
    );
    process.exit(0);
  }
  console.log(
    `\n${colors.bold}${colors.red}${failures} solution file(s) violate the frontmatter contract${colors.reset} — schema: docs/solutions/README.md`,
  );
  process.exit(1);
}

main();
