#!/usr/bin/env tsx
// Deterministic audit scanners — zero-hallucination ground truth for /audit.
//
// Runs cheap, deterministic tools for an audit scope and prints manifest-ready
// finding rows (same columns as docs/audits/TEMPLATE.md findings tables) so the
// LLM discovery passes spend their effort on judgment, not detection.
//
//   npx tsx scripts/audit-scanners.ts <scope>
//
// Scope → scanner routing (documented in .claude/skills/audit/SKILL.md →
// "Deterministic Scanners"):
//   security set        (`npm audit`, `gitleaks`)                → security, full, pre-launch
//   maintainability set (`knip`, `jscpd`, `madge`, file-length)  → maintainability, code-quality, pre-launch
//
// Behavior contract:
//   - Fail-open: a missing/failed/timed-out tool is reported as "skipped" and
//     never blocks the audit (exit 0; the audit degrades to LLM-only discovery).
//   - Advisory-fast: each tool is capped at AUDIT_SCANNER_TIMEOUT_MS
//     (default 120s); findings are capped at MAX_FINDINGS_PER_TOOL per tool.
//   - Skip switch: AUDIT_SKIP_SCANNERS=1 skips everything (offline / speed).
//   - Each row's Agent column carries `scanner:<tool>` — the deterministic
//     evidence source; re-running the tool is the per-fix verification.

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type ScannerName =
  | "npm-audit"
  | "gitleaks"
  | "knip"
  | "jscpd"
  | "madge"
  | "file-length";

export type Severity = "Critical" | "High" | "Medium" | "Low";

export interface ScannerFinding {
  tool: ScannerName;
  severity: Severity;
  description: string;
  files: string;
  /** Re-run command; rendered as "deterministic — <verification>" in the manifest row. */
  verification: string;
}

export const MAX_FINDINGS_PER_TOOL = 20;
export const FILE_LENGTH_THRESHOLD = 600;
const MAX_DESCRIPTION_CHARS = 300;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_BUFFER = 64 * 1024 * 1024;

// Exact npx version pins (supply-chain): `npx --yes <tool>` with no pin
// executes whatever the registry serves as latest at audit time. Registry
// versions are immutable, so an exact pin freezes the executed artifact.
// Bump deliberately, never implicitly.
export const NPX_PINS = {
  knip: "6.26.0",
  jscpd: "5.0.12",
  madge: "8.0.0",
} as const;

const SECURITY_SET: readonly ScannerName[] = ["npm-audit", "gitleaks"];
const MAINTAINABILITY_SET: readonly ScannerName[] = [
  "knip",
  "jscpd",
  "madge",
  "file-length",
];

