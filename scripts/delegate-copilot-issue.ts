import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

type FrontmatterValue = string | string[];

export interface TodoTask {
  filePath: string;
  title: string;
  status: string;
  priority: string;
  githubIssue: string;
  labels: string[];
  summary: string;
  background: string;
  acceptanceCriteria: string[];
  implementationNotes: string;
  dependencies: string;
  risks: string;
  taskText: string;
  referencedFiles: string[];
  raw: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type CommandRunner = (
  command: string,
  args: string[],
  input: string,
) => CommandResult;

const ALLOWED_LABELS = new Set([
  "code-quality",
  "docs",
  "documentation",
  "performance",
  "refactor",
  "simple-refactor",
  "test",
  "testing",
]);

type BlockKey =
  | "JWT_AUTH"
  | "IAP_RECEIPT"
  | "SECRETS"
  | "HEALTH_DATA"
  | "GOAL_SAFETY"
  | "SCHEMA_MIGRATION"
  | "PRODUCTION_DATA"
  | "BROAD_ARCHITECTURE";

const BLOCK_REASONS: Record<BlockKey, string> = {
  JWT_AUTH: "JWT/auth work is not eligible for Copilot delegation",
  IAP_RECEIPT: "IAP receipt validation is not eligible for Copilot delegation",
  SECRETS: "secrets handling is not eligible for Copilot delegation",
  HEALTH_DATA:
    "health-data boundary work is not eligible for Copilot delegation",
  GOAL_SAFETY: "goal-safety behavior is not eligible for Copilot delegation",
  SCHEMA_MIGRATION:
    "schema and migration work is not eligible for Copilot delegation",
  PRODUCTION_DATA:
    "production data handling is not eligible for Copilot delegation",
  BROAD_ARCHITECTURE:
    "broad architecture work needs a human-approved plan first",
};

const BLOCKED_PATTERNS: [RegExp, BlockKey][] = [
  [/\bjwt\b/i, "JWT_AUTH"],
  [/\bauth(?:entication|orization)?\b/i, "JWT_AUTH"],
  [/\biap\b|\breceipt validation\b/i, "IAP_RECEIPT"],
  [/\bsecret(s)?\b/i, "SECRETS"],
  [/\bhealth[-\s]?data\b|\bhealth data boundaries\b/i, "HEALTH_DATA"],
  [/\bgoal[-\s]?safety\b/i, "GOAL_SAFETY"],
  [
    /\bshared\/schema\.ts\b|\bmigrations\/|\bmigration(s)?\b/i,
    "SCHEMA_MIGRATION",
  ],
  [/\bproduction data\b|\bprod data\b/i, "PRODUCTION_DATA"],
  [/\bbroad architecture\b|\barchitecture overhaul\b/i, "BROAD_ARCHITECTURE"],
];

// Body-text reasons that test-labeled todos may skip. Tests describe the code
// under test, so an incidental mention of these areas in a test todo's
// description does not imply the work modifies them. Conceptual concerns
// (goal-safety, production data, broad architecture, schema/migrations) are
// NOT bypassable — those describe scope, not just context. Implementation
// files in those bypassable areas are still blocked via BLOCKED_FILE_PATTERNS
// below, so the bypass only relaxes incidental text mentions, not actual scope.
const TEST_BYPASSABLE_KEYS = new Set<BlockKey>([
  "JWT_AUTH",
  "IAP_RECEIPT",
  "SECRETS",
  "HEALTH_DATA",
]);

// Path-based blocks. These apply regardless of label — a todo whose
// referencedFiles list includes one of these implementation paths cannot be
// delegated even if labeled test/testing. Test files under __tests__/ and
// mocks under __mocks__/ naturally do NOT match these prefixes.
const BLOCKED_FILE_PATTERNS: [RegExp, BlockKey][] = [
  [/^shared\/schema\.ts$/, "SCHEMA_MIGRATION"],
  [/^migrations\//, "SCHEMA_MIGRATION"],
  [/^server\/middleware\/auth\.ts$/, "JWT_AUTH"],
  [/^server\/routes\/auth\.ts$/, "JWT_AUTH"],
  [/^server\/lib\/jwt-/, "JWT_AUTH"],
  [/^server\/services\/receipt-validation\./, "IAP_RECEIPT"],
  [/^server\/storage\/health\.ts$/, "HEALTH_DATA"],
  [/^server\/services\/healthkit/, "HEALTH_DATA"],
  [/^server\/routes\/healthkit/, "HEALTH_DATA"],
];

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
// A companion drift-detection test (see scripts/__tests__/delegate-copilot-issue.test.ts)
// re-runs the grep and fails if a new LLM-touching service is added without
// being included here.
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
  readonly domains: readonly Domain[];
  readonly description: string;
}

export const PATH_TO_DOMAINS: readonly PathDomainRule[] = [
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
    description: "`__tests__/**`, `*.test.ts(x)`, `*.spec.ts(x)`",
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

// Label → forced domain. Only `testing` and `performance` map to rules
// domains. Other allowed labels (code-quality, docs, refactor) don't have
// dedicated rules files and are ignored.
const LABEL_TO_FORCED_DOMAIN: Record<string, Domain> = {
  test: "testing",
  testing: "testing",
  performance: "performance",
};

export function detectedDomains(
  referencedFiles: readonly string[],
  labels: readonly string[],
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

const PATTERNS_URL_BASE =
  "https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns";

const PROJECT_RULES_PREAMBLE = `The rules below are binding. If any rule conflicts with the acceptance criteria, raise it in a PR comment rather than silently violating it. Open the linked pattern file for full context if a rule isn't clear.`;

export function buildProjectRulesSection(domains: readonly Domain[]): string {
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

const FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".md",
  ".json",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
]);

function parseFrontmatterValue(value: string): FrontmatterValue {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['\"]|['\"]$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^['\"]|['\"]$/g, "");
}

function parseFrontmatter(markdown: string): Record<string, FrontmatterValue> {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {};
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return {};
  }

  const frontmatter: Record<string, FrontmatterValue> = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    frontmatter[match[1]] = parseFrontmatterValue(match[2] ?? "");
  }
  return frontmatter;
}

function getString(value: FrontmatterValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function getStringArray(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    return "";
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    sectionLines.push(line);
  }

  return sectionLines.join("\n").trim();
}

function extractAcceptanceCriteria(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.match(/^\s*- \[[ xX]\]\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

export function extractReferencedFiles(text: string): string[] {
  const files = new Set<string>();

  for (const token of text.split(/[\s`<>{}\[\],]+/)) {
    const withoutLineRange = token.replace(/:\d+(?:-\d+)?$/, "");
    const candidate = withoutLineRange.replace(/^["']|["'.;:]$/g, "");
    if (!candidate.includes("/")) {
      continue;
    }
    if (candidate.includes("..") || path.isAbsolute(candidate)) {
      continue;
    }
    if (FILE_EXTENSIONS.has(path.extname(candidate))) {
      files.add(candidate);
    }
  }

  return [...files].sort();
}

export function parseTodoMarkdown(
  markdown: string,
  filePath: string,
): TodoTask {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const frontmatter = parseFrontmatter(normalized);
  const title = getString(frontmatter.title) || path.basename(filePath, ".md");
  const labels = getStringArray(frontmatter.labels).map((label) =>
    label.toLowerCase(),
  );
  const summary = extractSection(normalized, "Summary");
  const background = extractSection(normalized, "Background");
  const acceptanceSection = extractSection(normalized, "Acceptance Criteria");
  const implementationNotes = extractSection(
    normalized,
    "Implementation Notes",
  );
  const dependencies = extractSection(normalized, "Dependencies");
  const risks = extractSection(normalized, "Risks");
  const scopedText = [acceptanceSection, implementationNotes].join("\n\n");
  const taskText = [
    title,
    summary,
    background,
    acceptanceSection,
    implementationNotes,
    dependencies,
    risks,
  ].join("\n\n");

  return {
    filePath,
    title,
    status: getString(frontmatter.status).toLowerCase(),
    priority: getString(frontmatter.priority).toLowerCase(),
    githubIssue: getString(frontmatter.github_issue),
    labels,
    summary,
    background,
    acceptanceCriteria: extractAcceptanceCriteria(acceptanceSection),
    implementationNotes,
    dependencies,
    risks,
    taskText,
    referencedFiles: extractReferencedFiles(scopedText),
    raw: markdown,
  };
}

export function evaluateEligibility(todo: TodoTask): EligibilityResult {
  const reasons: string[] = [];
  const taskText = todo.taskText.toLowerCase();
  const labelSet = new Set(todo.labels);
  const hasAllowedLabel = todo.labels.some((label) =>
    ALLOWED_LABELS.has(label),
  );
  const isDeferredOrLow = todo.priority === "low" || labelSet.has("deferred");

  if (!new Set(["backlog", "planned"]).has(todo.status)) {
    reasons.push(
      `status must be backlog or planned, got ${todo.status || "missing"}`,
    );
  }

  if (todo.githubIssue) {
    reasons.push(`todo already has github_issue: ${todo.githubIssue}`);
  }

  if (!isDeferredOrLow) {
    reasons.push("todo must be low priority or labeled deferred");
  }

  if (!hasAllowedLabel && !labelSet.has("deferred")) {
    reasons.push(
      "todo must be labeled as docs, tests, code-quality, performance, refactor, or deferred",
    );
  }

  if (todo.acceptanceCriteria.length === 0) {
    reasons.push("todo must include checkbox acceptance criteria");
  }

  if (todo.referencedFiles.length === 0) {
    reasons.push(
      "todo must name clear in-scope files in acceptance criteria or implementation notes",
    );
  }

  const isTestOnly = labelSet.has("test") || labelSet.has("testing");

  for (const [pattern, key] of BLOCKED_PATTERNS) {
    if (!pattern.test(taskText)) {
      continue;
    }
    if (isTestOnly && TEST_BYPASSABLE_KEYS.has(key)) {
      // A todo labeled test/testing describes the code under test; an incidental
      // mention of auth, IAP, secrets, or health-data in the description doesn't
      // mean the work modifies those areas. The BLOCKED_FILE_PATTERNS loop
      // below still blocks any actual implementation file in scope.
      continue;
    }
    reasons.push(BLOCK_REASONS[key]);
  }

  const reportedFileBlocks = new Set<BlockKey>();
  for (const file of todo.referencedFiles) {
    for (const [pattern, key] of BLOCKED_FILE_PATTERNS) {
      if (!pattern.test(file) || reportedFileBlocks.has(key)) {
        continue;
      }
      reportedFileBlocks.add(key);
      reasons.push(
        key === "SCHEMA_MIGRATION"
          ? "schema and migration files are not eligible for Copilot delegation"
          : BLOCK_REASONS[key],
      );
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

function formatList(items: string[], fallback = "None listed."): string {
  if (items.length === 0) {
    return fallback;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function checkboxList(items: string[]): string {
  if (items.length === 0) {
    return "- [ ] Review the source todo and complete the bounded task.";
  }
  return items.map((item) => `- [ ] ${item}`).join("\n");
}

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

export function defaultRunner(
  command: string,
  args: string[],
  input: string,
): CommandResult {
  const result = spawnSync(command, args, { encoding: "utf8", input });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function createCopilotIssue(
  todo: TodoTask,
  runner: CommandRunner = defaultRunner,
): string {
  const body = buildIssueBody(todo);
  const args = [
    "issue",
    "create",
    "--title",
    `[Copilot] ${todo.title}`,
    "--body-file",
    "-",
    "--assignee",
    "@copilot",
    "--label",
    "copilot",
    "--label",
    "delegated",
  ];

  const result = runner("gh", args, body);
  if (result.status !== 0) {
    const detail =
      result.stderr || result.error?.message || "unknown gh failure";
    throw new Error(
      `Failed to create Copilot issue or assign @copilot: ${detail}`,
    );
  }

  const issueUrl = result.stdout.trim();
  if (!issueUrl) {
    throw new Error(
      "Failed to create Copilot issue or assign @copilot: gh returned no issue URL",
    );
  }

  return issueUrl;
}

export function loadTodo(filePath: string): TodoTask {
  return parseTodoMarkdown(fs.readFileSync(filePath, "utf8"), filePath);
}

export function writeGithubIssueToTodo(
  filePath: string,
  issueUrl: string,
): void {
  const content = fs.readFileSync(filePath, "utf8");
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    throw new Error(
      "todo file must have YAML frontmatter before github_issue can be updated",
    );
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error("todo file frontmatter is missing closing delimiter");
  }

  const frontmatter = normalized.slice(4, end);
  const updatedFrontmatter = /^github_issue:/m.test(frontmatter)
    ? frontmatter.replace(/^github_issue:.*$/m, `github_issue: ${issueUrl}`)
    : `${frontmatter}\ngithub_issue: ${issueUrl}`;
  const updated = `---\n${updatedFrontmatter}${normalized.slice(end)}`;

  fs.writeFileSync(filePath, updated.replace(/\n/g, newline));
}

export function writeProjectRulesSectionToTodo(
  filePath: string,
  section: string,
): void {
  const original = fs.readFileSync(filePath, "utf8");
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const normalized = original.replace(/\r\n/g, "\n");

  // Find the byte offset of a `## Heading` line that's on its own line
  // (i.e., a real heading, not a mid-sentence mention in body text).
  // Returns -1 if not found.
  const findHeadingOffset = (heading: string): number => {
    if (normalized.startsWith(`${heading}\n`)) return 0;
    const needle = `\n${heading}\n`;
    const newlineIdx = normalized.indexOf(needle);
    return newlineIdx === -1 ? -1 : newlineIdx + 1;
  };

  // Idempotency: if a ## Project Rules section already exists (as a real
  // heading, not a mid-sentence mention), replace it in place rather than
  // inserting a duplicate.
  const existingStart = findHeadingOffset("## Project Rules");
  if (existingStart !== -1) {
    const restAfter = normalized.slice(
      existingStart + "## Project Rules".length,
    );
    const nextHeadingOffset = restAfter.search(/\n## /);
    const end =
      nextHeadingOffset === -1
        ? normalized.length
        : existingStart + "## Project Rules".length + nextHeadingOffset + 1;
    const before = normalized.slice(0, existingStart);
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
    const idx = findHeadingOffset(anchor);
    if (idx === -1) return null;
    return `${normalized.slice(0, idx)}${section.trim()}\n\n${normalized.slice(idx)}`;
  };

  const insertAfterSection = (anchor: string): string | null => {
    const idx = findHeadingOffset(anchor);
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

export function resolveTodoPath(
  filePath: string,
  rootDir = process.cwd(),
): string {
  const root = path.resolve(rootDir);
  const todosDir = path.join(root, "todos");
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(todosDir, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("todo path must be inside the todos/ directory");
  }
  if (path.extname(resolved) !== ".md") {
    throw new Error("todo path must point to a markdown file");
  }

  return resolved;
}

function usage(): string {
  return [
    "Usage: npx tsx scripts/delegate-copilot-issue.ts [--dry-run|--live] todos/<file>.md",
    "",
    "Creates a GitHub Issue assigned to @copilot when the todo passes safety gates.",
  ].join("\n");
}

export function parseArgs(args: string[]): {
  dryRun: boolean;
  filePath?: string;
} {
  const dryRun = !args.includes("--live");
  const filePath = args.find((arg) => !arg.startsWith("--"));
  return { dryRun: args.includes("--dry-run") || dryRun, filePath };
}

export function runCli(
  args: string[],
  runner: CommandRunner = defaultRunner,
): number {
  const { dryRun, filePath } = parseArgs(args);
  if (!filePath) {
    console.error(usage());
    return 1;
  }

  try {
    const resolvedPath = resolveTodoPath(filePath);
    const todo = loadTodo(resolvedPath);
    const displayPath = path.relative(process.cwd(), resolvedPath);
    const todoForIssue = { ...todo, filePath: displayPath };
    const eligibility = evaluateEligibility(todoForIssue);
    if (!eligibility.eligible) {
      console.error("Todo is not eligible for Copilot delegation:");
      for (const reason of eligibility.reasons) {
        console.error(`- ${reason}`);
      }
      return 1;
    }

    const body = buildIssueBody(todoForIssue);
    if (dryRun) {
      console.log("DRY RUN: Copilot issue would be created.");
      console.log(`Title: [Copilot] ${todoForIssue.title}`);
      console.log("Assignee: @copilot");
      console.log("Labels: copilot, delegated");
      console.log("\n--- Issue Body ---\n");
      console.log(body);
      return 0;
    }

    const issueUrl = createCopilotIssue(todoForIssue, runner);
    writeGithubIssueToTodo(resolvedPath, issueUrl);

    const domains = detectedDomains(todo.referencedFiles, todo.labels);
    const projectRules = buildProjectRulesSection(domains);
    writeProjectRulesSectionToTodo(resolvedPath, projectRules);

    console.log(`Created Copilot issue: ${issueUrl}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1]?.endsWith("delegate-copilot-issue.ts")) {
  process.exitCode = runCli(process.argv.slice(2));
}
