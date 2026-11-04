#!/usr/bin/env node
/**
 * Skill Positional-Parameter Guard
 *
 * The Claude Code skill loader substitutes `$0`–`$9` (and `$ARGUMENTS`) in a
 * SKILL.md body with the invocation's arguments BEFORE the model reads it —
 * inside code fences too. A shell function written as `w="$1"` therefore
 * renders as `w="unattended"`, and awk's `$0` as an empty string or the first
 * argument. In the /todo skill this turned `wt_in_use` (the worktree sweep's
 * "is anyone using this?" test) into "safe to remove" for every worktree
 * (rendered loads in sessions 9ca0bd2d and 14ef3823, 2026-10).
 *
 * Fix for a hit: move the shell into a script under `scripts/` and call it, or
 * pass the value through a named variable. Use `$ARGUMENTS` when you DO want
 * the invocation's arguments.
 * See docs/solutions/logic-errors/skill-argument-substitution-turns-awk-dollar-zero-into-an-empty-filter-2026-10-26.md
 *
 * Usage:
 *   node scripts/check-skill-positional-params.js [files...]   # lint-staged
 *   node scripts/check-skill-positional-params.js              # every .claude/skills/**\/SKILL.md
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

const repoRoot = path.resolve(__dirname, "..");
const POSITIONAL = /\$[0-9]/g;

function relPath(filePath) {
  return path.relative(repoRoot, path.resolve(filePath)).replace(/\\/g, "/");
}

function isInScope(filePath) {
  const rel = relPath(filePath);
  return rel.startsWith(".claude/skills/") && path.basename(rel) === "SKILL.md";
}

function findSkills(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findSkills(full));
    else if (entry.name === "SKILL.md") out.push(full);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const files =
    args.length === 0
      ? findSkills(path.join(repoRoot, ".claude", "skills"))
      : args
          .map((f) => path.resolve(f))
          .filter((f) => isInScope(f) && fs.existsSync(f));

  let hits = 0;
  for (const filePath of files) {
    const rel = relPath(filePath);
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    lines.forEach((line, i) => {
      const found = line.match(POSITIONAL);
      if (!found) return;
      hits++;
      console.log(
        `${colors.cyan}${rel}:${i + 1}${colors.reset} ${colors.red}✗${colors.reset} ${[...new Set(found)].join(", ")} — the skill loader replaces this with an invocation argument; move the shell into scripts/ or use a named variable`,
      );
      console.log(`    ${line.trim()}`);
    });
  }

  if (hits === 0) {
    console.log(
      `${colors.green}✓ no positional parameters in ${files.length} file(s)${colors.reset}`,
    );
    process.exit(0);
  }
  console.log(
    `\n${colors.bold}${colors.red}${hits} line(s) with $0–$9 in a SKILL.md${colors.reset}`,
  );
  process.exit(1);
}

main();
