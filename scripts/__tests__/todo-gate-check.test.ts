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

const GATE_SCRIPT = join(__dirname, "..", "todo-gate-check.sh");

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-check-"));
  tempDirs.push(dir);
  return dir;
}

function frontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  return `---\n${lines}\n---\n\n# Body\n`;
}

function writeTodo(
  dir: string,
  name: string,
  fields: Record<string, string>,
): string {
  const path = join(dir, name);
  writeFileSync(path, frontmatter(fields));
  return path;
}

function runSingle(path: string): { status: number | null; stdout: string } {
  const result = spawnSync("bash", [GATE_SCRIPT, path], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
}

function runScan(cwd: string): { status: number | null; stdout: string } {
  const result = spawnSync("bash", [GATE_SCRIPT], { encoding: "utf8", cwd });
  return { status: result.status, stdout: result.stdout };
}

describe("todo-gate-check.sh — single-file mode", () => {
  it("exits 0 (CLEAR) when neither blocked_until nor human_led is set", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"No gate"',
      priority: "low",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(0);
    expect(stdout).toMatch(/CLEAR/);
  });

  it("exits 1 (GATED) when blocked_until is a future date", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Future gate"',
      blocked_until: "2099-01-01",
      priority: "low",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/GATED/);
    expect(stdout).toMatch(/2099-01-01/);
  });

  it("includes blocked_reason in the output when present", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Future gate with reason"',
      blocked_until: "2099-01-01",
      blocked_reason: '"waiting on telemetry"',
      priority: "low",
    });
    const { stdout } = runSingle(path);
    expect(stdout).toMatch(/waiting on telemetry/);
  });

  it("exits 0 (clears) when blocked_until is today", () => {
    const dir = makeTempDir();
    // Use the shell's own `date` (same as the script) rather than JS Date/UTC — the two
    // can disagree on "today" near midnight in timezones behind UTC.
    const today = spawnSync("date", ["+%Y-%m-%d"], {
      encoding: "utf8",
    }).stdout.trim();
    const path = writeTodo(dir, "t.md", {
      title: '"Clears today"',
      blocked_until: today,
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(0);
    expect(stdout).toMatch(/CLEAR/);
  });

  it("exits 0 (clears) when blocked_until is in the past", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Past gate"',
      blocked_until: "2020-01-01",
    });
    const { status } = runSingle(path);
    expect(status).toBe(0);
  });

  it("exits 1 (GATED) when human_led: true, even with no blocked_until", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Human led"',
      human_led: "true",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/GATED/);
    expect(stdout).toMatch(/human_led/);
  });

  it("exits 1 (GATED) when human_led: true even after blocked_until has passed — human_led never expires", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Passed date, still human-led"',
      blocked_until: "2020-01-01",
      human_led: "true",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/human_led/);
  });

  it('exits 1 (GATED) when human_led is quoted in the frontmatter (human_led: "true") — quoting must not fail the gate open', () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Quoted human_led"',
      human_led: '"true"',
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/human_led/);
  });

  it("exits 1 (GATED) when blocked_until is quoted in the frontmatter — quoting must not fail the gate open", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Quoted blocked_until"',
      blocked_until: '"2099-01-01"',
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/2099-01-01/);
  });

  it("exits 1 (GATED) when human_led is single-quoted (human_led: 'true')", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Single-quoted human_led"',
      human_led: "'true'",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/human_led/);
  });

  it("exits 1 (GATED) when blocked_until is single-quoted", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Single-quoted blocked_until"',
      blocked_until: "'2099-01-01'",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/2099-01-01/);
  });

  it("exits 1 (GATED, fail-closed) when human_led is set but not exactly true/false (e.g. a trailing inline comment)", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Inline comment on human_led"',
      human_led: "true  # see PR #650 discussion",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/PARSE_ERROR/);
  });

  it("exits 2 (ERROR) when the file exists but is unreadable", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", { title: '"Unreadable"' });
    chmodSync(path, 0o000);
    try {
      const { status, stdout } = runSingle(path);
      expect(status).toBe(2);
      expect(stdout).toMatch(/ERROR/);
    } finally {
      chmodSync(path, 0o644); // restore so afterEach's rmSync can clean up the temp dir
    }
  });

  it("exits 1 (GATED, fail-closed) when blocked_until is not a valid YYYY-MM-DD", () => {
    const dir = makeTempDir();
    const path = writeTodo(dir, "t.md", {
      title: '"Bad date"',
      blocked_until: "not-a-date",
    });
    const { status, stdout } = runSingle(path);
    expect(status).toBe(1);
    expect(stdout).toMatch(/PARSE_ERROR|GATED/);
  });

  it("exits 2 (ERROR) when the file does not exist", () => {
    const { status, stdout } = runSingle("/nonexistent/path/todo.md");
    expect(status).toBe(2);
    expect(stdout).toMatch(/ERROR/);
  });

  it("exits 2 (ERROR) when called with no argument and no todos/ directory in cwd", () => {
    const dir = makeTempDir();
    const result = spawnSync("bash", [GATE_SCRIPT], {
      encoding: "utf8",
      cwd: dir,
    });
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/ERROR/);
  });
});

describe("todo-gate-check.sh — scan mode", () => {
  it("exits 0 with no gated todos when none carry blocked_until/human_led", () => {
    const dir = makeTempDir();
    const todosDir = join(dir, "todos");
    mkdirSync(todosDir);
    writeTodo(todosDir, "P3-2026-01-01-a.md", {
      title: '"A"',
      priority: "low",
    });
    writeTodo(todosDir, "P3-2026-01-01-b.md", {
      title: '"B"',
      priority: "low",
    });
    const { status, stdout } = runScan(dir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/no gated/i);
  });

  it("exits 1 and lists only the gated todos, excluding README.md and TEMPLATE.md", () => {
    const dir = makeTempDir();
    const todosDir = join(dir, "todos");
    mkdirSync(todosDir);
    writeTodo(todosDir, "P3-2026-01-01-clear.md", {
      title: '"Clear"',
      priority: "low",
    });
    writeTodo(todosDir, "P3-2026-01-01-gated.md", {
      title: '"Gated"',
      blocked_until: "2099-01-01",
      priority: "low",
    });
    writeTodo(todosDir, "P3-2026-01-01-human-led.md", {
      title: '"Human led"',
      human_led: "true",
      priority: "low",
    });
    writeFileSync(
      join(todosDir, "README.md"),
      frontmatter({ title: '"not a todo"' }),
    );
    writeFileSync(
      join(todosDir, "TEMPLATE.md"),
      frontmatter({ title: '"not a todo"' }),
    );

    const { status, stdout } = runScan(dir);
    expect(status).toBe(1);
    expect(stdout).toMatch(/P3-2026-01-01-gated\.md/);
    expect(stdout).toMatch(/P3-2026-01-01-human-led\.md/);
    expect(stdout).not.toMatch(/P3-2026-01-01-clear\.md/);
    expect(stdout).not.toMatch(/README\.md/);
    expect(stdout).not.toMatch(/TEMPLATE\.md/);
  });

  it("does not descend into todos/archive/ or nested directories", () => {
    const dir = makeTempDir();
    const todosDir = join(dir, "todos");
    const archiveDir = join(todosDir, "archive");
    mkdirSync(archiveDir, { recursive: true });
    writeTodo(archiveDir, "P3-2020-01-01-old-gated.md", {
      title: '"Archived, still technically gated"',
      blocked_until: "2099-01-01",
    });
    const { status, stdout } = runScan(dir);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/old-gated/);
  });
});
