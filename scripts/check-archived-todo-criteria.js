#!/usr/bin/env node
/**
 * check-archived-todo-criteria.js — lint-staged check for todos/archive/*.md.
 *
 * An archived todo with `status: done` must account for every acceptance criterion: each box
 * is ticked (`- [x]`), or the `## Updates` section says why it is not, in one of these forms
 * (N = the criterion's 1-based position in `## Acceptance Criteria`):
 *
 *   Criterion N not met: <reason>
 *   Criterion N needs a person: <what to check>
 *   Criterion N moved to <todo path>
 *
 * The reason lives in Updates, never on the bullet, so the criterion's own text stays exactly as
 * written (the todo-verifier compares it with the base version). This checks bookkeeping only:
 * a declared "not met" passes here, and holding its PR is the todo-verifier's job.
 *
 * Measured 2026-11-17 in a pilot of 5 merged /todo PRs: 2 archived todos said `done` with every
 * box still unticked. Only staged files are checked, so older archives are left as they are.
 *
 * Usage: node scripts/check-archived-todo-criteria.js <file>...   (exit 1 on any finding)
 */
import { readFileSync } from "node:fs";

const REASON = /criterion\s+(\d+)\s+(not met|needs a person|moved to)\b/gi;

function section(lines, heading) {
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

/** The criteria's tick states, in order. Bullets inside a code fence are examples. */
function criteria(lines) {
  const out = [];
  let fenced = false;
  for (const line of section(lines, "## Acceptance Criteria")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^- \[([ xX])\] /.exec(line);
    if (m) out.push(m[1] !== " ");
  }
  return out;
}

function check(file) {
  if (!file.replace(/\\/g, "/").includes("todos/archive/")) return [];
  const text = readFileSync(file, "utf8");
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  if (!/^status:\s*done\s*$/m.test(front)) return [];
  const lines = text.split("\n");
  const explained = new Set(
    [...section(lines, "## Updates").join("\n").matchAll(REASON)].map((m) =>
      Number(m[1]),
    ),
  );
  return criteria(lines)
    .map((ticked, i) => ({ ticked, n: i + 1 }))
    .filter(({ ticked, n }) => !ticked && !explained.has(n))
    .map(
      ({ n }) =>
        `${file}: criterion ${n} is unticked and Updates has no "Criterion ${n} not met: …", "needs a person: …" or "moved to …" line`,
    );
}

const findings = process.argv.slice(2).flatMap(check);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  console.error(
    "\nA done todo must tick each met criterion, or explain the unticked one in ## Updates (see todos/README.md → Archiving).",
  );
  process.exit(1);
}
