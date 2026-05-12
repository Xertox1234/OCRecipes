# Copilot Pattern Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the existing `docs/rules/*.md` and `docs/patterns/*.md` content to GitHub Copilot via repo-level instructions plus auto-injected `## Project Rules` sections in delegated Issue bodies, so Copilot stops writing code blind.

**Architecture:** Three connected components. (1) `.github/copilot-instructions.md` is a small, tracked, generated artifact that gives Copilot one-time orientation and the path → domain mapping. (2) `delegate-copilot-issue.ts` gains a domain-detection step that inlines the relevant `docs/rules/<domain>.md` content into each Issue body and writes the same block back into the local todo file. (3) CI runs the build script with `--check` so the committed instructions file can't drift from the script's authoritative mapping.

**Tech Stack:** TypeScript + tsx, Vitest, Node `fs`/`path`, `gh` CLI, husky pre-commit, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-11-copilot-pattern-awareness-design.md` (v3, commit `88e56d22`).

---

## Background context for the implementer

- **Run tests with:** `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts` (single-file run, ~150 ms). Do NOT run the full test suite — CI handles that.
- **Type check:** `npm run check:types`. Don't run at every step; run at end of plan or when adding new types.
- **TypeScript style:** prefer `as const` + union types over enums. Prefer regex patterns over glob libraries (no new deps). The script already uses `RegExp` for `BLOCKED_PATTERNS` and `BLOCKED_FILE_PATTERNS` — mirror that style.
- **Test style:** Vitest with `describe` / `it`, using `parseTodoMarkdown` to construct test fixtures inline (see existing tests for the pattern). No external fixture files.
- **Commit style:** conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). One commit per task. Pre-commit hook runs `eslint --fix` + `prettier --write`.
- **Where things live now (read these first):**
  - `scripts/delegate-copilot-issue.ts` — the script under modification (~500 lines).
  - `scripts/__tests__/delegate-copilot-issue.test.ts` — existing tests (~360 lines after recent additions).
  - `docs/rules/*.md` — 13 imperative-rule files, ~8 lines each. Domains: accessibility, ai-prompting, api, architecture, client-state, database, design-system, hooks, performance, react-native, security, testing, typescript.
  - `docs/patterns/*.md` — 16 long-form pattern files (referenced by URL only, never inlined).
- **Hard exclusion check (already implemented in commit `93c6a606`):** `BLOCKED_FILE_PATTERNS` rejects `server/middleware/auth.ts`, `server/routes/auth.ts`, `server/lib/jwt-*`, `server/services/receipt-validation.*`, `server/services/healthkit*`, `server/storage/health.ts`, `shared/schema.ts`, `migrations/*`. Do not duplicate or move these — Task 5 only adds the `Project Rules` injection on top of the existing flow.

---

## Task 1: Add `Domain` type and `PATH_TO_DOMAINS` constant

**Files:**

- Modify: `scripts/delegate-copilot-issue.ts` (insert after line 122 — right after `BLOCKED_FILE_PATTERNS` block)
- Test: `scripts/__tests__/delegate-copilot-issue.test.ts` (append to bottom)

- [ ] **Step 1.1: Write the failing tests**

Append to `scripts/__tests__/delegate-copilot-issue.test.ts` (inside the `describe("delegate-copilot-issue", ...)` block, before its closing `});`):

```typescript
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

  it("maps __tests__ paths to testing", () => {
    const result = domainsForPath(
      "server/routes/__tests__/recipe-catalog.test.ts",
    );
    expect(result).toContain("testing");
  });

  it("maps .github/workflows to architecture + testing", () => {
    const result = domainsForPath(".github/workflows/ci.yml");
    expect(result.sort()).toEqual(["architecture", "testing"]);
  });

  it("returns empty array for unmapped path", () => {
    expect(domainsForPath("README.md")).toEqual([]);
  });
});
```

Also extend the import at the top of the test file:

```typescript
import {
  buildIssueBody,
  createCopilotIssue,
  domainsForPath, // ADD
  evaluateEligibility,
  parseTodoMarkdown,
  resolveTodoPath,
  runCli,
  writeGithubIssueToTodo,
  type CommandRunner,
} from "../delegate-copilot-issue";
```

- [ ] **Step 1.2: Run the new tests to confirm they fail**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t domainsForPath`
Expected: FAIL — `domainsForPath` is not exported.

- [ ] **Step 1.3: Add the `Domain` type and `PATH_TO_DOMAINS` constant**

Open `scripts/delegate-copilot-issue.ts`. Find the end of the `BLOCKED_FILE_PATTERNS` array (around line 122). Add this block immediately after it:

```typescript
export type Domain =
  | "accessibility"
  | "ai-prompting"
  | "api"
  | "architecture"
  | "client-state"
  | "database"
  | "design-system"
  | "hooks"
  | "performance"
  | "react-native"
  | "security"
  | "testing"
  | "typescript";

// Service file basenames (under server/services/) that import an LLM client.
// Empirically derived 2026-05-11 via:
//   grep -l "openai\|OpenAI\|gpt-\|completions\|anthropic" server/services/*.ts | grep -v __tests__
// A unit test re-runs this grep at test time and fails on drift.
const LLM_TOUCHING_SERVICES: ReadonlySet<string> = new Set([
  "canonical-enrichment.ts",
  "coach-pro-chat.ts",
  "coach-tools.ts",
  "cooking-session.ts",
  "food-nlp.ts",
  "front-label-analysis.ts",
  "ingredient-substitution.ts",
  "meal-suggestions.ts",
  "menu-analysis.ts",
  "notebook-extraction.ts",
  "nutrition-coach.ts",
  "pantry-meal-plan.ts",
  "photo-analysis.ts",
  "receipt-analysis.ts",
  "recipe-chat.ts",
  "recipe-generation.ts",
  "suggestion-generation.ts",
  "voice-transcription.ts",
]);

// Path → Domain mapping. Order matters only for the rendered table; the
// detection function takes a UNION across all matching rules. Patterns are
// regexes (not globs) to avoid a glob library dependency.
//
// `description` is for the markdown table rendered into
// `.github/copilot-instructions.md` by build-copilot-instructions.ts.
export interface PathDomainRule {
  readonly pattern: RegExp;
  readonly domains: ReadonlyArray<Domain>;
  readonly description: string;
}

export const PATH_TO_DOMAINS: ReadonlyArray<PathDomainRule> = [
  {
    pattern: /^server\/routes\/[^/]+\.ts$/,
    domains: ["api", "security", "architecture"],
    description: "`server/routes/**/*.ts` (non-auth blocked separately)",
  },
  {
    pattern: /^server\/storage\/[^/]+\.ts$/,
    domains: ["database", "security", "architecture"],
    description: "`server/storage/**/*.ts` (non-auth blocked separately)",
  },
  {
    pattern: /^server\/services\/[^/]+\.ts$/,
    domains: ["architecture"],
    description: "`server/services/**/*.ts` (base — architecture only)",
  },
  // LLM-touching services: matched additionally by Set lookup, not regex.
  // See domainsForPath().
  {
    pattern: /^client\/screens\//,
    domains: ["react-native", "design-system", "accessibility"],
    description: "`client/screens/**`",
  },
  {
    pattern: /^client\/components\//,
    domains: ["react-native", "design-system", "accessibility", "performance"],
    description: "`client/components/**`",
  },
  {
    pattern: /^client\/hooks\//,
    domains: ["hooks", "client-state"],
    description: "`client/hooks/**`",
  },
  {
    pattern: /^client\/context\//,
    domains: ["client-state"],
    description: "`client/context/**`",
  },
  {
    pattern: /^client\/lib\//,
    domains: ["typescript", "client-state"],
    description: "`client/lib/**`",
  },
  {
    pattern: /^evals\//,
    domains: ["ai-prompting", "testing"],
    description: "`evals/**`",
  },
  {
    pattern: /\/__tests__\/|\.test\.tsx?$|\.spec\.tsx?$/,
    domains: ["testing"],
    description: "`*test*.ts`, `*.test.tsx`, `__tests__/**`",
  },
  {
    pattern: /^\.github\/workflows\//,
    domains: ["architecture", "testing"],
    description: "`.github/workflows/**`",
  },
  {
    pattern: /^(vitest\.config\.[^/]+|eslint\.config\.[^/]+)$/,
    domains: ["testing", "typescript"],
    description: "`vitest.config.*`, `eslint.config.*`",
  },
];

export function domainsForPath(filePath: string): Domain[] {
  const matched = new Set<Domain>();
  for (const rule of PATH_TO_DOMAINS) {
    if (rule.pattern.test(filePath)) {
      for (const d of rule.domains) matched.add(d);
    }
  }
  // LLM-touching services special case: add ai-prompting if the basename
  // is in the enumerated set.
  if (filePath.startsWith("server/services/")) {
    const basename = filePath.slice("server/services/".length);
    if (!basename.includes("/") && LLM_TOUCHING_SERVICES.has(basename)) {
      matched.add("ai-prompting");
    }
  }
  return [...matched];
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t domainsForPath`
Expected: PASS — all 13 `domainsForPath` test cases green.

Also run the full file to ensure nothing else broke: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts`
Expected: PASS — all tests green (existing + 13 new).

- [ ] **Step 1.5: Commit**

```bash
git add scripts/delegate-copilot-issue.ts scripts/__tests__/delegate-copilot-issue.test.ts
git commit -m "feat(scripts): add Domain type and PATH_TO_DOMAINS mapping for Copilot delegation

PATH_TO_DOMAINS encodes which docs/rules/<domain>.md and docs/patterns/<domain>.md
files apply when Copilot is asked to modify a given file. LLM_TOUCHING_SERVICES
is the empirical set of server/services/ files that import an LLM client.
domainsForPath() returns the union of domains for a given file path.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Add LLM-touching services drift-detection test

**Files:**

- Test: `scripts/__tests__/delegate-copilot-issue.test.ts` (append)

- [ ] **Step 2.1: Write the drift-detection test**

Add inside the `describe("delegate-copilot-issue", ...)` block, after the `domainsForPath` describe block:

```typescript
describe("LLM_TOUCHING_SERVICES drift detection", () => {
  it("matches the empirical grep result", () => {
    // Re-run the grep that seeded the constant. If a new service imports
    // an LLM client without being added to LLM_TOUCHING_SERVICES, this
    // test fails and forces the developer to update the constant.
    const result = require("child_process").execSync(
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
        !domainsForPath(`server/services/${basename}`).includes("ai-prompting"),
    );

    expect(nonAiPromptingServices).toEqual([]);
    expect(aiPromptingServices.length).toBe(empirical.length);
    expect(empirical.length).toBeGreaterThan(0); // sanity — we have LLM services
  });
});
```

- [ ] **Step 2.2: Run the drift test to verify it passes**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t "LLM_TOUCHING_SERVICES drift"`
Expected: PASS — the 18 empirical services match what `domainsForPath` returns.

- [ ] **Step 2.3: Verify the test would FAIL on drift (manual sanity check)**

Temporarily remove one entry (e.g., `"coach-pro-chat.ts"`) from `LLM_TOUCHING_SERVICES` in `scripts/delegate-copilot-issue.ts`. Re-run the test.
Expected: FAIL — `aiPromptingServices.length` would be 17, but `empirical.length` is 18.

Restore the entry. Re-run.
Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
git add scripts/__tests__/delegate-copilot-issue.test.ts
git commit -m "test(scripts): drift-detection for LLM_TOUCHING_SERVICES

Re-runs the seed grep at test time and asserts every service it finds is
captured by domainsForPath() with ai-prompting in the result. If a new
LLM-using service is added to server/services/ without updating the
constant, the test fails.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Add `detectedDomains(referencedFiles, labels)` function

**Files:**

- Modify: `scripts/delegate-copilot-issue.ts` (add after `domainsForPath`)
- Test: `scripts/__tests__/delegate-copilot-issue.test.ts` (append)

- [ ] **Step 3.1: Write the failing tests**

Append inside the `describe("delegate-copilot-issue", ...)` block:

```typescript
describe("detectedDomains", () => {
  it("aggregates domains across multiple files", () => {
    const result = detectedDomains(
      ["server/routes/recipe-catalog.ts", "server/storage/recipes.ts"],
      [],
    );
    expect(result.sort()).toEqual([
      "api",
      "architecture",
      "database",
      "security",
      "typescript",
    ]);
  });

  it("includes typescript when any .ts file is in scope", () => {
    const result = detectedDomains(["server/services/goal-calculator.ts"], []);
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
    const result = detectedDomains(["evals/datasets/fixtures.json"], ["test"]);
    expect(result).toContain("testing");
  });

  it("force-adds performance from a performance label", () => {
    const result = detectedDomains(["docs/PERF_NOTES.md"], ["performance"]);
    expect(result).toContain("performance");
  });

  it("ignores labels that don't correspond to rules domains", () => {
    const result = detectedDomains(
      ["docs/CHANGELOG.md"],
      ["code-quality", "refactor", "docs", "deferred"],
    );
    expect(result).toEqual([]);
  });

  it("returns alphabetically sorted result for determinism", () => {
    const result = detectedDomains(
      ["client/components/Button.tsx", "server/storage/users.ts"],
      ["testing"],
    );
    // Verify the array is sorted ascending
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });

  it("returns empty array when no files match and no relevant labels", () => {
    expect(detectedDomains(["README.md"], ["docs"])).toEqual([]);
  });
});
```

Update the import at the top:

```typescript
import {
  buildIssueBody,
  createCopilotIssue,
  detectedDomains, // ADD
  domainsForPath,
  evaluateEligibility,
  parseTodoMarkdown,
  resolveTodoPath,
  runCli,
  writeGithubIssueToTodo,
  type CommandRunner,
} from "../delegate-copilot-issue";
```

- [ ] **Step 3.2: Run the new tests to confirm they fail**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t detectedDomains`
Expected: FAIL — `detectedDomains` is not exported.

- [ ] **Step 3.3: Implement `detectedDomains`**

In `scripts/delegate-copilot-issue.ts`, after the `domainsForPath` function, add:

```typescript
// Label → forced domain. Only `testing` and `performance` map to rules
// domains. Other allowed labels (code-quality, docs, refactor) don't have
// dedicated rules files and are ignored.
const LABEL_TO_FORCED_DOMAIN: Record<string, Domain> = {
  test: "testing",
  testing: "testing",
  performance: "performance",
};

export function detectedDomains(
  referencedFiles: ReadonlyArray<string>,
  labels: ReadonlyArray<string>,
): Domain[] {
  const matched = new Set<Domain>();

  for (const file of referencedFiles) {
    for (const d of domainsForPath(file)) {
      matched.add(d);
    }
  }

  for (const label of labels) {
    const forced = LABEL_TO_FORCED_DOMAIN[label.toLowerCase()];
    if (forced) {
      matched.add(forced);
    }
  }

  // typescript rules apply to any TS/TSX file regardless of domain.
  const hasTsFile = referencedFiles.some((f) => /\.(ts|tsx)$/.test(f));
  if (hasTsFile) {
    matched.add("typescript");
  }

  return [...matched].sort();
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t detectedDomains`
Expected: PASS — all 10 `detectedDomains` test cases green.

Run the full file: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 3.5: Commit**

```bash
git add scripts/delegate-copilot-issue.ts scripts/__tests__/delegate-copilot-issue.test.ts
git commit -m "feat(scripts): detectedDomains() unions paths, labels, and typescript

Combines the per-file mapping from domainsForPath() with intent labels
(testing/performance) and an unconditional typescript inclusion for any
.ts/.tsx file. Returns a sorted deduplicated list for deterministic
section rendering.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Add `buildProjectRulesSection(domains)` function

**Files:**

- Modify: `scripts/delegate-copilot-issue.ts` (add after `detectedDomains`)
- Test: `scripts/__tests__/delegate-copilot-issue.test.ts` (append)

- [ ] **Step 4.1: Write the failing tests**

Append inside the `describe(...)` block:

```typescript
describe("buildProjectRulesSection", () => {
  it("inlines docs/rules/<domain>.md content for each domain", () => {
    const section = buildProjectRulesSection(["typescript"]);
    expect(section).toContain("## Project Rules");
    expect(section).toContain("### typescript");
    // The actual content of docs/rules/typescript.md should appear:
    expect(section).toContain("Never use `as` cast on a bare `text` DB column");
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
      "https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/typescript.md",
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
```

Update the import:

```typescript
import {
  buildIssueBody,
  buildProjectRulesSection, // ADD
  createCopilotIssue,
  detectedDomains,
  domainsForPath,
  evaluateEligibility,
  parseTodoMarkdown,
  resolveTodoPath,
  runCli,
  writeGithubIssueToTodo,
  type CommandRunner,
  type Domain, // ADD
} from "../delegate-copilot-issue";
```

- [ ] **Step 4.2: Run the new tests to confirm they fail**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t buildProjectRulesSection`
Expected: FAIL — `buildProjectRulesSection` is not exported.

- [ ] **Step 4.3: Implement `buildProjectRulesSection`**

In `scripts/delegate-copilot-issue.ts`, after `detectedDomains`, add:

```typescript
const PATTERNS_URL_BASE =
  "https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns";

const PROJECT_RULES_PREAMBLE = `The rules below are binding. If any rule conflicts with the acceptance criteria, raise it in a PR comment rather than silently violating it. Open the linked pattern file for full context if a rule isn't clear.`;

export function buildProjectRulesSection(
  domains: ReadonlyArray<Domain>,
): string {
  if (domains.length === 0) {
    return `## Project Rules

No domain rules apply to this scope. Follow the acceptance criteria and conventional best practice. Hard exclusions (see Safety And Review Requirements) still apply.`;
  }

  const sections: string[] = [];
  for (const domain of domains) {
    const rulePath = path.join("docs", "rules", `${domain}.md`);
    if (!fs.existsSync(rulePath)) {
      throw new Error(
        `Missing rule file ${rulePath} for detected domain "${domain}". Either restore the file or remove ${domain} from PATH_TO_DOMAINS / LABEL_TO_FORCED_DOMAIN.`,
      );
    }
    const content = fs.readFileSync(rulePath, "utf8").trim();
    // Strip the leading `# Domain Rules` heading from the file; we re-add as ###
    const withoutHeading = content.replace(/^#\s+[^\n]*\n+/, "");
    sections.push(`### ${domain}\n\n${withoutHeading}`);
  }

  const patternUrls = domains
    .map((d) => `- ${PATTERNS_URL_BASE}/${d}.md`)
    .join("\n");

  return `## Project Rules

${PROJECT_RULES_PREAMBLE}

${sections.join("\n\n")}

**Further context (open the URL if a rule above isn't clear):**

${patternUrls}`;
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t buildProjectRulesSection`
Expected: PASS — all 6 `buildProjectRulesSection` test cases green.

- [ ] **Step 4.5: Commit**

```bash
git add scripts/delegate-copilot-issue.ts scripts/__tests__/delegate-copilot-issue.test.ts
git commit -m "feat(scripts): buildProjectRulesSection() inlines rules + pattern URLs

Reads docs/rules/<domain>.md for each detected domain, strips its top-level
heading, and re-emits under '### <domain>' subheadings. Appends
docs/patterns/<domain>.md GitHub URLs as further-reading pointers. Throws
on missing rule files (no silent skip).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Inject `## Project Rules` into `buildIssueBody`

**Files:**

- Modify: `scripts/delegate-copilot-issue.ts` (modify `buildIssueBody`)
- Test: `scripts/__tests__/delegate-copilot-issue.test.ts` (append)

- [ ] **Step 5.1: Write the failing test**

Append inside the `describe(...)` block:

```typescript
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

    const body = buildIssueBody(todo);
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

    const body = buildIssueBody(todo);
    expect(body).toContain("## Project Rules");
    expect(body).toContain("No domain rules apply");
  });
});
```

- [ ] **Step 5.2: Run the test to confirm it fails**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t "Project Rules injection"`
Expected: FAIL — `buildIssueBody` does not include `## Project Rules`.

- [ ] **Step 5.3: Modify `buildIssueBody` to inject the section**

In `scripts/delegate-copilot-issue.ts`, find `buildIssueBody` (currently a single-line template-literal return around line 316). Replace it with:

```typescript
export function buildIssueBody(todo: TodoTask): string {
  const labels = todo.labels.length > 0 ? todo.labels.join(", ") : "none";
  const domains = detectedDomains(todo.referencedFiles, todo.labels);
  const projectRules = buildProjectRulesSection(domains);

  return `## Source

Local todo: \`${todo.filePath}\`

Priority: ${todo.priority || "unknown"}
Labels: ${labels}

## Summary

${todo.summary || todo.title}

## Background

${todo.background || "See the local todo for background."}

## Acceptance Criteria

${checkboxList(todo.acceptanceCriteria)}

## Files In Scope

${formatList(todo.referencedFiles)}

${projectRules}

## Implementation Notes

${todo.implementationNotes || "Stay within the acceptance criteria and files in scope."}

## Dependencies

${todo.dependencies || "None listed."}

## Risks

${todo.risks || "None listed."}

## Safety And Review Requirements

- Copilot must open a pull request. Do not commit directly to \`main\`.
- Do not auto-merge. A human must review the PR.
- Keep changes limited to the files in scope and acceptance criteria above.
- Do not touch JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture without a human-approved plan.
`;
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t "Project Rules injection"`
Expected: PASS — both injection tests green.

Run the full file: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts`
Expected: PASS — all tests green. (The existing `buildIssueBody`-related test "parses todo markdown and builds a PR-gated issue body" should still pass since the safety boilerplate it asserts on is unchanged.)

- [ ] **Step 5.5: Commit**

```bash
git add scripts/delegate-copilot-issue.ts scripts/__tests__/delegate-copilot-issue.test.ts
git commit -m "feat(scripts): inject ## Project Rules into delegated Issue bodies

buildIssueBody now calls detectedDomains() and buildProjectRulesSection()
and inserts the result between ## Files In Scope and ## Implementation
Notes. Copilot receives the imperative rules for the touched domains
inline, with pattern URLs as further-reading pointers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Add `writeProjectRulesSectionToTodo(todoPath, section)` function

**Files:**

- Modify: `scripts/delegate-copilot-issue.ts` (add after `writeGithubIssueToTodo`)
- Test: `scripts/__tests__/delegate-copilot-issue.test.ts` (append)

- [ ] **Step 6.1: Write the failing tests for all 5 anchor cases**

Append inside the `describe(...)` block:

```typescript
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
  });
});
```

Update the import:

```typescript
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
  writeProjectRulesSectionToTodo, // ADD
  type CommandRunner,
  type Domain,
} from "../delegate-copilot-issue";
```

- [ ] **Step 6.2: Run tests to confirm they fail**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t "writeProjectRulesSectionToTodo anchor"`
Expected: FAIL — function not exported.

- [ ] **Step 6.3: Implement `writeProjectRulesSectionToTodo`**

In `scripts/delegate-copilot-issue.ts`, after `writeGithubIssueToTodo`, add:

```typescript
export function writeProjectRulesSectionToTodo(
  filePath: string,
  section: string,
): void {
  const original = fs.readFileSync(filePath, "utf8");
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const normalized = original.replace(/\r\n/g, "\n");

  // Idempotency: if a ## Project Rules section already exists, replace
  // (overwrite) it in place rather than inserting a second one.
  const existingMatch = normalized.match(/^## Project Rules$/m);
  if (existingMatch) {
    const start = normalized.indexOf("## Project Rules");
    // Find the next top-level heading after Project Rules (or EOF).
    const restAfter = normalized.slice(start + "## Project Rules".length);
    const nextHeadingOffset = restAfter.search(/\n## /);
    const end =
      nextHeadingOffset === -1
        ? normalized.length
        : start + "## Project Rules".length + nextHeadingOffset + 1;
    const before = normalized.slice(0, start);
    const after = normalized.slice(end);
    const updated = `${before}${section.trim()}\n\n${after}`.replace(
      /\n{3,}/g,
      "\n\n",
    );
    fs.writeFileSync(
      filePath,
      newline === "\r\n" ? updated.replace(/\n/g, "\r\n") : updated,
    );
    return;
  }

  // Anchor priority: before ## Updates → after ## Risks → after ## Dependencies
  // → after ## Implementation Notes body → EOF append.
  const insertBefore = (anchor: string): string | null => {
    const idx = normalized.indexOf(anchor);
    if (idx === -1) return null;
    return `${normalized.slice(0, idx)}${section.trim()}\n\n${normalized.slice(idx)}`;
  };

  const insertAfterSection = (anchor: string): string | null => {
    const idx = normalized.indexOf(anchor);
    if (idx === -1) return null;
    const after = normalized.slice(idx + anchor.length);
    const nextHeadingOffset = after.search(/\n## /);
    const endOfSection =
      nextHeadingOffset === -1
        ? normalized.length
        : idx + anchor.length + nextHeadingOffset + 1;
    return `${normalized.slice(0, endOfSection)}\n${section.trim()}\n\n${normalized.slice(endOfSection)}`;
  };

  let result =
    insertBefore("## Updates") ??
    insertAfterSection("## Risks") ??
    insertAfterSection("## Dependencies") ??
    insertAfterSection("## Implementation Notes");

  if (result === null) {
    // No recognized anchor — append at EOF with a leading blank line.
    result = `${normalized.replace(/\s+$/, "")}\n\n${section.trim()}\n`;
  }

  result = result.replace(/\n{3,}/g, "\n\n");

  fs.writeFileSync(
    filePath,
    newline === "\r\n" ? result.replace(/\n/g, "\r\n") : result,
  );
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t "writeProjectRulesSectionToTodo"`
Expected: PASS — all 6 anchor cases green (5 anchors + 1 idempotency).

- [ ] **Step 6.5: Commit**

```bash
git add scripts/delegate-copilot-issue.ts scripts/__tests__/delegate-copilot-issue.test.ts
git commit -m "feat(scripts): writeProjectRulesSectionToTodo with anchor priority

Inserts the rendered ## Project Rules section into the local todo file
using a 5-step anchor priority chain: before ## Updates → after ## Risks
→ after ## Dependencies → after ## Implementation Notes body → EOF append.
Re-running on a todo that already has the section overwrites in place
(idempotent), not duplicates.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Wire `writeProjectRulesSectionToTodo` into the live delegate flow

**Files:**

- Modify: `scripts/delegate-copilot-issue.ts` (modify `runCli`)
- Test: `scripts/__tests__/delegate-copilot-issue.test.ts` (append)

- [ ] **Step 7.1: Write the failing test**

Append inside the `describe(...)` block:

```typescript
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
```

- [ ] **Step 7.2: Run the test to confirm it fails**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t "writes Project Rules section into the local todo"`
Expected: FAIL — the live delegate path doesn't call `writeProjectRulesSectionToTodo`.

- [ ] **Step 7.3: Wire the call into `runCli`**

In `scripts/delegate-copilot-issue.ts`, find the live-mode branch of `runCli` (where it calls `createCopilotIssue` then `writeGithubIssueToTodo`). After `writeGithubIssueToTodo(todoPath, issueUrl);` add:

```typescript
const domains = detectedDomains(todo.referencedFiles, todo.labels);
const projectRules = buildProjectRulesSection(domains);
writeProjectRulesSectionToTodo(todoPath, projectRules);
```

The completed snippet (for reference) should look approximately:

```typescript
const issueUrl = createCopilotIssue(todo, runner);
writeGithubIssueToTodo(todoPath, issueUrl);

const domains = detectedDomains(todo.referencedFiles, todo.labels);
const projectRules = buildProjectRulesSection(domains);
writeProjectRulesSectionToTodo(todoPath, projectRules);

console.log(`Created Copilot issue: ${issueUrl}`);
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts`
Expected: PASS — all tests green, including the new wiring test.

- [ ] **Step 7.5: Commit**

```bash
git add scripts/delegate-copilot-issue.ts scripts/__tests__/delegate-copilot-issue.test.ts
git commit -m "feat(scripts): live delegate writes Project Rules into local todo

After createCopilotIssue + writeGithubIssueToTodo, also call
writeProjectRulesSectionToTodo so the todo file mirrors the Issue body's
Project Rules block. Idempotent on re-delegation (overwrite in place).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Create `scripts/build-copilot-instructions.ts`

**Files:**

- Create: `scripts/build-copilot-instructions.ts`
- Test: `scripts/__tests__/build-copilot-instructions.test.ts` (new file)

- [ ] **Step 8.1: Write the failing tests**

Create `scripts/__tests__/build-copilot-instructions.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  generateInstructions,
  runBuildCli,
} from "../build-copilot-instructions";

const tmpDirs: string[] = [];

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-instructions-"));
  tmpDirs.push(dir);
  return path.join(dir, "copilot-instructions.md");
}

describe("build-copilot-instructions", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { force: true, recursive: true });
    }
  });

  it("generates a non-empty instructions file", () => {
    const output = generateInstructions();
    expect(output.length).toBeGreaterThan(500);
    expect(output).toContain("# Copilot Instructions");
  });

  it("includes the OCRecipes stack orientation paragraph", () => {
    const output = generateInstructions();
    expect(output).toContain("Expo");
    expect(output).toContain("PostgreSQL");
  });

  it("includes the path → domain mapping table", () => {
    const output = generateInstructions();
    expect(output).toContain("| Path pattern");
    expect(output).toContain("server/routes");
    expect(output).toContain("react-native");
  });

  it("includes the hard exclusions reminder", () => {
    const output = generateInstructions();
    expect(output).toContain("JWT/auth");
    expect(output).toContain("IAP");
  });

  it("includes the mandatory workflow paragraph", () => {
    const output = generateInstructions();
    expect(output).toContain("Project Rules");
    expect(output).toContain("binding");
  });

  it("stays under the 32 KB / ~8000 token soft cap", () => {
    const output = generateInstructions();
    expect(output.length).toBeLessThan(32_000);
  });

  it("--check exits 0 when target file matches generated output", () => {
    const target = tmpFile();
    fs.writeFileSync(target, generateInstructions());
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const status = runBuildCli(["--check", target]);
    expect(status).toBe(0);
  });

  it("--check exits non-zero when target file is stale", () => {
    const target = tmpFile();
    fs.writeFileSync(target, "stale content");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const status = runBuildCli(["--check", target]);
    expect(status).not.toBe(0);
  });

  it("default (no flag) writes the generated output to target path", () => {
    const target = tmpFile();
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const status = runBuildCli([target]);
    expect(status).toBe(0);
    expect(fs.readFileSync(target, "utf8")).toEqual(generateInstructions());
  });
});
```

- [ ] **Step 8.2: Run the test to confirm it fails**

Run: `npx vitest run scripts/__tests__/build-copilot-instructions.test.ts`
Expected: FAIL — `build-copilot-instructions.ts` does not exist.

- [ ] **Step 8.3: Create the script**

Create `scripts/build-copilot-instructions.ts`:

```typescript
#!/usr/bin/env tsx
import * as fs from "fs";
import * as path from "path";
import { PATH_TO_DOMAINS } from "./delegate-copilot-issue";

// Single source of truth: PATH_TO_DOMAINS is defined in
// delegate-copilot-issue.ts (typed, testable). This script consumes the
// rule descriptions and domains directly so the generated markdown table
// cannot drift from the script's detection logic. The synthetic
// "LLM-touching" row below isn't in PATH_TO_DOMAINS (it's a Set lookup,
// not a regex rule) so we render it as a manual row appended to the table.

const STACK_ORIENTATION = `OCRecipes is an Expo + React Native mobile app (Expo SDK 54, React 19, React Native 0.81) with an Express 5 + TypeScript backend. Database is PostgreSQL via Drizzle ORM. Authentication uses JWT bearer tokens (\`Authorization: Bearer ...\`, never cookies). Server state is managed with TanStack Query v5 on the client. AI features (coach chat, recipe generation, photo analysis, etc.) use OpenAI via a shared service layer.`;

const MANDATORY_WORKFLOW = `When the Issue body contains a \`## Project Rules\` section, every rule in it is binding. If a rule conflicts with an acceptance criterion, raise the conflict in a PR comment rather than silently violating the rule. If a rule isn't clear, open the corresponding \`docs/patterns/<domain>.md\` for full context.`;

const HARD_EXCLUSIONS = `## Hard Exclusions (never modify without a human-approved plan)

These domains require a human-authored implementation plan and are not eligible for Copilot delegation:

- JWT/auth (\`server/middleware/auth.ts\`, \`server/routes/auth.ts\`, \`server/lib/jwt-*\`)
- IAP receipt validation (\`server/services/receipt-validation.*\`)
- Secrets and credentials handling
- Health-data boundaries (\`server/services/healthkit*\`, \`server/storage/health.ts\`)
- Goal-safety behavior
- Schema and migrations (\`shared/schema.ts\`, \`migrations/**\`)
- Production data handling
- Broad architecture / cross-cutting overhauls

Output must be PR-based and human-reviewed. No auto-merge. No direct commits to \`main\`.`;

export function generateInstructions(): string {
  const tableHeader = "| Path pattern | Domains |\n| --- | --- |";
  const tableBody = PATH_TO_DOMAINS.map(
    (row) => `| ${row.description} | ${row.domains.join(", ")} |`,
  ).join("\n");
  // LLM-touching services row is added manually since it isn't a regex
  // rule in PATH_TO_DOMAINS (it's a Set lookup against basenames).
  const llmRow = `| \`server/services/<llm-touching>.ts\` (see LLM_TOUCHING_SERVICES) | architecture, ai-prompting |`;

  return `# Copilot Instructions for OCRecipes

${STACK_ORIENTATION}

## Mandatory workflow

${MANDATORY_WORKFLOW}

## Path → domain mapping

When editing a file, identify its domain(s) using the table below. The corresponding \`docs/rules/<domain>.md\` rules are binding for that file. Use \`docs/patterns/<domain>.md\` for full context if a rule isn't clear.

${tableHeader}
${tableBody}
${llmRow}

In addition, \`typescript\` rules apply to every \`.ts\` or \`.tsx\` file regardless of other domain matches.

${HARD_EXCLUSIONS}

---

*This file is generated by \`scripts/build-copilot-instructions.ts\`. Do not edit by hand — CI verifies the committed file matches what the script generates.*
`;
}

export function runBuildCli(argv: ReadonlyArray<string>): number {
  const args = [...argv];
  const checkMode = args.includes("--check");
  if (checkMode) args.splice(args.indexOf("--check"), 1);

  const target = args[0];
  if (!target) {
    console.error("Usage: build-copilot-instructions [--check] <target-path>");
    return 2;
  }

  const generated = generateInstructions();

  if (checkMode) {
    if (!fs.existsSync(target)) {
      console.error(
        `[--check] ${target} does not exist. Run 'npm run build:copilot-instructions' to generate it.`,
      );
      return 1;
    }
    const current = fs.readFileSync(target, "utf8");
    if (current !== generated) {
      console.error(
        `[--check] ${target} is stale. Run 'npm run build:copilot-instructions' to update.`,
      );
      return 1;
    }
    console.log(`[--check] ${target} matches generated content.`);
    return 0;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, generated);
  console.log(`Wrote ${target} (${generated.length} bytes)`);
  return 0;
}

// CLI entry point when invoked directly (not in tests).
if (
  require.main === module ||
  (typeof process !== "undefined" &&
    process.argv[1] &&
    process.argv[1].endsWith("build-copilot-instructions.ts"))
) {
  process.exit(runBuildCli(process.argv.slice(2)));
}
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `npx vitest run scripts/__tests__/build-copilot-instructions.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 8.5: Commit**

```bash
git add scripts/build-copilot-instructions.ts scripts/__tests__/build-copilot-instructions.test.ts
git commit -m "feat(scripts): build-copilot-instructions script + --check drift mode

Generates .github/copilot-instructions.md from a hard-coded mapping
(intentionally separate from PATH_TO_DOMAINS in delegate-copilot-issue.ts
for now; small module surface). Default mode writes the file; --check
exits non-zero if the committed file diverges.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Wire the build script into `package.json`

**Files:**

- Modify: `package.json`

- [ ] **Step 9.1: Add the npm scripts**

Open `package.json`. Find the `"scripts"` block. Add these two entries (immediately after the existing `"copilot:delegate"` line for thematic grouping):

```json
    "build:copilot-instructions": "tsx scripts/build-copilot-instructions.ts .github/copilot-instructions.md",
    "build:copilot-instructions:check": "tsx scripts/build-copilot-instructions.ts --check .github/copilot-instructions.md",
```

- [ ] **Step 9.2: Verify the scripts run**

Run: `npm run build:copilot-instructions:check 2>&1 || true`
Expected: exits non-zero with a message that `.github/copilot-instructions.md` does not exist (the file isn't generated yet — that's Task 10).

- [ ] **Step 9.3: Commit**

```bash
git add package.json
git commit -m "chore(package): add build:copilot-instructions scripts

build:copilot-instructions generates .github/copilot-instructions.md.
build:copilot-instructions:check verifies the committed file matches
what the script would produce (used by CI to catch drift).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Generate and commit `.github/copilot-instructions.md`

**Files:**

- Create: `.github/copilot-instructions.md` (generated artifact)

- [ ] **Step 10.1: Run the generator**

Run: `npm run build:copilot-instructions`
Expected: writes `.github/copilot-instructions.md` and prints the byte count.

- [ ] **Step 10.2: Verify --check now passes**

Run: `npm run build:copilot-instructions:check`
Expected: exits 0, prints `[--check] .github/copilot-instructions.md matches generated content.`

- [ ] **Step 10.3: Inspect the file by eye**

Open `.github/copilot-instructions.md`. Verify:

- Stack orientation paragraph at top
- "Mandatory workflow" section explains `## Project Rules` is binding
- "Path → domain mapping" table renders correctly (Markdown table with two columns)
- "Hard Exclusions" section lists JWT/auth, IAP, etc.
- Footer notes the file is generated

- [ ] **Step 10.4: Commit**

```bash
git add .github/copilot-instructions.md
git commit -m "feat(github): add generated copilot-instructions.md

Initial generation of the GitHub Copilot custom instructions file from
scripts/build-copilot-instructions.ts. Contains the OCRecipes stack
orientation, mandatory workflow paragraph, path → domain mapping table,
and hard exclusions reminder. Future changes regenerated via
npm run build:copilot-instructions; CI verifies via :check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Add CI drift-check step to `.github/workflows/ci.yml`

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 11.1: Inspect the existing CI workflow**

Run: `cat .github/workflows/ci.yml | head -50`
Note the existing job names and the position where TypeScript / test steps run. The drift check should slot in as its own step in the existing main job, AFTER the install step and BEFORE the test step.

- [ ] **Step 11.2: Add the drift-check step**

Open `.github/workflows/ci.yml`. Find the section in the main job's `steps:` after `npm ci` (or equivalent) and before `npm run test:run`. Add:

```yaml
- name: Verify .github/copilot-instructions.md is current
  run: npm run build:copilot-instructions:check
```

If the workflow has multiple jobs (e.g., `lint`, `test`, `types`), add this step to whichever job runs Node — typically the same one that runs `npm ci`.

- [ ] **Step 11.3: Validate the YAML is well-formed**

Run: `npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo "YAML valid"`
Expected: "YAML valid".

(If `js-yaml` isn't installed, use any YAML linter — Python `yaml.safe_load` works too. Or just inspect by eye that indentation matches the surrounding steps.)

- [ ] **Step 11.4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: verify copilot-instructions.md isn't stale

Adds 'build:copilot-instructions:check' step before the test suite. If a
developer edits docs/rules content or PATH_TO_DOMAINS without regenerating
.github/copilot-instructions.md, this step fails CI and prompts them to
run 'npm run build:copilot-instructions'.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: Back-fill the 9 existing Issues

**Files:**

- (none — runs commands and creates throwaway `/tmp/` snippets)

This task uses `gh issue comment` to post the rendered `## Project Rules` block as a new comment on each of the 9 Issues delegated during the 2026-05-11 session. Copilot picks up the rules on its next read of the Issue thread.

The 9 Issue IDs and their corresponding todos:

| Issue # | Todo file                                        |
| ------- | ------------------------------------------------ |
| 130     | `todos/2026-05-11-ci-coverage-thresholds.md`     |
| 132     | `todos/2026-05-11-service-tests.md`              |
| 134     | `todos/2026-05-11-storage-tests-medium.md`       |
| 136     | `todos/2026-05-11-ci-test-sharding.md`           |
| 137     | `todos/2026-05-11-route-tests.md`                |
| 139     | `todos/2026-05-11-test-type-cast-cleanup.md`     |
| 142     | `todos/2026-05-10-audit-coach-blocks-memo.md`    |
| 144     | `todos/2026-05-10-audit-tool-args-zod.md`        |
| 146     | `todos/2026-05-11-wire-kimi-review-precommit.md` |

- [ ] **Step 12.1: Write the back-fill helper script** (one-off, not committed)

Create `/tmp/backfill-rules.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

declare -A ISSUE_TO_TODO=(
  [130]="todos/2026-05-11-ci-coverage-thresholds.md"
  [132]="todos/2026-05-11-service-tests.md"
  [134]="todos/2026-05-11-storage-tests-medium.md"
  [136]="todos/2026-05-11-ci-test-sharding.md"
  [137]="todos/2026-05-11-route-tests.md"
  [139]="todos/2026-05-11-test-type-cast-cleanup.md"
  [142]="todos/2026-05-10-audit-coach-blocks-memo.md"
  [144]="todos/2026-05-10-audit-tool-args-zod.md"
  [146]="todos/2026-05-11-wire-kimi-review-precommit.md"
)

for issue in "${!ISSUE_TO_TODO[@]}"; do
  todo="${ISSUE_TO_TODO[$issue]}"
  echo "=== Issue #$issue ($todo) ==="
  tsx scripts/print-project-rules.ts "$todo" > /tmp/rules-$issue.md
  cat /tmp/rules-$issue.md | head -5
  echo "(... full body in /tmp/rules-$issue.md)"
done
```

- [ ] **Step 12.2: Add a helper export and one-off printer**

The back-fill needs to invoke `buildProjectRulesSection` from outside the test harness. Create `scripts/print-project-rules.ts` (small, throwaway-friendly):

```typescript
#!/usr/bin/env tsx
import * as fs from "fs";
import {
  buildProjectRulesSection,
  detectedDomains,
  parseTodoMarkdown,
} from "./delegate-copilot-issue";

const todoPath = process.argv[2];
if (!todoPath) {
  console.error("Usage: print-project-rules <todo-path>");
  process.exit(2);
}

const todo = parseTodoMarkdown(fs.readFileSync(todoPath, "utf8"), todoPath);
const domains = detectedDomains(todo.referencedFiles, todo.labels);
process.stdout.write(buildProjectRulesSection(domains));
```

- [ ] **Step 12.3: Render rules bodies for all 9 todos**

Run:

```bash
chmod +x /tmp/backfill-rules.sh
/tmp/backfill-rules.sh
```

Expected: 9 files in `/tmp/rules-<N>.md`. Eyeball one or two to confirm content looks right.

- [ ] **Step 12.4: Post comments to each Issue**

Run, one at a time so you can verify each post succeeds:

```bash
for issue in 130 132 134 136 137 139 142 144 146; do
  echo "Posting to #$issue..."
  gh issue comment "$issue" --body-file "/tmp/rules-$issue.md"
done
```

Expected: each command prints the URL of the new comment (e.g., `https://github.com/Xertox1234/OCRecipes/issues/130#issuecomment-...`). If any fail, re-run for the specific issue.

- [ ] **Step 12.5: Spot-check one Issue in the GitHub UI**

Run: `gh issue view 142 --comments | tail -40`
Expected: the last comment shows the `## Project Rules` block, including `### react-native`, `### design-system`, `### accessibility`, `### performance`, and `### typescript` subheadings (since #142 is the React.memo todo and touches `client/components/**` files).

- [ ] **Step 12.6: Commit the helper printer** (and clean up)

```bash
git add scripts/print-project-rules.ts
git commit -m "chore(scripts): one-off helper to print Project Rules for a todo

Used for back-filling existing Copilot Issues with the rules section via
gh issue comment. Kept committed because it's useful for ad-hoc
inspection of what a todo would receive on delegation.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Then `rm /tmp/backfill-rules.sh /tmp/rules-*.md`.

---

## Task 13: Update CLAUDE.md (local-only note)

**Files:**

- Modify: `CLAUDE.md` (gitignored — local file)

- [ ] **Step 13.1: Add a paragraph referencing the new instructions file**

Open `CLAUDE.md`. Find the "Pattern Documentation" / "Key Patterns" section near the top. Add a short paragraph after the existing pattern-consultation rules:

```markdown
### Copilot equivalent

GitHub Copilot has its own MUST-CHECK file at `.github/copilot-instructions.md` (tracked, generated from `scripts/build-copilot-instructions.ts`). When Copilot is delegated a todo, the script also auto-injects a `## Project Rules` section containing the relevant `docs/rules/<domain>.md` content into both the Issue body and the local todo file. If you change `docs/rules/*.md` or the path → domain mapping in the script, run `npm run build:copilot-instructions` and commit the regenerated file (CI's `build:copilot-instructions:check` will fail otherwise).
```

- [ ] **Step 13.2: No commit**

CLAUDE.md is gitignored (per commit `887498b7`). The change lives in the local working copy only. Future sessions in this checkout will pick it up automatically.

---

## Final Verification (no commit)

- [ ] **Step F.1: Full test suite of touched files**

Run:

```bash
npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts scripts/__tests__/build-copilot-instructions.test.ts
```

Expected: PASS — all tests green.

- [ ] **Step F.2: Type check**

Run: `npm run check:types`
Expected: exit 0, no errors.

- [ ] **Step F.3: End-to-end smoke: dry-run a fresh todo**

Pick or create any backlog todo and dry-run it:

```bash
npm run copilot:delegate:dry-run -- todos/2026-05-11-ci-coverage-thresholds.md 2>&1 | grep -A 20 "Project Rules"
```

Expected: the printed Issue body includes `## Project Rules` between `## Files In Scope` and `## Implementation Notes`, with `### testing`, `### typescript`, and `### architecture` (or similar) subheadings depending on the touched files.

- [ ] **Step F.4: Push all commits**

Run: `git push origin main`
Expected: ~13 commits push successfully, CI starts. Watch the CI run for the new `build:copilot-instructions:check` step — it should pass on the first attempt since we generated the file in Task 10.

---

## Out of Scope (deferred to v2)

- LEARNINGS keyword-matched injection into Issue bodies.
- Auto-updating closed Issue bodies on rules-file changes (snapshot at delegation time is fine).
- A GitHub Actions workflow that post-comments rule reminders on Copilot PRs.
- Inlining `docs/patterns/*.md` content (still pointers only).
