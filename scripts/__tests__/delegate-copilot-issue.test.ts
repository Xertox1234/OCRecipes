import { afterEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildIssueBody,
  buildProjectRulesSection,
  createCopilotIssue,
  detectedDomains,
  domainsForPath,
  evaluateEligibility,
  parseTodoMarkdown,
  resolveTodoPath,
  runCli,
  writeGithubIssueToTodo,
  writeProjectRulesSectionToTodo,
  type CommandRunner,
  type Domain,
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

    const { body } = buildIssueBody(todo);
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

  it("allows test-labeled todos to mention sensitive areas in their description", () => {
    const testTodo = parseTodoMarkdown(
      `---
title: "HTTP-level tests for recipe routes"
status: backlog
priority: medium
created: 2026-05-11
updated: 2026-05-11
labels: [testing, deferred]
github_issue:
---

# HTTP-level tests for recipe routes

## Summary

Add tests covering the HTTP boundary including auth response codes.

## Background

The route handlers in server/routes/recipe-catalog.ts return 401 without a
valid token. Coverage is missing for that boundary.

## Acceptance Criteria

- [ ] 401 without Authorization header
- [ ] 200 with a valid token
- [ ] Tests live in server/routes/__tests__/recipe-catalog.test.ts

## Implementation Notes

Reuse the request-auth helpers in server/__tests__/test-helpers.ts.
The implementation files (server/middleware/auth.ts) are NOT in scope.
`,
      "todos/route-tests.md",
    );

    const result = evaluateEligibility(testTodo);

    expect(result.reasons).not.toContain(
      "JWT/auth work is not eligible for Copilot delegation",
    );
  });

  it("blocks test-labeled todos that put auth implementation files in scope", () => {
    // Closes the gap from the body-text bypass: a [testing] todo can describe
    // auth code freely, but if it lists server/middleware/auth.ts as a file in
    // scope, the path-based block still rejects it.
    const testTodoWithAuthImpl = parseTodoMarkdown(
      `---
title: "Rewrite auth middleware tests (and the middleware)"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
labels: [testing, deferred]
github_issue:
---

# Rewrite auth middleware tests

## Summary

Rewrite tests AND refactor the middleware.

## Acceptance Criteria

- [ ] Modify server/middleware/auth.ts to add a new option
- [ ] Add tests in server/middleware/__tests__/auth.test.ts

## Implementation Notes

See server/middleware/auth.ts for the current structure.
`,
      "todos/auth-rewrite.md",
    );

    expect(evaluateEligibility(testTodoWithAuthImpl).reasons).toContain(
      "JWT/auth work is not eligible for Copilot delegation",
    );
  });

  it("does not block test files in sensitive directories", () => {
    // The mirror case: a [testing] todo that only references __tests__ paths
    // for auth code is eligible. The path patterns only match implementation
    // files, not test files under __tests__/ or __mocks__/.
    const testOnlyTodo = parseTodoMarkdown(
      `---
title: "Add tests for auth middleware"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
labels: [testing, deferred]
github_issue:
---

# Add tests for auth middleware

## Summary

Coverage for the auth middleware behavior.

## Acceptance Criteria

- [ ] Tests live in server/middleware/__tests__/auth.test.ts
- [ ] Use server/middleware/__mocks__/auth.ts where helpful

## Implementation Notes

Only edit server/middleware/__tests__/auth.test.ts. Do not modify the
middleware itself.
`,
      "todos/auth-tests-only.md",
    );

    const result = evaluateEligibility(testOnlyTodo);
    expect(result.reasons).not.toContain(
      "JWT/auth work is not eligible for Copilot delegation",
    );
  });

  it("still blocks non-test todos that describe auth changes", () => {
    const implTodo = parseTodoMarkdown(
      eligibleTodo.replace(
        "Only edit docs/AI_WORKFLOW.md.",
        "Change JWT auth behavior in server/routes/auth.ts.",
      ),
      "todos/auth-change.md",
    );

    expect(evaluateEligibility(implTodo).reasons).toContain(
      "JWT/auth work is not eligible for Copilot delegation",
    );
  });

  it("does not bypass conceptual blocks for test todos", () => {
    const testTodoWithProdData = parseTodoMarkdown(
      `---
title: "Test against production data snapshot"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
labels: [testing, deferred]
github_issue:
---

# Test against production data snapshot

## Summary

Validate behavior using production data export.

## Acceptance Criteria

- [ ] Use production data snapshot at server/__tests__/fixtures/prod.json

## Implementation Notes

Pull production data snapshot from cold storage for the test fixture.
`,
      "todos/prod-data-test.md",
    );

    expect(evaluateEligibility(testTodoWithProdData).reasons).toContain(
      "production data handling is not eligible for Copilot delegation",
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

  describe("domainsForPath", () => {
    it("maps non-auth server/routes to api + security + architecture", () => {
      const result = domainsForPath("server/routes/recipe-catalog.ts");
      expect(result.sort()).toEqual(["api", "architecture", "security"]);
    });

    it("maps non-auth server/storage to database + security + architecture", () => {
      const result = domainsForPath("server/storage/recipes.ts");
      expect(result.sort()).toEqual(["architecture", "database", "security"]);
    });

    it("maps base server/services to architecture only", () => {
      const result = domainsForPath("server/services/goal-calculator.ts");
      expect(result.sort()).toEqual(["architecture"]);
    });

    it("maps LLM-touching service to architecture + ai-prompting", () => {
      const result = domainsForPath("server/services/nutrition-coach.ts");
      expect(result.sort()).toEqual(["ai-prompting", "architecture"]);
    });

    it("maps client component to react-native + design-system + accessibility + performance", () => {
      const result = domainsForPath("client/components/Button.tsx");
      expect(result.sort()).toEqual([
        "accessibility",
        "design-system",
        "performance",
        "react-native",
      ]);
    });

    it("maps client screen to react-native + design-system + accessibility", () => {
      const result = domainsForPath("client/screens/HomeScreen.tsx");
      expect(result.sort()).toEqual([
        "accessibility",
        "design-system",
        "react-native",
      ]);
    });

    it("maps client hook to hooks + client-state", () => {
      const result = domainsForPath("client/hooks/useFoo.ts");
      expect(result.sort()).toEqual(["client-state", "hooks"]);
    });

    it("maps client context to client-state", () => {
      const result = domainsForPath("client/context/AuthContext.tsx");
      expect(result.sort()).toEqual(["client-state"]);
    });

    it("maps client lib to typescript + client-state", () => {
      const result = domainsForPath("client/lib/format.ts");
      expect(result.sort()).toEqual(["client-state", "typescript"]);
    });

    it("maps evals to ai-prompting + testing", () => {
      const result = domainsForPath("evals/runner.ts");
      expect(result.sort()).toEqual(["ai-prompting", "testing"]);
    });

    it("maps __tests__ paths to testing only (not the parent routes pattern)", () => {
      const result = domainsForPath(
        "server/routes/__tests__/recipe-catalog.test.ts",
      );
      expect(result).toEqual(["testing"]);
    });

    it("unions domains across multiple matching rules (screen test file)", () => {
      // client/screens/__tests__/HomeScreen.test.tsx matches both the
      // client/screens/ rule AND the __tests__/ rule. The result must be the
      // union of both domain sets, not one or the other.
      const result = domainsForPath(
        "client/screens/__tests__/HomeScreen.test.tsx",
      );
      expect(result.sort()).toEqual([
        "accessibility",
        "design-system",
        "react-native",
        "testing",
      ]);
    });

    it("maps .github/workflows to architecture + testing", () => {
      const result = domainsForPath(".github/workflows/ci.yml");
      expect(result.sort()).toEqual(["architecture", "testing"]);
    });

    it("returns empty array for unmapped path", () => {
      expect(domainsForPath("README.md")).toEqual([]);
    });
  });

  describe("LLM_TOUCHING_SERVICES drift detection", () => {
    it("matches the empirical grep result", () => {
      // Re-run the grep that seeded the constant. If a new service imports
      // an LLM client without being added to LLM_TOUCHING_SERVICES, this
      // test fails and forces the developer to update the constant.
      const result = execSync(
        `grep -l "openai\\|OpenAI\\|gpt-\\|completions\\|anthropic" server/services/*.ts || true`,
        { encoding: "utf8" },
      );
      const empirical = result
        .split("\n")
        .filter(Boolean)
        .filter((p: string) => !p.includes("/__tests__/"))
        .map((p: string) => p.replace(/^server\/services\//, ""))
        .sort();

      // The script's constant is internal — re-derive the set we expect to
      // match by checking domainsForPath returns "ai-prompting" for each.
      // This indirectly asserts LLM_TOUCHING_SERVICES contains exactly the
      // empirical list.
      const aiPromptingServices = empirical.filter((basename: string) =>
        domainsForPath(`server/services/${basename}`).includes("ai-prompting"),
      );
      const nonAiPromptingServices = empirical.filter(
        (basename: string) =>
          !domainsForPath(`server/services/${basename}`).includes(
            "ai-prompting",
          ),
      );

      expect(nonAiPromptingServices).toEqual([]);
      expect(aiPromptingServices.length).toBe(empirical.length);
      expect(empirical.length).toBeGreaterThan(0); // sanity — we have LLM services
    });
  });

  describe("detectedDomains", () => {
    it("aggregates domains across multiple files in sorted order", () => {
      const result = detectedDomains(
        ["server/routes/recipe-catalog.ts", "server/storage/recipes.ts"],
        [],
      );
      expect(result).toEqual([
        "api",
        "architecture",
        "database",
        "security",
        "typescript",
      ]);
    });

    it("includes typescript when any .ts file is in scope", () => {
      const result = detectedDomains(
        ["server/services/goal-calculator.ts"],
        [],
      );
      expect(result).toContain("typescript");
    });

    it("includes typescript when any .tsx file is in scope", () => {
      const result = detectedDomains(["client/components/Button.tsx"], []);
      expect(result).toContain("typescript");
    });

    it("does NOT include typescript for non-.ts/.tsx files", () => {
      const result = detectedDomains([".github/workflows/ci.yml"], []);
      expect(result).not.toContain("typescript");
    });

    it("force-adds testing from a testing label", () => {
      const result = detectedDomains(
        ["evals/datasets/fixtures.json"],
        ["testing"],
      );
      expect(result).toContain("testing");
    });

    it("force-adds testing from a test label (alias)", () => {
      const result = detectedDomains(
        ["evals/datasets/fixtures.json"],
        ["test"],
      );
      expect(result).toContain("testing");
    });

    it("force-adds performance from a performance label", () => {
      const result = detectedDomains(["docs/PERF_NOTES.md"], ["performance"]);
      expect(result).toContain("performance");
    });

    it("matches labels case-insensitively", () => {
      // The spec calls for case-insensitive label lookup via .toLowerCase().
      // This test locks in that behavior so a future refactor that drops the
      // lowercasing would be caught.
      const result = detectedDomains(["docs/PERF.md"], ["PERFORMANCE"]);
      expect(result).toContain("performance");

      const result2 = detectedDomains(["docs/T.md"], ["Testing"]);
      expect(result2).toContain("testing");
    });

    it("ignores labels that don't correspond to rules domains", () => {
      const result = detectedDomains(
        ["docs/CHANGELOG.md"],
        ["code-quality", "refactor", "docs", "deferred"],
      );
      expect(result).toEqual([]);
    });

    it("returns alphabetically sorted result with pinned expected output", () => {
      const result = detectedDomains(
        ["client/components/Button.tsx", "server/storage/users.ts"],
        ["testing"],
      );
      expect(result).toEqual([
        "accessibility",
        "architecture",
        "database",
        "design-system",
        "performance",
        "react-native",
        "security",
        "testing",
        "typescript",
      ]);
    });

    it("returns empty array when no files match and no relevant labels", () => {
      expect(detectedDomains(["README.md"], ["docs"])).toEqual([]);
    });
  });

  describe("buildProjectRulesSection", () => {
    it("inlines docs/rules/<domain>.md content for each domain", () => {
      const section = buildProjectRulesSection(["typescript"]);
      expect(section).toContain("## Project Rules");
      expect(section).toContain("### typescript");
      // The actual content of docs/rules/typescript.md should appear:
      expect(section).toContain(
        "Never use `as` cast on a bare `text` DB column",
      );
    });

    it("emits subheadings in the order provided", () => {
      const section = buildProjectRulesSection(["react-native", "testing"]);
      const rnIndex = section.indexOf("### react-native");
      const testingIndex = section.indexOf("### testing");
      expect(rnIndex).toBeGreaterThan(-1);
      expect(testingIndex).toBeGreaterThan(rnIndex);
    });

    it("appends pattern URLs as further-reading pointers", () => {
      const section = buildProjectRulesSection(["typescript"]);
      expect(section).toContain(
        "https://github.com/Xertox1234/OCRecipes/blob/main/docs/legacy-patterns/typescript.md",
      );
    });

    it("emits the binding-rules preamble", () => {
      const section = buildProjectRulesSection(["typescript"]);
      expect(section).toContain("rules below are binding");
      expect(section).toContain("PR comment");
    });

    it("emits a minimal block when no domains are detected", () => {
      const section = buildProjectRulesSection([]);
      expect(section).toContain("## Project Rules");
      expect(section).toContain("No domain rules apply");
      expect(section).not.toContain("### ");
    });

    it("throws a clear error when a rule file is missing", () => {
      // 'nonexistent' is not a real domain — simulate the missing-file case
      // by casting (TS would normally prevent this).
      expect(() => buildProjectRulesSection(["nonexistent" as Domain])).toThrow(
        /docs\/rules\/nonexistent\.md/,
      );
    });
  });

  describe("buildIssueBody Project Rules injection", () => {
    it("inserts ## Project Rules between Files In Scope and Implementation Notes", () => {
      const todo = parseTodoMarkdown(
        `---
title: "Test rules injection"
status: backlog
priority: low
labels: [testing, deferred]
github_issue:
---

# Test rules injection

## Summary

A test.

## Acceptance Criteria

- [ ] Add tests in server/storage/__tests__/example.test.ts

## Implementation Notes

Touch server/storage/__tests__/example.test.ts.
`,
        "todos/test-rules-injection.md",
      );

      const { body } = buildIssueBody(todo);
      const filesIdx = body.indexOf("## Files In Scope");
      const rulesIdx = body.indexOf("## Project Rules");
      const implIdx = body.indexOf("## Implementation Notes");

      expect(filesIdx).toBeGreaterThan(-1);
      expect(rulesIdx).toBeGreaterThan(filesIdx);
      expect(implIdx).toBeGreaterThan(rulesIdx);
      // typescript rules content should appear (any .ts file forces typescript domain):
      expect(body).toContain("### typescript");
      // testing rules content (forced by label):
      expect(body).toContain("### testing");
    });

    it("includes the no-domains minimal block when nothing matches", () => {
      const todo = parseTodoMarkdown(
        `---
title: "Docs-only change"
status: backlog
priority: low
labels: [docs, deferred]
github_issue:
---

# Docs-only change

## Summary

Edit a doc.

## Acceptance Criteria

- [ ] Update docs/README.md

## Implementation Notes

Only edit docs/README.md.
`,
        "todos/docs-only.md",
      );

      const { body } = buildIssueBody(todo);
      expect(body).toContain("## Project Rules");
      expect(body).toContain("No domain rules apply");
    });
  });

  describe("writeProjectRulesSectionToTodo anchor cases", () => {
    const baseFrontmatter = `---
title: "Anchor test"
status: backlog
priority: low
labels: [testing, deferred]
github_issue:
---

# Anchor test

## Summary

Body.

## Acceptance Criteria

- [ ] do thing
`;

    const rulesBlock = "## Project Rules\n\nInjected rules block.\n";

    it("inserts BEFORE ## Updates when present (highest priority)", () => {
      const path = writeWorkspaceTodo(
        `${baseFrontmatter}
## Implementation Notes

Notes.

## Updates

### 2026-05-11
- created
`,
      );
      writeProjectRulesSectionToTodo(path, rulesBlock);
      const updated = fs.readFileSync(path, "utf8");
      const rulesIdx = updated.indexOf("## Project Rules");
      const updatesIdx = updated.indexOf("## Updates");
      expect(rulesIdx).toBeGreaterThan(-1);
      expect(rulesIdx).toBeLessThan(updatesIdx);
    });

    it("inserts AFTER ## Risks when no ## Updates (second priority)", () => {
      const path = writeWorkspaceTodo(
        `${baseFrontmatter}
## Implementation Notes

Notes.

## Risks

- low
`,
      );
      writeProjectRulesSectionToTodo(path, rulesBlock);
      const updated = fs.readFileSync(path, "utf8");
      const risksIdx = updated.indexOf("## Risks");
      const rulesIdx = updated.indexOf("## Project Rules");
      expect(rulesIdx).toBeGreaterThan(risksIdx);
    });

    it("inserts AFTER ## Dependencies when no Updates/Risks (third priority)", () => {
      const path = writeWorkspaceTodo(
        `${baseFrontmatter}
## Implementation Notes

Notes.

## Dependencies

- None.
`,
      );
      writeProjectRulesSectionToTodo(path, rulesBlock);
      const updated = fs.readFileSync(path, "utf8");
      const depsIdx = updated.indexOf("## Dependencies");
      const rulesIdx = updated.indexOf("## Project Rules");
      expect(rulesIdx).toBeGreaterThan(depsIdx);
    });

    it("inserts AFTER ## Implementation Notes body (fourth priority)", () => {
      const path = writeWorkspaceTodo(
        `${baseFrontmatter}
## Implementation Notes

Notes body.
`,
      );
      writeProjectRulesSectionToTodo(path, rulesBlock);
      const updated = fs.readFileSync(path, "utf8");
      const implIdx = updated.indexOf("## Implementation Notes");
      const rulesIdx = updated.indexOf("## Project Rules");
      expect(rulesIdx).toBeGreaterThan(implIdx);
      // The Notes body content must come BEFORE Project Rules
      expect(updated.indexOf("Notes body.")).toBeLessThan(rulesIdx);
    });

    it("appends at EOF when no recognized sections exist", () => {
      const malformed = `---
title: "Malformed"
status: backlog
priority: low
labels: [testing, deferred]
github_issue:
---

# Malformed

Just some prose, no sections.
`;
      const path = writeWorkspaceTodo(malformed);
      writeProjectRulesSectionToTodo(path, rulesBlock);
      const updated = fs.readFileSync(path, "utf8");
      const rulesIdx = updated.indexOf("## Project Rules");
      expect(rulesIdx).toBeGreaterThan(-1);
      // Should be at end of file (after the prose)
      expect(updated.indexOf("Just some prose")).toBeLessThan(rulesIdx);
    });

    it("does not duplicate an existing ## Project Rules section on re-write", () => {
      const path = writeWorkspaceTodo(
        `${baseFrontmatter}
## Implementation Notes

Notes.

## Updates

- created
`,
      );
      writeProjectRulesSectionToTodo(path, rulesBlock);
      writeProjectRulesSectionToTodo(path, rulesBlock); // call again
      const updated = fs.readFileSync(path, "utf8");
      // Should only contain ONE occurrence of "## Project Rules"
      const matches = updated.match(/^## Project Rules$/gm);
      expect(matches?.length).toBe(1);
      // Content integrity: the injected rules block body must still be present
      // after the re-write (so we know the section was replaced cleanly, not
      // corrupted in some way that still leaves a single heading).
      expect(updated).toContain("Injected rules block.");
    });

    it("Updates wins when Risks AND Dependencies AND Updates are all present", () => {
      // Locks in the priority chain: Updates > Risks > Dependencies > Impl Notes > EOF.
      const path = writeWorkspaceTodo(
        `${baseFrontmatter}
## Implementation Notes

Notes.

## Dependencies

- None.

## Risks

- low

## Updates

### 2026-05-11
- created
`,
      );
      writeProjectRulesSectionToTodo(path, rulesBlock);
      const updated = fs.readFileSync(path, "utf8");
      const rulesIdx = updated.indexOf("## Project Rules");
      const updatesIdx = updated.indexOf("## Updates");
      const risksIdx = updated.indexOf("## Risks");
      const depsIdx = updated.indexOf("## Dependencies");
      // Rules must land before Updates (highest priority anchor)
      expect(rulesIdx).toBeLessThan(updatesIdx);
      // And after Dependencies and Risks (since Updates wins, rules aren't inserted there)
      expect(rulesIdx).toBeGreaterThan(depsIdx);
      expect(rulesIdx).toBeGreaterThan(risksIdx);
    });

    it("ignores mid-sentence anchor mentions in body text", () => {
      // A todo whose Notes body mentions "## Risks" in prose must not be
      // mistakenly anchored on that text. The insertion should fall through
      // to the EOF append since no real ## heading exists for Updates/Risks/
      // Dependencies/Impl-Notes other than Implementation Notes.
      const path = writeWorkspaceTodo(
        `${baseFrontmatter}
## Implementation Notes

See ## Risks for context (this is body text, not a real heading).
The discussion on ## Updates should continue here.
`,
      );
      writeProjectRulesSectionToTodo(path, rulesBlock);
      const updated = fs.readFileSync(path, "utf8");
      // Project Rules should be inserted AFTER Implementation Notes body,
      // not before the fake "## Risks" prose mention.
      const implIdx = updated.indexOf("## Implementation Notes");
      const fakeRisksIdx = updated.indexOf("## Risks");
      const rulesIdx = updated.indexOf("## Project Rules");
      expect(implIdx).toBeGreaterThan(-1);
      expect(fakeRisksIdx).toBeGreaterThan(-1); // body text still present
      expect(rulesIdx).toBeGreaterThan(implIdx);
      // The body prose "## Risks" remains in its original position;
      // Project Rules is NOT inserted before it.
      expect(rulesIdx).toBeGreaterThan(fakeRisksIdx);
    });
  });

  it("writes Project Rules section into the local todo on successful live delegate", () => {
    const todoContent = `---
title: "Wire-in test"
status: backlog
priority: low
labels: [testing, deferred]
github_issue:
---

# Wire-in test

## Summary

A test.

## Acceptance Criteria

- [ ] Add server/storage/__tests__/example.test.ts

## Implementation Notes

Touch server/storage/__tests__/example.test.ts.
`;
    const todoPath = writeWorkspaceTodo(todoContent);
    const runner = vi.fn<CommandRunner>(() => ({
      status: 0,
      stdout: "https://github.com/Xertox1234/OCRecipes/issues/999\n",
      stderr: "",
    }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const status = runCli(["--live", todoPath], runner);

    expect(status).toBe(0);
    const updated = fs.readFileSync(todoPath, "utf8");
    expect(updated).toContain(
      "github_issue: https://github.com/Xertox1234/OCRecipes/issues/999",
    );
    expect(updated).toContain("## Project Rules");
    expect(updated).toContain("### testing");
    expect(updated).toContain("### typescript");
  });
});