// Scopes whose Phase 2 dispatch includes the security domain run the security
// set; scopes that include the maintainability dispatch run the maintainability
// set (pre-launch includes both). See SKILL.md scope definitions.
export function scannersForScope(scope: string): ScannerName[] {
  const out: ScannerName[] = [];
  if (["security", "full", "pre-launch"].includes(scope)) {
    out.push(...SECURITY_SET);
  }
  if (["maintainability", "code-quality", "pre-launch"].includes(scope)) {
    out.push(...MAINTAINABILITY_SET);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsers (pure — unit-tested in scripts/__tests__/audit-scanners.test.ts)
// ---------------------------------------------------------------------------

interface NpmAuditVia {
  title?: string;
}

interface NpmAuditVulnerability {
  name?: string;
  severity?: string;
  isDirect?: boolean;
  via?: (NpmAuditVia | string)[];
  range?: string;
}

const NPM_SEVERITY: Record<string, Severity> = {
  critical: "Critical",
  high: "High",
  moderate: "Medium",
  low: "Low",
  info: "Low",
};

export function parseNpmAudit(stdout: string): ScannerFinding[] {
  const report = JSON.parse(stdout) as {
    vulnerabilities?: Record<string, NpmAuditVulnerability>;
    error?: unknown;
  };
  if (report.error !== undefined || report.vulnerabilities === undefined) {
    // Offline/registry failures emit valid JSON {"error": {...}} with no
    // vulnerabilities key — surfacing that as [] would fake a clean scan.
    throw new Error(
      "npm audit returned an error envelope (offline/registry failure?) — no vulnerability data",
    );
  }
  return Object.entries(report.vulnerabilities).map(([pkg, v]) => {
    const titles = (v.via ?? [])
      .filter((entry): entry is NpmAuditVia => typeof entry === "object")
      .map((entry) => entry.title)
      .filter((t): t is string => typeof t === "string");
    const cause =
      titles.length > 0
        ? titles.join("; ")
        : `transitive via ${(v.via ?? []).filter((e): e is string => typeof e === "string").join(", ") || "unknown"}`;
    const mapped = NPM_SEVERITY[v.severity ?? ""];
    const severityNote = mapped
      ? ""
      : ` [unmapped severity '${v.severity ?? "unknown"}']`;
    return {
      tool: "npm-audit" as const,
      severity: mapped ?? "Medium",
      description: `Vulnerable dependency \`${pkg}\` (${v.range ?? "unknown range"}) — ${cause} [${v.isDirect ? "direct" : "transitive"}]${severityNote}`,
      files: "package.json / package-lock.json",
      verification: "re-run: npm audit --json",
    };
  });
}

interface GitleaksLeak {
  Description?: string;
  File?: string;
  StartLine?: number;
  RuleID?: string;
  // Match / Secret fields exist in the report but are deliberately never read —
  // secret material must not propagate into the manifest.
}

export function parseGitleaks(reportJson: string): ScannerFinding[] {
  const leaks = JSON.parse(reportJson) as GitleaksLeak[];
  return leaks.map((leak) => ({
    tool: "gitleaks" as const,
    severity: "Critical" as const,
    description: `Potential secret (rule: ${leak.RuleID ?? "unknown"}) — ${leak.Description ?? "no description"} [value redacted]`,
    files: `${leak.File ?? "unknown"}:${leak.StartLine ?? 0}`,
    verification: "re-run: gitleaks detect --redact",
  }));
}

interface KnipExport {
  name?: string;
}

interface KnipIssue {
  file?: string;
  exports?: (KnipExport | string)[];
  types?: (KnipExport | string)[];
}

function knipNames(entries: (KnipExport | string)[] | undefined): string[] {
  return (entries ?? [])
    .map((e) => (typeof e === "string" ? e : e.name))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

export function parseKnip(stdout: string): ScannerFinding[] {
  const report = JSON.parse(stdout) as {
    files?: string[];
    issues?: KnipIssue[];
  };
  const findings: ScannerFinding[] = [];
  for (const file of report.files ?? []) {
    findings.push({
      tool: "knip",
      severity: "Low",
      description: "Unused file (nothing imports it, per knip)",
      files: file,
      verification: `re-run: npx knip@${NPX_PINS.knip} --reporter json`,
    });
  }
  for (const issue of report.issues ?? []) {
    const names = [...knipNames(issue.exports), ...knipNames(issue.types)];
    if (names.length === 0 || !issue.file) continue;
    const listed = names.slice(0, 5).join(", ");
    const more = names.length > 5 ? `, +${names.length - 5} more` : "";
    findings.push({
      tool: "knip",
      severity: "Low",
      description: `${names.length} unused export(s)/type(s): ${listed}${more}`,
      files: issue.file,
      verification: `re-run: npx knip@${NPX_PINS.knip} --reporter json`,
    });
  }
  return findings;
}

interface JscpdFileRef {
  name?: string;
  start?: number;
  end?: number;
}

interface JscpdDuplicate {
  lines?: number;
  tokens?: number;
  firstFile?: JscpdFileRef;
  secondFile?: JscpdFileRef;
}

function jscpdRange(ref: JscpdFileRef | undefined): string {
  return `${ref?.name ?? "unknown"}:${ref?.start ?? 0}-${ref?.end ?? 0}`;
}

export function parseJscpd(reportJson: string): ScannerFinding[] {
  const report = JSON.parse(reportJson) as { duplicates?: JscpdDuplicate[] };
  return (report.duplicates ?? []).map((dup) => ({
    tool: "jscpd" as const,
    severity: "Low" as const,
    description: `Duplicated block (${dup.lines ?? 0} lines, ${dup.tokens ?? 0} tokens)`,
    files: `${jscpdRange(dup.firstFile)} ↔ ${jscpdRange(dup.secondFile)}`,
    verification: `re-run: npx jscpd@${NPX_PINS.jscpd} client server shared --min-tokens 100 --silent --reporters json`,
  }));
}

export function parseMadge(stdout: string): ScannerFinding[] {
  const cycles = JSON.parse(stdout) as string[][];
  return cycles.map((cycle) => ({
    tool: "madge" as const,
    severity: "Medium" as const,
    description: `Circular dependency: ${[...cycle, cycle[0]].join(" → ")}`,
    files: cycle.join(", "),
    verification: `re-run: npx madge@${NPX_PINS.madge} --circular --extensions ts,tsx --ts-config tsconfig.json --json client server shared`,
  }));
}

export function sweepFileLengths(
  entries: { path: string; lines: number }[],
  threshold: number = FILE_LENGTH_THRESHOLD,
): ScannerFinding[] {
  return entries
    .filter((e) => e.lines > threshold)
    .map((e) => ({
      tool: "file-length" as const,
      severity: "Low" as const,
      description: `File exceeds ${threshold} lines (${e.lines})`,
      files: e.path,
      verification:
        "re-run: npx tsx scripts/audit-scanners.ts <scope> (file-length sweep)",
    }));
}

const SEVERITY_RANK: Record<Severity, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

export function capFindings(
  findings: ScannerFinding[],
  max: number = MAX_FINDINGS_PER_TOOL,
): { kept: ScannerFinding[]; dropped: number } {
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  return {
    kept: sorted.slice(0, max),
    dropped: Math.max(0, sorted.length - max),
  };
}

// ---------------------------------------------------------------------------
// Manifest rendering
// ---------------------------------------------------------------------------

const TOOL_CODE: Record<ScannerName, string> = {
  "npm-audit": "NPMA",
  gitleaks: "GITL",
  knip: "KNIP",
  jscpd: "JSCPD",
  madge: "MADGE",
  "file-length": "FLEN",
};

const TOOL_DOMAIN: Record<ScannerName, string> = {
  "npm-audit": "security",
  gitleaks: "security",
  knip: "maintainability",
  jscpd: "maintainability",
  madge: "maintainability",
  "file-length": "maintainability",
};

// Cells carry third-party text (advisory titles, tool descriptions). Strip
// control characters and line separators so a crafted value cannot terminate
// the table row and forge extra manifest rows, then escape pipes.
function esc(cell: string): string {
  return cell
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\|/g, "\\|");
}

function truncate(cell: string, max: number): string {
  return cell.length > max ? `${cell.slice(0, max)}…` : cell;
}

export const MANIFEST_HEADER =
  "| ID  | Finding | Domain | Agent | File(s) | Research | Status | Verification |\n" +
  "| --- | ------- | ------ | ----- | ------- | -------- | ------ | ------------ |";

/**
 * Renders findings as manifest table rows (docs/audits/TEMPLATE.md columns).
 * IDs are sequential per tool in input order; the Agent column carries
 * `scanner:<tool>` — the finding's deterministic evidence source.
 */
export function toManifestRows(findings: ScannerFinding[]): string[] {
  const counters = new Map<ScannerName, number>();
  return findings.map((f) => {
    const n = (counters.get(f.tool) ?? 0) + 1;
    counters.set(f.tool, n);
    const id = `SCAN-${TOOL_CODE[f.tool]}-${n}`;
    return [
      "",
      id,
      truncate(esc(f.description), MAX_DESCRIPTION_CHARS),
      TOOL_DOMAIN[f.tool],
      `scanner:${f.tool}`,
      esc(f.files),
      "—",
      "open",
      `deterministic — ${esc(f.verification)}`,
      "",
    ]
      .join(" | ")
      .trim();
  });
}

// ---------------------------------------------------------------------------
// Tool runners (side-effectful; every failure path is fail-open)
// ---------------------------------------------------------------------------

interface ToolRun {
  tool: ScannerName;
  status: "ok" | "skipped";
  note: string;
  findings: ScannerFinding[];
  dropped: number;
}

function timeoutMs(): number {
  const raw = Number(process.env.AUDIT_SCANNER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  status: number | null;
  errorMessage?: string;
}

function exec(cmd: string, args: string[], cwd?: string): ExecResult {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: timeoutMs(),
    maxBuffer: MAX_BUFFER,
    cwd,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
    errorMessage: result.error
      ? result.error.message
      : result.signal
        ? `killed by ${result.signal} (timeout?)`
        : undefined,
  };
}

// Scanners must run against the repository root, not whatever cwd the CLI was
// invoked from — a wrong-cwd run would produce confidently-wrong "ground
// truth" (wrong lockfile, wrong git history) instead of a skip.
function repoRoot(): string | null {
  const res = exec("git", ["rev-parse", "--show-toplevel"]);
  if (res.errorMessage || res.status !== 0) return null;
  const root = res.stdout.trim();
  return root.length > 0 ? root : null;
}

function noteWithStderr(base: string, res: ExecResult): string {
  const err = res.stderr.trim();
  return err ? `${base} — stderr: ${err.slice(0, 160)}` : base;
}

function skipped(tool: ScannerName, note: string): ToolRun {
  return { tool, status: "skipped", note, findings: [], dropped: 0 };
}

function ok(tool: ScannerName, findings: ScannerFinding[]): ToolRun {
  const { kept, dropped } = capFindings(findings);
  return {
    tool,
    status: "ok",
    note:
      dropped > 0
        ? `showing ${kept.length} of ${findings.length} — re-run the tool for the full list`
        : "",
    findings: kept,
    dropped,
  };
}

// Exported for runner-level fail-open tests (spawnSync mocked).
export function runNpmAudit(root: string): ToolRun {
  // npm audit exits non-zero when vulnerabilities exist — parse stdout regardless.
  const res = exec("npm", ["audit", "--json"], root);
  if (res.errorMessage) return skipped("npm-audit", res.errorMessage);
  try {
    return ok("npm-audit", parseNpmAudit(res.stdout));
  } catch (e) {
    return skipped(
      "npm-audit",
      noteWithStderr(e instanceof Error ? e.message : String(e), res),
    );
  }
}

function runGitleaks(root: string): ToolRun {
  const probe = exec("gitleaks", ["version"]);
  if (probe.errorMessage || probe.status !== 0) {
    return skipped(
      "gitleaks",
      "gitleaks not installed (brew install gitleaks) — no npx equivalent",
    );
  }
  const reportPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-")),
    "report.json",
  );
  try {
    // --redact keeps secret values out of the report; exit 1 = leaks found.
    const res = exec(
      "gitleaks",
      [
        "detect",
        "--no-banner",
        "--redact",
        "--report-format",
        "json",
        "--report-path",
        reportPath,
        "--exit-code",
        "1",
      ],
      root,
    );
    if (res.errorMessage) return skipped("gitleaks", res.errorMessage);
    if (res.status !== 0 && res.status !== 1) {
      return skipped(
        "gitleaks",
        noteWithStderr(`gitleaks exited ${res.status}`, res),
      );
    }
    return ok("gitleaks", parseGitleaks(fs.readFileSync(reportPath, "utf8")));
  } catch (e) {
    return skipped("gitleaks", e instanceof Error ? e.message : String(e));
  } finally {
    fs.rmSync(path.dirname(reportPath), { recursive: true, force: true });
  }
}

export function runKnip(root: string): ToolRun {
  // knip exits 1 when it finds issues — parse stdout regardless.
  const res = exec(
    "npx",
    ["--yes", `knip@${NPX_PINS.knip}`, "--reporter", "json"],
    root,
  );
  if (res.errorMessage) return skipped("knip", res.errorMessage);
  try {
    return ok("knip", parseKnip(res.stdout));
  } catch {
    return skipped("knip", noteWithStderr("unparseable knip output", res));
  }
}

export function runJscpd(root: string): ToolRun {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jscpd-"));
  try {
    // Conservative --min-tokens 100 (default 50 is too noisy at this codebase size).
    const res = exec(
      "npx",
      [
        "--yes",
        `jscpd@${NPX_PINS.jscpd}`,
        "client",
        "server",
        "shared",
        "--min-tokens",
        "100",
        "--silent",
        "--reporters",
        "json",
        "--output",
        outDir,
      ],
      root,
    );
    if (res.errorMessage) return skipped("jscpd", res.errorMessage);
    const reportPath = path.join(outDir, "jscpd-report.json");
    if (!fs.existsSync(reportPath)) {
      // Some jscpd versions write no report when zero duplicates are found —
      // a clean exit without a report is a clean scan, not a failure.
      if (res.status === 0) return ok("jscpd", []);
      return skipped(
        "jscpd",
        noteWithStderr(`jscpd exited ${res.status} without a report`, res),
      );
    }
    return ok("jscpd", parseJscpd(fs.readFileSync(reportPath, "utf8")));
  } catch (e) {
    return skipped("jscpd", e instanceof Error ? e.message : String(e));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function runMadge(root: string): ToolRun {
  // madge exits 1 when cycles exist — parse stdout regardless.
  const res = exec(
    "npx",
    [
      "--yes",
      `madge@${NPX_PINS.madge}`,
      "--circular",
      "--extensions",
      "ts,tsx",
      "--ts-config",
      "tsconfig.json",
      "--json",
      "client",
      "server",
      "shared",
    ],
    root,
  );
  if (res.errorMessage) return skipped("madge", res.errorMessage);
  try {
    return ok("madge", parseMadge(res.stdout));
  } catch {
    return skipped("madge", noteWithStderr("unparseable madge output", res));
  }
}

function runFileLength(root: string): ToolRun {
  const res = exec(
    "git",
    ["ls-files", "--", "client", "server", "shared"],
    root,
  );
  if (res.errorMessage || res.status !== 0) {
    return skipped(
      "file-length",
      res.errorMessage ?? noteWithStderr("git ls-files failed", res),
    );
  }
  const entries: { path: string; lines: number }[] = [];
  for (const file of res.stdout.split("\n")) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if (/\.test\.(ts|tsx)$/.test(file) || file.includes("__tests__/")) continue;
    try {
      const content = fs.readFileSync(path.join(root, file), "utf8");
      entries.push({ path: file, lines: content.match(/\n/g)?.length ?? 0 });
    } catch {
      // File listed but unreadable (deleted mid-run) — skip it, fail-open.
    }
  }
  return ok("file-length", sweepFileLengths(entries));
}

const RUNNERS: Record<ScannerName, (root: string) => ToolRun> = {
  "npm-audit": runNpmAudit,
  gitleaks: runGitleaks,
  knip: runKnip,
  jscpd: runJscpd,
  madge: runMadge,
  "file-length": runFileLength,
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function runCli(argv: string[]): number {
  const scope = argv[0];
  if (!scope || scope.startsWith("-")) {
    console.error("Usage: npx tsx scripts/audit-scanners.ts <scope>");
    return 2;
  }
  if (process.env.AUDIT_SKIP_SCANNERS === "1") {
    console.log(
      `Deterministic scanners skipped (AUDIT_SKIP_SCANNERS=1) — LLM-only discovery for scope '${scope}'.`,
    );
    return 0;
  }
  const scanners = scannersForScope(scope);
  if (scanners.length === 0) {
    console.log(
      `No deterministic scanners for scope '${scope}' — LLM-only discovery.`,
    );
    return 0;
  }

  const root = repoRoot();
  if (!root) {
    console.log(
      "All scanners skipped — could not resolve the repository root (not inside a git repo?). LLM-only discovery.",
    );
    return 0;
  }

  const runs: ToolRun[] = [];
  for (const scanner of scanners) {
    try {
      runs.push(RUNNERS[scanner](root));
    } catch (e) {
      // Last-resort fail-open: a scanner crash never blocks the audit.
      runs.push(skipped(scanner, e instanceof Error ? e.message : String(e)));
    }
  }

  console.log(`## Deterministic scanner findings — scope: ${scope}\n`);
  console.log("Summary:");
  for (const run of runs) {
    if (run.status === "skipped") {
      console.log(`- ${run.tool}: skipped — ${run.note} (fail-open)`);
    } else {
      const capNote = run.note ? ` (${run.note})` : "";
      console.log(`- ${run.tool}: ${run.findings.length} finding(s)${capNote}`);
    }
  }

  const all = runs.flatMap((r) => r.findings);
  if (all.length === 0) {
    console.log("\nNo scanner findings — proceed to LLM discovery.");
    return 0;
  }

  // Severity-major order so rows paste directly into the manifest's
  // per-severity findings tables; IDs stay sequential per tool.
  const ordered = [...all].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const rows = toManifestRows(ordered);
  let currentSeverity: Severity | null = null;
  const lines: string[] = [];
  ordered.forEach((finding, i) => {
    if (finding.severity !== currentSeverity) {
      currentSeverity = finding.severity;
      lines.push(`\n### ${currentSeverity}\n`, MANIFEST_HEADER);
    }
    lines.push(rows[i]);
  });
  console.log(lines.join("\n"));
  console.log(
    "\nCopy these rows into the audit manifest (status `open`) before launching Phase 2 reviewer agents.",
  );
  return 0;
}

if (process.argv[1]?.endsWith("audit-scanners.ts")) {
  process.exitCode = runCli(process.argv.slice(2));
}
