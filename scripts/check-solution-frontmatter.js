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

/**
 * Tag patterns that make a doc REACHABLE by the inject hook.
 *
 * `solutions_from_markdown()` (.claude/hooks/inject-patterns.sh) builds its
 * candidate pool with `grep -rlE "^tags:.*<pattern>"` BEFORE partitioning by
 * `applies_to`. A doc matching no pattern is excluded from every domain's pool,
 * so it can never be injected for any file — `applies_to` cannot rescue it.
 * The failure is silent in both directions: no error, no warning, the doc just
 * never appears.
 *
 * Mirrors `domain_tag_pattern()` in the hook: a literal `\b<domain>\b` for each
 * of the 14 rules-domains, plus two alternations. Keep in sync — the per-domain
 * acceptance cases in scripts/__tests__/check-solution-frontmatter.test.ts are
 * driven by RULES_DOMAINS and go red if a domain is added here without a tag
 * pattern.
 */
const ROUTABLE_TAG_PATTERNS = [
  ["accessibility", /\baccessibility\b/],
  // ai-prompting is an alternation: any bare `ai` or `ai-*` tag routes.
  ["ai-prompting", /\bai(-[a-z]+)?\b/],
  ["api", /\bapi\b/],
  ["architecture", /\barchitecture\b/],
  ["client-state", /\bclient-state\b/],
  ["database", /\bdatabase\b/],
  ["design-system", /\bdesign-system\b/],
  // harness is an alternation: the corpus predates the domain, so these
  // synonyms are what make it reachable.
  ["harness", /\b(harness|tooling|pg-lab|worktree|agents)\b/],
  ["hooks", /\bhooks\b/],
  ["performance", /\bperformance\b/],
  ["react-native", /\breact-native\b/],
  ["security", /\bsecurity\b/],
  ["testing", /\btesting\b/],
  ["typescript", /\btypescript\b/],
];

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
  // A wrapped array leaves the key with an EMPTY value, which the loop above
  // skips — so the block form slipped past the very guard written to catch it.
  // Detect it by its continuation lines instead.
  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i].match(/^(tags|applies_to|symptoms):[ \t]*$/);
    if (m && /^[ \t]+-[ \t]/.test(lines[i + 1] ?? "")) {
      problems.push(
        `'${m[1]}:' must be a SINGLE-LINE inline-flow array ([a, b, c]) — a wrapped array is invisible to the '^${m[1]}:' grep`,
      );
    }
  }
  // Routing reachability — see ROUTABLE_TAG_PATTERNS. Only meaningful once
  // 'tags:' exists at all; a missing key is already reported above.
  const tagsValue = fm.get("tags");
  if (tagsValue) {
    const reachable = ROUTABLE_TAG_PATTERNS.some(([, re]) =>
      re.test(tagsValue),
    );
    if (!reachable) {
      problems.push(
        `'tags:' matches no routed domain, so this doc NEVER injects — the hook greps '^tags:.*<domain>' to build each domain's pool BEFORE applies_to is consulted, so applies_to cannot rescue it. Add the domain(s) your applies_to paths route to; check with: npx tsx scripts/lib/path-domains.ts <a path this doc covers>. Valid: ${ROUTABLE_TAG_PATTERNS.map(([d]) => d).join(", ")} (harness also accepts tooling|pg-lab|worktree|agents; ai-prompting accepts any ai-* tag)`,
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
