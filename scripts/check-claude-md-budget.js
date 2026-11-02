#!/usr/bin/env node
/**
 * CLAUDE.md Budget Advisory
 *
 * A CLAUDE.md loads in full into every session that starts at or below it (a
 * subdirectory one the first time Claude touches that directory), so every byte
 * is context paid on every task. Harness item 7 (2026-11-02) cut the root file
 * from 19.9 KB to ~6 KB; instruction files otherwise grow without bound because
 * appending is cheap and pruning is not (arXiv 2608.11095: +226% over a file's
 * life). Evidence and the admission test: docs/harness/2026-11-01-claude-md-research.md
 * and the HTML comment at the top of CLAUDE.md.
 *
 * Block HTML comments are not counted: Claude Code strips them before injecting
 * the file, so a "why this line exists" note costs no context.
 *
 * ADVISORY ONLY — always exits 0 (owner ruling 2026-11-02: warn, don't block; a
 * size cap is a preference, and the enforced set should stay small).
 *
 * Usage:
 *   node scripts/check-claude-md-budget.js [files...]   # lint-staged
 *   node scripts/check-claude-md-budget.js              # ./CLAUDE.md + server/CLAUDE.md
 */

import { Buffer } from "buffer";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ESC = "\x1b[";
const colors = {
  green: ESC + "32m",
  yellow: ESC + "33m",
  cyan: ESC + "36m",
  reset: ESC + "0m",
};

const BUDGET_BYTES = 10240;
const repoRoot = path.resolve(__dirname, "..");

function relPath(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).replace(/\\/g, "/");
}

// What Claude actually receives: block HTML comments removed.
function loadedBytes(text) {
  return Buffer.byteLength(text.replace(/<!--[\s\S]*?-->/g, ""), "utf8");
}

function main() {
  const args = process.argv.slice(2);
  const files = (
    args.length === 0
      ? [
          path.join(repoRoot, "CLAUDE.md"),
          path.join(repoRoot, "server", "CLAUDE.md"),
        ]
      : args.map((f) => path.resolve(f))
  ).filter((f) => path.basename(f) === "CLAUDE.md" && fs.existsSync(f));

  let over = 0;
  for (const filePath of files) {
    const bytes = loadedBytes(fs.readFileSync(filePath, "utf8"));
    if (bytes <= BUDGET_BYTES) continue;
    over++;
    console.log(`${colors.cyan}${relPath(filePath)}${colors.reset}`);
    console.log(
      `  ${colors.yellow}!${colors.reset} ${bytes} B loaded — over the ${BUDGET_BYTES} B budget. Not a failure. Keep only what Claude can't read from the repo (admission test at the top of CLAUDE.md); move procedures to skills or docs, and reasons into <!-- comments -->.`,
    );
  }
  if (over === 0) {
    console.log(
      `${colors.green}✓ CLAUDE.md within budget in ${files.length} file(s)${colors.reset}`,
    );
  }
  process.exit(0);
}

main();
