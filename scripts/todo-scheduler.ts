/**
 * Pure scheduling decision for the /todo skill's rolling dispatch model
 * (docs: .claude/skills/todo/SKILL.md, Phase 4).
 *
 * Given the current concurrency cap, what's already running, and a
 * priority-ordered queue of remaining todos, returns which queued item(s)
 * are eligible to dispatch right now — filling as many free slots as
 * possible without violating either invariant below. No filesystem/git/gh
 * access: pure data in, data out, so the orchestrator can call this on every
 * dispatch and on every completion instead of re-deriving eligibility from
 * prose each time.
 *
 * Invariants (see SKILL.md Phase 3 for how `tag` is assigned):
 *  - A "must-run-alone" item (DB-serial or unknown-scope) may only start
 *    when nothing else is running or already selected in this pass, and
 *    nothing else may start while one is running. This is a deliberate,
 *    strict reading — DB-serial exists to guard against a concurrent
 *    process reading half-migrated schema, not just against two DDL todos
 *    colliding with each other.
 *  - An "independent" item may start whenever a slot is free and its files
 *    don't overlap the combined file footprint of everything already
 *    running or selected this pass. The same-pass check is defense in
 *    depth: Phase 3 classification should already guarantee independent
 *    items are pairwise disjoint, but the scheduler must not compound a
 *    misclassification by dispatching both anyway.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type SchedulerTag = "independent" | "must-run-alone";

export interface QueueItem {
  id: string;
  files: string[];
  tag: SchedulerTag;
}

export interface RunningItem {
  id: string;
  files: string[];
  tag: SchedulerTag;
}

export interface SchedulerInput {
  cap: number;
  running: RunningItem[];
  queue: QueueItem[];
}

function overlaps(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bSet = new Set(b);
  return a.some((f) => bSet.has(f));
}

/**
 * CLI entry point: reads a {@link SchedulerInput} as JSON from stdin, writes
 * the dispatchable set as a JSON array to stdout. Returns a process exit
 * code rather than calling process.exit itself, so importing this module
 * (e.g. from the test suite) never has a side effect.
 */
export function main(): number {
  let raw: string;
  try {
    raw = readFileSync(0, "utf-8");
  } catch (err) {
    console.error(
      `todo-scheduler: failed to read stdin: ${(err as Error).message}`,
    );
    return 2;
  }

  let input: SchedulerInput;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    console.error(
      `todo-scheduler: invalid JSON on stdin: ${(err as Error).message}`,
    );
    return 2;
  }

  console.log(JSON.stringify(selectDispatchable(input)));
  return 0;
}

export function selectDispatchable(input: SchedulerInput): QueueItem[] {
  const { cap, running, queue } = input;

  if (running.some((r) => r.tag === "must-run-alone")) {
    return [];
  }

  const selected: QueueItem[] = [];
  const activeFiles: string[][] = running.map((r) => r.files);

  for (const candidate of queue) {
    const freeSlots = cap - running.length - selected.length;
    if (freeSlots <= 0) break;

    if (candidate.tag === "must-run-alone") {
      if (running.length === 0 && selected.length === 0) {
        return [candidate];
      }
      continue;
    }

    const conflicts = activeFiles.some((files) =>
      overlaps(files, candidate.files),
    );
    if (conflicts) continue;

    selected.push(candidate);
    activeFiles.push(candidate.files);
  }

  return selected;
}

// Only run the CLI when invoked directly — importing this module (e.g. from
// the test suite) must not read stdin or call process.exit.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main());
}
