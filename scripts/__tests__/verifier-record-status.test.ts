import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "verifier-record-status.sh");

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

// Answers only the commit-list call, oldest first, as GitHub's pulls/{n}/commits does.
const FAKE_GH = `#!/usr/bin/env bash
case "$*" in
  *pulls/*/commits*)
    [ -n "\${FAKE_COMMITS_FAIL:-}" ] && { echo "fake-gh: commits failure" >&2; exit 1; }
    printf '%s\\n' "$FAKE_COMMITS"; exit 0 ;;
esac
echo "fake-gh: unrecognized invocation: $*" >&2
exit 1
`;

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

type Rec = Record<string, unknown> | string;

const PASS: Rec = {
  verdict: "pass",
  not_met: 0,
  criteria_edited: "no",
};

function run(
  commits: string[],
  records: Record<string, Rec>,
  env: Record<string, string> = {},
  args: string[] = ["123"],
) {
  const bin = mkdtempSync(join(tmpdir(), "vrs-bin-"));
  const root = mkdtempSync(join(tmpdir(), "vrs-root-"));
  dirs.push(bin, root);
  writeFileSync(join(bin, "gh"), FAKE_GH);
  chmodSync(join(bin, "gh"), 0o755);
  for (const [sha, rec] of Object.entries(records)) {
    const dir = join(root, sha, "verifier");
    mkdirSync(dir, { recursive: true });
    const body =
      typeof rec === "string"
        ? rec
        : JSON.stringify({
            head_sha: sha,
            agent_type: "todo-verifier",
            ...rec,
          });
    writeFileSync(join(dir, "todo-verifier.json"), body);
  }
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      REVIEW_STAMP_ROOT: root,
      FAKE_COMMITS: commits.join("\n"),
      ...env,
    },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("verifier-record-status.sh", () => {
  it("passes when the PR's only commit has a passing record", () => {
    const r = run([A], { [A]: PASS });
    expect(r.status).toBe(0);
    expect(r.out).toContain(`sha=${A}`);
    expect(r.out).toContain("later_commits=0");
  });

  it("accepts verdict none (a todo with no criteria)", () => {
    const r = run([A], { [A]: { ...PASS, verdict: "none" } });
    expect(r.status).toBe(0);
  });

  it("holds when no commit has a record", () => {
    const r = run([A, B], {});
    expect(r.status).toBe(1);
    expect(r.out).toContain("verifier=none");
  });

  it("the newest recorded commit governs: a later fail beats an earlier pass", () => {
    const r = run([A, B], {
      [A]: PASS,
      [B]: { ...PASS, verdict: "fail", not_met: 1 },
    });
    expect(r.status).toBe(1);
    expect(r.out).toContain(`sha=${B}`);
  });

  it("the newest recorded commit governs: a fix verified after a fail passes", () => {
    const r = run([A, B], {
      [A]: { ...PASS, verdict: "fail", not_met: 1 },
      [B]: PASS,
    });
    expect(r.status).toBe(0);
  });

  it("passes with unrecorded commits after the verified one, and counts them", () => {
    const r = run([A, B, C], { [A]: PASS });
    expect(r.status).toBe(0);
    expect(r.out).toContain("later_commits=2");
  });

  it.each([
    ["a pass with not_met above 0", { ...PASS, not_met: 1 }],
    ["a pass with criteria edited", { ...PASS, criteria_edited: "yes" }],
    [
      "a pass with no counts",
      { verdict: "pass", not_met: null, criteria_edited: "no" },
    ],
    [
      "a pass with no criteria_edited",
      { verdict: "pass", not_met: 0, criteria_edited: null },
    ],
    ["a fail", { ...PASS, verdict: "fail" }],
    ["an unreadable record", "{ truncated"],
    ["a record naming another sha", { ...PASS, head_sha: C }],
  ] as [string, Rec][])("holds on %s", (_name, rec) => {
    const r = run([A], { [A]: rec });
    expect(r.status).toBe(1);
  });

  it("an unreadable newest record holds even when an older one passes", () => {
    const r = run([A, B], { [A]: PASS, [B]: "" });
    expect(r.status).toBe(1);
  });

  it("errors (3) when gh cannot list the commits", () => {
    expect(run([A], { [A]: PASS }, { FAKE_COMMITS_FAIL: "1" }).status).toBe(3);
  });

  it("errors (3) on an empty commit list", () => {
    expect(run([], {}).status).toBe(3);
  });

  it("errors (3) when a commit line is not a full sha", () => {
    expect(run([A, "1234567"], { [A]: PASS }).status).toBe(3);
  });

  it("errors (2) on bad usage", () => {
    expect(run([A], {}, {}, ["abc"]).status).toBe(2);
    expect(run([A], {}, {}, []).status).toBe(2);
  });
});
