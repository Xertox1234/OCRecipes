#!/usr/bin/env node
/**
 * check-claim-staleness.js — lint-staged check for CITATIONS WITH A SHELF LIFE.
 *
 * Two classes of comment/doc claim rot silently: they are true when written and false later,
 * without anyone editing the sentence. Both cost review rounds on PR #980.
 *
 *   POSITIONAL-REF  "two bullets up", "~150 lines above", "two paragraphs below" — a counted
 *                   offset into a list that grows by edit or by MERGE. #980 shipped one that
 *                   resolved to an unrelated bullet seven positions from its real referent,
 *                   in a file whose own idiom uses that phrasing literally.
 *   FROZEN-DIFF     A sentence asserting a git command's OUTPUT ("that diff is empty"). True
 *                   at the instant of writing and falsified by the next merge — #980 carried
 *                   one that its own merge falsified the same day.
 *
 * RATCHET: only lines a commit ADDS are checked. The tracked tree already carries ~21 legacy
 * positional refs; failing on those would block every unrelated edit to those files and the
 * check would be switched off within a day — the same over-denial failure this repo documents
 * for its outward-CLI guard. New text is held to the bar; old text is fixed when touched.
 * Pass --all to audit an entire file deliberately.
 *
 * WHY THERE IS NO "STALE SHA" RULE. An earlier draft flagged commit shas that resolve but are
 * not ancestors of HEAD, to catch #980's citation of an amended-away WIP. Measured against the
 * tracked tree it produced 20 hits, and sampling them showed they are SQUASH-MERGED branch
 * commits ("test(hooks): generate the corpus position axis…") — citing one is normal and useful
 * in a squash-merge repo, and is indistinguishable from a discarded WIP without heuristics that
 * cannot be validated cheaply. The rule was dropped rather than shipped noisy. The underlying
 * lesson — do not pin a measurement to a sha, state the re-measurement trigger — is what
 * FROZEN-DIFF actually enforces.
 *
 * ESCAPE HATCH: [staleness-ok] anywhere on the line. For text that discusses the pattern
 * itself, or a deliberate reference outside this history — not to silence a real one.
 *
 * Usage: node scripts/check-claim-staleness.js [--all] <file>...
 */

import fs from "fs";
import { execFileSync } from "child_process";

const ALLOW = "[staleness-ok]";

// A COUNTED offset. Bare directional words ("the check below") are deliberately not flagged:
// they degrade gracefully, while a count silently resolves to the wrong element.
const POSITIONAL =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:bullets?|lines?|paragraphs?|entries|sections?|items?)\s+(?:up|down|above|below|earlier|later)\b/i;

// A claim about what a git command PRINTS — a property of two moving trees, not of this file.
const GIT_CMD =
  /`[^`]*\bgit\s+(?:diff|log|rev-list|ls-tree|merge-base|status)\b[^`]*`/;
const EMPTINESS =
  /\bis\s+\*{0,2}empty\*{0,2}\b|\breturns?\s+(?:nothing|no\s+\w+)\b|\bprints?\s+nothing\b|\bshows?\s+nothing\b/i;

const RULES = [
  {
    name: "POSITIONAL-REF",
    test: (line) => POSITIONAL.test(line),
    fix: 'Name the referent ("the round-5 AXIS bullet") instead of counting offsets — a list that grows by merge outlives any number written into prose.',
  },
  {
    name: "FROZEN-DIFF",
    test: (line) => GIT_CMD.test(line) && EMPTINESS.test(line),
    fix: 'State the re-measurement TRIGGER ("re-run if <constant> changed"), not the output a command produced once.',
  },
];

/** Line numbers this commit ADDS to `file`, or null when the diff cannot be read. */
function addedLines(file) {
  let out;
  try {
    out = execFileSync("git", ["diff", "--cached", "-U0", "--", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // not a git context — caller decides
  }
  const added = new Set();
  let next = 0;
  for (const line of out.split("\n")) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      next = parseInt(h[1], 10);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) added.add(next++);
    else if (line.startsWith("-") || line.startsWith("---")) continue;
  }
  return added;
}

const argv = process.argv.slice(2);
const scanAll = argv.includes("--all");
const files = argv.filter((a) => a !== "--all");
if (files.length === 0) process.exit(0);

const problems = [];
for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue; // deleted in this commit
  }
  const added = scanAll ? null : addedLines(file);
  text.split("\n").forEach((line, i) => {
    const lineNo = i + 1;
    if (added && !added.has(lineNo)) return; // ratchet: untouched text is not this commit's problem
    if (line.includes(ALLOW)) return;
    for (const rule of RULES) {
      if (rule.test(line)) {
        problems.push({
          where: `${file}:${lineNo}`,
          rule: rule.name,
          detail: line.trim().slice(0, 110),
          fix: rule.fix,
        });
      }
    }
  });
}

if (problems.length > 0) {
  console.error(
    "\ncheck-claim-staleness: new text with a citation that will rot on its own\n",
  );
  for (const p of problems) {
    console.error(`  ${p.rule}  ${p.where}`);
    console.error(`    ${p.detail}`);
    console.error(`    fix: ${p.fix}\n`);
  }
  console.error(
    `${problems.length} problem(s) in ADDED lines. Add ${ALLOW} on the line only when the text is about this pattern itself.\n`,
  );
  process.exit(1);
}
