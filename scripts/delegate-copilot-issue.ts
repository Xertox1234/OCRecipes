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

const BLOCKED_PATTERNS: [RegExp, string][] = [
  [/\bjwt\b/i, "JWT/auth work is not eligible for Copilot delegation"],
  [
    /\bauth(?:entication|orization)?\b/i,
    "JWT/auth work is not eligible for Copilot delegation",
  ],
  [
    /\biap\b|\breceipt validation\b/i,
    "IAP receipt validation is not eligible for Copilot delegation",
  ],
  [
    /\bsecret(s)?\b/i,
    "secrets handling is not eligible for Copilot delegation",
  ],
  [
    /\bhealth[-\s]?data\b|\bhealth data boundaries\b/i,
    "health-data boundary work is not eligible for Copilot delegation",
  ],
  [
    /\bgoal[-\s]?safety\b/i,
    "goal-safety behavior is not eligible for Copilot delegation",
  ],
  [
    /\bshared\/schema\.ts\b|\bmigrations\/|\bmigration(s)?\b/i,
    "schema and migration work is not eligible for Copilot delegation",
  ],
  [
    /\bproduction data\b|\bprod data\b/i,
    "production data handling is not eligible for Copilot delegation",
  ],
  [
    /\bbroad architecture\b|\barchitecture overhaul\b/i,
    "broad architecture work needs a human-approved plan first",
  ],
];

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

  for (const [pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(taskText)) {
      reasons.push(reason);
    }
  }

  for (const file of todo.referencedFiles) {
    if (file === "shared/schema.ts" || file.startsWith("migrations/")) {
      reasons.push(
        "schema and migration files are not eligible for Copilot delegation",
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

  return `## Source\n\nLocal todo: \`${todo.filePath}\`\n\nPriority: ${todo.priority || "unknown"}\nLabels: ${labels}\n\n## Summary\n\n${todo.summary || todo.title}\n\n## Background\n\n${todo.background || "See the local todo for background."}\n\n## Acceptance Criteria\n\n${checkboxList(todo.acceptanceCriteria)}\n\n## Files In Scope\n\n${formatList(todo.referencedFiles)}\n\n## Implementation Notes\n\n${todo.implementationNotes || "Stay within the acceptance criteria and files in scope."}\n\n## Dependencies\n\n${todo.dependencies || "None listed."}\n\n## Risks\n\n${todo.risks || "None listed."}\n\n## Safety And Review Requirements\n\n- Copilot must open a pull request. Do not commit directly to \`main\`.\n- Do not auto-merge. A human must review the PR.\n- Keep changes limited to the files in scope and acceptance criteria above.\n- Do not touch JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture without a human-approved plan.\n`;
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
