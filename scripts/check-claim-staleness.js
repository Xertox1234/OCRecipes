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
 * RATCHET: only lines a commit ADDS are checked. The tracked tree carries 30 legacy findings
 * (29 POSITIONAL-REF + 1 FROZEN-DIFF) across the 944 files this check's glob really selects,
 * measured by running this script with --all over a micromatch expansion of that glob -- NOT
 * with git's own pathspec, which treats `**` literally and silently omits every top-level
 * .claude/hooks/*.sh. An earlier revision of this comment said "~21" from that narrower
 * accidental scope: a count quoted without the corpus that produced it, in the very file
 * written to catch that. Failing on those would block every unrelated edit to those files and the
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
// ANCHORED at the text immediately after the command, so the emptiness must be the
// command's OWN predicate. A bare proximity window cannot tell "`git log` is empty" from
// "`git log` shows the cache is empty", where an intervening noun owns the emptiness.
// A PREPOSITIONAL qualifier of the command ("on `file`", "against main") may sit between the
// command and its predicate -- it narrows what was run, it does not introduce a new subject.
// An intervening SUBJECT ("the cache", "the upload queue") does, and that is the whole
// discrimination. Dropping the qualifier was measured: it lost the tree's one genuine hit,
// `` `git diff` on `guard-outward-cli.sh` is empty ``.
const EMPTINESS_PREDICATE =
  /^[\s,:;.—-]*(?:(?:on|for|against|in|over|between|at|from|of)\s+(?:`[^`]*`|[^\s`]+)\s*)*(?:is|was|were|are|returns?|printed?|prints?|shows?|outputs?|yields?|comes? back)\s+\*{0,2}(?:empty|nothing|no\s+\w+)\*{0,2}/i;

const RULES = [
  {
    name: "POSITIONAL-REF",
    test: (line) => POSITIONAL.test(line),
    fix: 'Name the referent ("the round-5 AXIS bullet") instead of counting offsets — a list that grows by merge outlives any number written into prose.',
  },
  {
    name: "FROZEN-DIFF",
    // PREDICATION, not proximity, and not co-occurrence. Each weaker test was tried and
    // each admitted a class of false positive:
    //   co-occurrence (the two patterns anywhere on one line) fires on
    //     `run \`npm run build\`; the cache is empty, then check \`git status\``
    //     -- the emptiness describes a build cache and no command's output at all;
    //   a 40-character window AFTER the command closes that one but still fires on
    //     `run \`git log\` shows the cache is empty` and
    //     `after \`git status\` the upload queue returns nothing`
    //     -- both measured, both false, both inside the window. Raw character distance
    //     cannot tell whose emptiness it is.
    // The claim this rule exists for reads "<git command> is empty", where the emptiness
    // verb is the command's OWN predicate, so the test anchors at the first character after
    // the closing backtick and allows only punctuation before the verb. An intervening noun
    // phrase ("the cache", "the upload queue") is what distinguishes the false positives, and
    // anchoring is what sees it.
    // A pre-posed spelling ("that diff is empty: \`git diff ...\`") remains a deliberate
    // false negative: a narrow rule that fires truthfully beats a broad one that gets
    // switched off, which is this repo's standing lesson about over-denying guards.
    test: (line) => {
      const m = GIT_CMD.exec(line);
      if (!m) return false;
      return EMPTINESS_PREDICATE.test(line.slice(m.index + m[0].length));
    },
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
  let inHunk = false;
  for (const line of out.split("\n")) {
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      next = parseInt(h[1], 10);
      inHunk = true;
      continue;
    }
    // Everything before the first @@ is preamble ("diff --git", "index", "--- a/f",
    // "+++ b/f"). Testing a BODY line for a "+++" prefix mistakes a content line that
    // happens to begin with "++" for the file header, which both drops that line from
    // coverage AND stops the counter advancing, mis-numbering every later addition in
    // the same hunk. Position, not spelling, separates a header from content -- and the
    // glob this check covers is dense with prose quoting diff syntax verbatim.
    if (!inHunk) continue;
    const marker = line[0];
    if (marker === "+") added.add(next++);
    else if (marker === " ") next++; // a context line advances the new-side number
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
