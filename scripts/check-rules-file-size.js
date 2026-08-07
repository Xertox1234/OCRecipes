#!/usr/bin/env node
/**
 * Rules File Size Guard
 *
 * docs/rules/*.md are embedded WHOLE by .claude/hooks/inject-patterns.sh into
 * the PreToolUse additionalContext before every Edit/Write — file size is
 * context cost paid on every edit in that domain, and a file too large to fit
 * beside the DISCIPLINE preamble forces the spill/truncation path on every
 * first-touch edit (the 2026-07 deferral mechanism cannot shrink the FIRST
 * domain). Budget derivation: THRESHOLD 9000 − preamble ~1,290 − block header
 * + solution refs ~840 ≈ 6,850 max rules bytes for a single-domain first
 * touch to land inline; capped at 6,500 for margin.
 *
 * TWO thresholds:
 *   WARN_BYTES 5,700 — advisory only, still exits 0. Prints remaining headroom.
 *   MAX_BYTES  6,500 — hard failure.
 * The advisory exists because the cap alone is a wall: a file sits under it for
 * months, then one codification lands on 6,501 B and the author must stop and
 * run a whole trim. Three such trims happened in three months.
 *
 * The fix for an over-cap file is CONSOLIDATION, not deletion — rule families
 * restating shared exceptions are the dominant bloat mechanism. Precedent:
 * accessibility.md 6,547 → 4,582 B with zero binding rules lost (PR #492), and
 * security.md 6,491 → 5,698 B / accessibility.md 6,479 → 5,694 B (PR #776).
 * NOTE: moving detail out of a rules file into a per-bullet CITATION is a
 * reachability downgrade — a rules file is embedded whole on every domain edit,
 * while a solution must win one of ~4 date-ranked slots. Compress a bullet only
 * when the imperative left behind is actionable on its own.
 * See docs/solutions/conventions/rules-files-stay-terse-for-inline-injection-budget-2026-06-05.md
 *
 * Usage:
 *   node scripts/check-rules-file-size.js [files...]   # lint-staged
 *   node scripts/check-rules-file-size.js              # whole docs/rules/
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
  yellow: ESC + "33m",
  cyan: ESC + "36m",
  reset: ESC + "0m",
  bold: ESC + "1m",
};

const MAX_BYTES = 6500;

// Advisory threshold. Above this a file still PASSES — it only prints how much
// headroom is left. The cap alone is a wall: a file sits comfortably under it
// for months, then one codification pass lands on 6,501 B and the author has to
// stop and run a whole trim. Three such trims happened in three months
// (accessibility.md twice, security.md twice), because codification adds and
// nothing prunes. The advisory turns that wall into a gradient, so the trim
// happens in small increments while the person still has the context.
// Deliberately non-failing: a warning that fails the build is just a second
// wall 800 B earlier.
const WARN_BYTES = 5700;

// Files already over the cap when the guard landed get a FROZEN cap just above
// their current size — they may shrink but not grow. Add an entry only for a
// genuinely over-cap file that cannot be trimmed immediately; remove it once the
// file is trimmed under MAX_BYTES. Currently empty (all rules files fit the cap).
const GRANDFATHERED = new Map();

function relPath(filePath) {
  const repoRoot = path.resolve(__dirname, "..");
  return path.relative(repoRoot, path.resolve(filePath)).replace(/\\/g, "/");
}

function isInScope(filePath) {
  const rel = relPath(filePath);
  return rel.startsWith("docs/rules/") && rel.endsWith(".md");
}

function main() {
  const args = process.argv.slice(2);
  const rulesDir = path.resolve(__dirname, "..", "docs", "rules");
  const files =
    args.length === 0
      ? fs
          .readdirSync(rulesDir)
          .filter((f) => f.endsWith(".md"))
          .map((f) => path.join(rulesDir, f))
      : args
          .map((f) => path.resolve(f))
          .filter((f) => isInScope(f) && fs.existsSync(f));

  let failures = 0;
  let advisories = 0;
  for (const filePath of files) {
    const rel = relPath(filePath);
    const bytes = fs.statSync(filePath).size;
    const cap = GRANDFATHERED.get(rel) ?? MAX_BYTES;
    if (bytes > cap) {
      failures++;
      console.log(`${colors.cyan}${rel}${colors.reset}`);
      console.log(
        `  ${colors.red}✗${colors.reset} ${bytes} B exceeds the ${cap} B cap — this file is injected WHOLE before every edit in its domain; consolidate repeated exceptions (see the header of this script)`,
      );
    } else if (bytes > WARN_BYTES) {
      advisories++;
      console.log(`${colors.cyan}${rel}${colors.reset}`);
      console.log(
        `  ${colors.yellow}!${colors.reset} ${bytes} B — approaching the ${cap} B cap, ${cap - bytes} B left. Not a failure. Trim now while you have the context: consolidate bullets that restate a shared exception, and move rationale into a docs/solutions/ file the bullet cites — keeping every binding imperative here.`,
      );
    }
  }

  if (failures === 0) {
    console.log(
      `${colors.green}✓ rules file sizes OK in ${files.length} file(s)${colors.reset}` +
        (advisories > 0
          ? ` ${colors.yellow}(${advisories} approaching the cap)${colors.reset}`
          : ""),
    );
    process.exit(0);
  }
  console.log(
    `\n${colors.bold}${colors.red}${failures} rules file(s) exceed the injection size cap${colors.reset}`,
  );
  process.exit(1);
}

main();
