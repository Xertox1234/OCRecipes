import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

const script = path.resolve(__dirname, "..", "check-archived-todo-criteria.js");
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

function todo(opts: {
  status?: string;
  criteria: string;
  updates?: string;
}): string {
  return [
    "---",
    "title: Example",
    `status: ${opts.status ?? "done"}`,
    "priority: low",
    "---",
    "",
    "## Acceptance Criteria",
    "",
    opts.criteria,
    "",
    "## Implementation Notes",
    "",
    "- note",
    "",
    "## Updates",
    "",
    "### 2026-11-17",
    "",
    opts.updates ?? "- Done",
    "",
  ].join("\n");
}

// Writes fixtures under <tmp>/todos/archive/ so the script's path filter applies.
function run(files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "ac-check-")),
  );
  tmpDirs.push(root);
  const paths = Object.entries(files).map(([rel, content]) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    return p;
  });
  const r = spawnSync("node", [script, ...paths], {
    encoding: "utf8",
    cwd: root,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const A = "todos/archive/P3-2026-11-17-example.md";

describe("check-archived-todo-criteria", () => {
  it("passes a done todo whose criteria are all ticked", () => {
    const r = run({ [A]: todo({ criteria: "- [x] One\n- [x] Two" }) });
    expect(r.code).toBe(0);
  });

  it("fails a done todo with an unticked criterion and no reason, naming its number", () => {
    const r = run({ [A]: todo({ criteria: "- [x] One\n- [ ] Two" }) });
    expect(r.code).toBe(1);
    expect(r.out).toContain("criterion 2");
    expect(r.out).toContain("P3-2026-11-17-example.md");
  });

  it.each([
    "- Criterion 2 not met: needs a paid eval run",
    "- Criterion 2 needs a person: device check of the avatar",
    "- Criterion 2 moved to todos/P3-2026-11-18-follow-up.md",
  ])("accepts an unticked criterion explained in Updates: %s", (line) => {
    const r = run({
      [A]: todo({ criteria: "- [x] One\n- [ ] Two", updates: line }),
    });
    expect(r.code).toBe(0);
  });

  it("does not accept a reason given for a different criterion", () => {
    const r = run({
      [A]: todo({
        criteria: "- [ ] One\n- [x] Two",
        updates: "- Criterion 2 not met: wrong number",
      }),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("criterion 1");
  });

  it("does not accept a reason written outside the Updates section", () => {
    const r = run({
      [A]: todo({
        criteria: "- [x] One\n- [ ] Two — Criterion 2 not met: inline",
        updates: "- Done",
      }),
    });
    expect(r.code).toBe(1);
  });

  it("ignores todos that are not done", () => {
    const r = run({
      [A]: todo({ status: "wont-fix", criteria: "- [ ] One" }),
    });
    expect(r.code).toBe(0);
  });

  it("ignores checkbox examples inside a code fence", () => {
    const r = run({
      [A]: todo({ criteria: "- [x] One\n\n```md\n- [ ] example\n```" }),
    });
    expect(r.code).toBe(0);
  });

  it("counts a wrapped criterion once", () => {
    const r = run({
      [A]: todo({
        criteria: "- [x] One that wraps\n  onto a second line\n- [ ] Two",
        updates: "- Criterion 2 not met: reason",
      }),
    });
    expect(r.code).toBe(0);
  });

  it("ignores files outside todos/archive/", () => {
    const r = run({
      "todos/P3-2026-11-17-open.md": todo({ criteria: "- [ ] One" }),
    });
    expect(r.code).toBe(0);
  });
});
