import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildIssueBody,
  createCopilotIssue,
  evaluateEligibility,
  parseTodoMarkdown,
  resolveTodoPath,
  runCli,
  writeGithubIssueToTodo,
  type CommandRunner,
} from "../delegate-copilot-issue";

const eligibleTodo = `---
title: "Tighten docs wording"
status: backlog
priority: low
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [deferred, docs]
github_issue:
---

# Tighten docs wording

## Summary

Clarify the review workflow docs.

## Background

The current wording is ambiguous for deferred review follow-up.

## Acceptance Criteria

- [ ] Update docs/AI_WORKFLOW.md with the clarified wording
- [ ] Keep the change limited to docs/AI_WORKFLOW.md

## Implementation Notes

Only edit docs/AI_WORKFLOW.md.

## Dependencies

- None

## Risks

- Low risk docs-only change
`;

const tmpDirs: string[] = [];

function writeTempTodo(contents: string, baseDir = os.tmpdir()): string {
  const dir = fs.mkdtempSync(path.join(baseDir, "copilot-delegate-"));
  tmpDirs.push(dir);
  const filePath = path.join(dir, "todo.md");
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function writeWorkspaceTodo(contents: string): string {
  const filePath = path.resolve(
    "todos",
    `.tmp-copilot-delegate-${Date.now()}.md`,
  );
  fs.writeFileSync(filePath, contents);
  tmpDirs.push(filePath);
  return filePath;
}

describe("delegate-copilot-issue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it("parses todo markdown and builds a PR-gated issue body", () => {
    const todo = parseTodoMarkdown(eligibleTodo, "todos/tighten-docs.md");

    expect(todo.title).toBe("Tighten docs wording");
    expect(todo.labels).toEqual(["deferred", "docs"]);
    expect(todo.acceptanceCriteria).toHaveLength(2);
    expect(todo.referencedFiles).toEqual(["docs/AI_WORKFLOW.md"]);

    const body = buildIssueBody(todo);
    expect(body).toContain("Local todo: `todos/tighten-docs.md`");
    expect(body).toContain("Copilot must open a pull request");
    expect(body).toContain("Do not commit directly to `main`");
    expect(body).toContain("Do not auto-merge");
  });

  it("handles CRLF frontmatter and Expo Router group paths", () => {
    const crlfTodo = eligibleTodo
      .replaceAll("\n", "\r\n")
      .replaceAll("docs/AI_WORKFLOW.md", "client/screens/(tabs)/index.tsx");
    const todo = parseTodoMarkdown(crlfTodo, "todos/router-doc.md");

    expect(todo.status).toBe("backlog");
    expect(todo.referencedFiles).toEqual(["client/screens/(tabs)/index.tsx"]);
  });

  it("rejects sensitive work before calling GitHub", () => {
    const todo = parseTodoMarkdown(
      eligibleTodo.replace(
        "Only edit docs/AI_WORKFLOW.md.",
        "Change JWT auth behavior in server/routes/auth.ts.",
      ),
      "todos/auth-change.md",
    );

    const eligibility = evaluateEligibility(todo);

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toContain(
      "JWT/auth work is not eligible for Copilot delegation",
    );
  });

  it("rejects migration paths and missing acceptance criteria", () => {
    const migrationTodo = parseTodoMarkdown(
      eligibleTodo.replace(
        "docs/AI_WORKFLOW.md",
        "migrations/0002_add_table.sql",
      ),
      "todos/migration.md",
    );
    const noCriteriaTodo = parseTodoMarkdown(
      eligibleTodo
        .replace(
          "- [ ] Update docs/AI_WORKFLOW.md with the clarified wording",
          "",
        )
        .replace("- [ ] Keep the change limited to docs/AI_WORKFLOW.md", ""),
      "todos/no-criteria.md",
    );

    expect(evaluateEligibility(migrationTodo).reasons).toContain(
      "schema and migration work is not eligible for Copilot delegation",
    );
    expect(evaluateEligibility(noCriteriaTodo).reasons).toContain(
      "todo must include checkbox acceptance criteria",
    );
  });

  it("ignores delegation safety boilerplate when checking eligibility", () => {
    const todo = parseTodoMarkdown(
      `${eligibleTodo}\n## Copilot Delegation\n\nDo not delegate JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture changes.\n`,
      "todos/tighten-docs.md",
    );

    expect(evaluateEligibility(todo)).toEqual({ eligible: true, reasons: [] });
  });

  it("rejects todos that already have a delegated GitHub Issue", () => {
    const todo = parseTodoMarkdown(
      eligibleTodo.replace(
        "github_issue:",
        "github_issue: https://github.com/xertox1234/OCRecipes/issues/123",
      ),
      "todos/tighten-docs.md",
    );

    expect(evaluateEligibility(todo)).toEqual({
      eligible: false,
      reasons: [
        "todo already has github_issue: https://github.com/xertox1234/OCRecipes/issues/123",
      ],
    });
  });

  it("creates issues with @copilot assignment in live mode", () => {
    const todo = parseTodoMarkdown(eligibleTodo, "todos/tighten-docs.md");
    const runner = vi.fn<CommandRunner>(() => ({
      status: 0,
      stdout: "https://github.com/xertox1234/OCRecipes/issues/123\n",
      stderr: "",
    }));

    const issueUrl = createCopilotIssue(todo, runner);

    expect(issueUrl).toBe("https://github.com/xertox1234/OCRecipes/issues/123");
    expect(runner).toHaveBeenCalledWith(
      "gh",
      expect.arrayContaining(["issue", "create", "--assignee", "@copilot"]),
      expect.stringContaining("Copilot must open a pull request"),
    );
  });

  it("writes the created issue URL back to the source todo", () => {
    const todoPath = writeWorkspaceTodo(eligibleTodo);
    const runner = vi.fn<CommandRunner>(() => ({
      status: 0,
      stdout: "https://github.com/xertox1234/OCRecipes/issues/123\n",
      stderr: "",
    }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const status = runCli(["--live", todoPath], runner);

    expect(status).toBe(0);
    expect(fs.readFileSync(todoPath, "utf8")).toContain(
      "github_issue: https://github.com/xertox1234/OCRecipes/issues/123",
    );
  });

  it("preserves CRLF when writing github_issue", () => {
    const todoPath = writeWorkspaceTodo(eligibleTodo.replaceAll("\n", "\r\n"));

    writeGithubIssueToTodo(
      todoPath,
      "https://github.com/xertox1234/OCRecipes/issues/123",
    );

    const updated = fs.readFileSync(todoPath, "utf8");
    expect(updated).toContain(
      "github_issue: https://github.com/xertox1234/OCRecipes/issues/123\r\n",
    );
  });

  it("surfaces @copilot assignment failures", () => {
    const todo = parseTodoMarkdown(eligibleTodo, "todos/tighten-docs.md");
    const runner = vi.fn<CommandRunner>(() => ({
      status: 1,
      stdout: "",
      stderr: "could not assign @copilot",
    }));

    expect(() => createCopilotIssue(todo, runner)).toThrow(
      "Failed to create Copilot issue or assign @copilot: could not assign @copilot",
    );
  });

  it("dry-run mode does not call gh", () => {
    const todoPath = writeWorkspaceTodo(eligibleTodo);
    const runner = vi.fn<CommandRunner>(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const status = runCli(["--dry-run", todoPath], runner);

    expect(status).toBe(0);
    expect(runner).not.toHaveBeenCalled();
  });

  it("rejects CLI paths outside todos", () => {
    const todoPath = writeTempTodo(eligibleTodo);
    const runner = vi.fn<CommandRunner>(() => ({
      status: 0,
      stdout: "",
      stderr: "",
    }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const status = runCli(["--dry-run", todoPath], runner);

    expect(status).toBe(1);
    expect(runner).not.toHaveBeenCalled();
  });

  it("resolves only markdown files inside todos", () => {
    expect(resolveTodoPath("todos/example.md")).toBe(
      path.resolve("todos/example.md"),
    );
    expect(() => resolveTodoPath("docs/AI_WORKFLOW.md")).toThrow(
      "todo path must be inside the todos/ directory",
    );
    expect(() => resolveTodoPath("todos/example.txt")).toThrow(
      "todo path must point to a markdown file",
    );
  });
});
