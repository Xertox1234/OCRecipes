import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as path from "path";
import {
  selectDispatchable,
  validateSchedulerInput,
  type QueueItem,
  type RunningItem,
} from "../todo-scheduler";

const SCRIPT = path.resolve(__dirname, "..", "todo-scheduler.ts");

function runCli(input: string) {
  const result = spawnSync(process.execPath, ["--import=tsx", SCRIPT], {
    encoding: "utf8",
    input,
    timeout: 30_000,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function item(
  id: string,
  files: string[],
  tag: QueueItem["tag"] = "independent",
): QueueItem {
  return { id, files, tag };
}

describe("selectDispatchable", () => {
  it("returns nothing when the queue is empty", () => {
    const result = selectDispatchable({ cap: 4, running: [], queue: [] });
    expect(result).toEqual([]);
  });

  it("dispatches a single independent item when slots are free", () => {
    const queue = [item("A", ["client/a.tsx"])];

    const result = selectDispatchable({ cap: 4, running: [], queue });

    expect(result.map((i) => i.id)).toEqual(["A"]);
  });

  it("fills up to the cap in priority order, leaving the rest queued", () => {
    const queue = [
      item("A", ["a.ts"]),
      item("B", ["b.ts"]),
      item("C", ["c.ts"]),
      item("D", ["d.ts"]),
      item("E", ["e.ts"]),
    ];

    const result = selectDispatchable({ cap: 4, running: [], queue });

    expect(result.map((i) => i.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("returns nothing while a must-run-alone item is running", () => {
    const running: RunningItem[] = [
      { id: "X", files: ["shared/schema.ts"], tag: "must-run-alone" },
    ];
    const queue = [item("A", ["a.ts"])];

    const result = selectDispatchable({ cap: 4, running, queue });

    expect(result).toEqual([]);
  });

  it("dispatches only the must-run-alone item at the head of the queue, without filling remaining slots", () => {
    const queue = [
      item("A", [], "must-run-alone"),
      item("B", ["b.ts"]),
      item("C", ["c.ts"]),
    ];

    const result = selectDispatchable({ cap: 4, running: [], queue });

    expect(result.map((i) => i.id)).toEqual(["A"]);
  });

  it("skips a lower-priority must-run-alone item and fills slots with independent items ahead of it", () => {
    const queue = [
      item("A", ["a.ts"]),
      item("B", [], "must-run-alone"),
      item("C", ["c.ts"]),
    ];

    const result = selectDispatchable({ cap: 4, running: [], queue });

    expect(result.map((i) => i.id)).toEqual(["A", "C"]);
  });

  it("skips an independent item whose files overlap something already running", () => {
    const running: RunningItem[] = [
      { id: "X", files: ["shared/a.ts"], tag: "independent" },
    ];
    const queue = [item("A", ["shared/a.ts"]), item("B", ["b.ts"])];

    const result = selectDispatchable({ cap: 4, running, queue });

    expect(result.map((i) => i.id)).toEqual(["B"]);
  });

  it("skips an independent item whose files overlap another item already selected this pass", () => {
    // Defense in depth: Phase 3 classification should already guarantee
    // independent-tagged items are pairwise disjoint, but the scheduler
    // must not compound a misclassification by dispatching both concurrently.
    const queue = [
      item("A", ["shared/a.ts"]),
      item("B", ["shared/a.ts"]),
      item("C", ["c.ts"]),
    ];

    const result = selectDispatchable({ cap: 4, running: [], queue });

    expect(result.map((i) => i.id)).toEqual(["A", "C"]);
  });

  it("respects the cap when some slots are already occupied", () => {
    const running: RunningItem[] = [
      { id: "X", files: ["x.ts"], tag: "independent" },
      { id: "Y", files: ["y.ts"], tag: "independent" },
      { id: "Z", files: ["z.ts"], tag: "independent" },
    ];
    const queue = [item("A", ["a.ts"]), item("B", ["b.ts"])];

    const result = selectDispatchable({ cap: 4, running, queue });

    expect(result.map((i) => i.id)).toEqual(["A"]);
  });
});

describe("CLI", () => {
  it("reads scheduler input from stdin and prints the dispatchable set as JSON", () => {
    const input = JSON.stringify({
      cap: 4,
      running: [],
      queue: [item("A", ["a.ts"]), item("B", [], "must-run-alone")],
    });

    const result = runCli(input);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { id: "A", files: ["a.ts"], tag: "independent" },
    ]);
  });

  it("exits non-zero with a stderr message on invalid JSON", () => {
    const result = runCli("not json");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid JSON/i);
  });

  it("rejects an unrecognized tag instead of silently treating it as independent", () => {
    // Regression test: a typo'd tag (e.g. an underscore instead of a hyphen)
    // must never be dispatched — that would defeat the must-run-alone
    // invariant for exactly the DB-serial case it exists to protect.
    const input = JSON.stringify({
      cap: 4,
      running: [],
      queue: [
        {
          id: "db-migration",
          files: ["shared/schema.ts"],
          tag: "must_run_alone",
        },
      ],
    });

    const result = runCli(input);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/tag/i);
  });

  it("rejects a shape-invalid payload with a clean message instead of crashing", () => {
    const result = runCli("{}");

    expect(result.status).toBe(2);
    expect(result.stderr).not.toMatch(/TypeError/);
    expect(result.stderr).toMatch(/todo-scheduler:/);
  });
});

describe("validateSchedulerInput", () => {
  it("accepts a well-formed input", () => {
    const result = validateSchedulerInput({
      cap: 4,
      running: [],
      queue: [item("A", ["a.ts"])],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects a non-object payload", () => {
    const result = validateSchedulerInput("not an object");

    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric cap", () => {
    const result = validateSchedulerInput({ cap: "4", running: [], queue: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/cap/);
  });

  it("rejects a queue that isn't an array", () => {
    const result = validateSchedulerInput({
      cap: 4,
      running: [],
      queue: "nope",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/queue/);
  });

  it("rejects a queue item with a non-string id", () => {
    const result = validateSchedulerInput({
      cap: 4,
      running: [],
      queue: [{ id: 1, files: [], tag: "independent" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/id/);
  });

  it("rejects a queue item whose files is not an array of strings", () => {
    const result = validateSchedulerInput({
      cap: 4,
      running: [],
      queue: [{ id: "A", files: [1, 2], tag: "independent" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/files/);
  });

  it("rejects a queue item with an unrecognized tag", () => {
    const result = validateSchedulerInput({
      cap: 4,
      running: [],
      queue: [{ id: "A", files: [], tag: "sometimes" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tag/);
  });
});
