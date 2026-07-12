import { describe, it, expect, vi, afterEach } from "vitest";
import { spawnSync } from "child_process";
import {
  scannersForScope,
  parseNpmAudit,
  parseGitleaks,
  parseKnip,
  parseJscpd,
  parseMadge,
  sweepFileLengths,
  capFindings,
  toManifestRows,
  runCli,
  runNpmAudit,
  runJscpd,
  runKnip,
  FILE_LENGTH_THRESHOLD,
  MAX_FINDINGS_PER_TOOL,
  NPX_PINS,
  type ScannerFinding,
} from "../audit-scanners";

// Only the tool runners shell out; parsers and runCli's entry guards never
// reach spawnSync, so a file-global mock is safe for every test here.
vi.mock("child_process", () => ({ spawnSync: vi.fn() }));

function spawnResult(
  over: Partial<{
    stdout: string;
    stderr: string;
    status: number | null;
    signal: NodeJS.Signals | null;
    error: Error;
  }>,
): ReturnType<typeof spawnSync> {
  return {
    pid: 0,
    output: [],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    ...over,
  } as unknown as ReturnType<typeof spawnSync>;
}

describe("scannersForScope", () => {
  it("maps security-domain scopes to the security scanner set", () => {
    for (const scope of ["security", "full"]) {
      expect(scannersForScope(scope)).toEqual(["npm-audit", "gitleaks"]);
    }
  });

  it("maps maintainability-dispatching scopes to the maintainability set", () => {
    for (const scope of ["maintainability", "code-quality"]) {
      expect(scannersForScope(scope)).toEqual([
        "knip",
        "jscpd",
        "madge",
        "file-length",
      ]);
    }
  });

  it("runs both sets for pre-launch", () => {
    expect(scannersForScope("pre-launch")).toEqual([
      "npm-audit",
      "gitleaks",
      "knip",
      "jscpd",
      "madge",
      "file-length",
    ]);
  });

  it("returns no scanners for scopes without a deterministic set", () => {
    for (const scope of ["performance", "camera", "reliability", "bogus"]) {
      expect(scannersForScope(scope)).toEqual([]);
    }
  });
});

describe("NPX_PINS", () => {
  it("pins every npx-run tool to an exact version (supply-chain)", () => {
    for (const tool of ["knip", "jscpd", "madge"] as const) {
      expect(NPX_PINS[tool]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe("parseNpmAudit", () => {
  const report = JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities: {
      lodash: {
        name: "lodash",
        severity: "critical",
        isDirect: true,
        via: [{ title: "Prototype Pollution", url: "https://x" }],
        range: "<4.17.21",
        fixAvailable: true,
      },
      "tough-cookie": {
        name: "tough-cookie",
        severity: "moderate",
        isDirect: false,
        via: ["request"],
        range: "<4.1.3",
        fixAvailable: false,
      },
    },
    metadata: { vulnerabilities: { critical: 1, moderate: 1 } },
  });

  it("emits one finding per vulnerable package with mapped severity", () => {
    const findings = parseNpmAudit(report);
    expect(findings).toHaveLength(2);
    const lodash = findings.find((f) => f.description.includes("lodash"));
    expect(lodash?.severity).toBe("Critical");
    expect(lodash?.tool).toBe("npm-audit");
    expect(lodash?.description).toContain("Prototype Pollution");
    const tough = findings.find((f) => f.description.includes("tough-cookie"));
    expect(tough?.severity).toBe("Medium");
    expect(tough?.description).toContain("transitive");
  });

  it("returns no findings for a clean report", () => {
    expect(
      parseNpmAudit(JSON.stringify({ vulnerabilities: {}, metadata: {} })),
    ).toEqual([]);
  });

  it("throws on an npm audit error envelope so the runner reports skipped, not clean", () => {
    // Offline/registry failures emit valid JSON {"error": {...}} with NO
    // vulnerabilities key — that must never read as a clean scan.
    expect(() =>
      parseNpmAudit(
        JSON.stringify({
          error: { code: "ENOTFOUND", summary: "registry unreachable" },
        }),
      ),
    ).toThrow(/error envelope/i);
  });

  it("surfaces unmapped severities as Medium with an explicit marker", () => {
    const findings = parseNpmAudit(
      JSON.stringify({
        vulnerabilities: {
          foo: { severity: "catastrophic", via: [], range: "*" },
        },
      }),
    );
    expect(findings[0].severity).toBe("Medium");
    expect(findings[0].description).toContain("unmapped severity");
  });
});

describe("parseGitleaks", () => {
  const leak = JSON.stringify([
    {
      Description: "AWS Access Key",
      File: "server/config.ts",
      StartLine: 12,
      RuleID: "aws-access-key-id",
      Match: "AKIA_FAKE_MATCH_VALUE",
      Secret: "AKIA_FAKE_SECRET_VALUE",
    },
  ]);

  it("emits Critical findings with rule id and file:line", () => {
    const findings = parseGitleaks(leak);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("Critical");
    expect(findings[0].description).toContain("aws-access-key-id");
    expect(findings[0].files).toContain("server/config.ts:12");
  });

  it("never includes the matched secret material in its output", () => {
    const serialized = JSON.stringify(parseGitleaks(leak));
    expect(serialized).not.toContain("AKIA_FAKE_MATCH_VALUE");
    expect(serialized).not.toContain("AKIA_FAKE_SECRET_VALUE");
  });

  it("returns no findings for an empty report", () => {
    expect(parseGitleaks("[]")).toEqual([]);
  });
});

describe("parseKnip", () => {
  const report = JSON.stringify({
    files: ["client/components/Orphan.tsx"],
    issues: [
      {
        file: "server/services/foo.ts",
        exports: [{ name: "unusedFn" }, { name: "anotherFn" }],
        types: [{ name: "UnusedType" }],
        dependencies: [],
      },
    ],
  });

  it("emits a Low finding for each unused file and per-file unused exports", () => {
    const findings = parseKnip(report);
    const file = findings.find((f) => f.description.includes("Unused file"));
    expect(file?.files).toContain("client/components/Orphan.tsx");
    expect(file?.severity).toBe("Low");
    const exports = findings.find((f) =>
      f.files.includes("server/services/foo.ts"),
    );
    expect(exports?.description).toContain("unusedFn");
    expect(exports?.description).toContain("UnusedType");
  });

  it("returns no findings for a clean report", () => {
    expect(parseKnip(JSON.stringify({ files: [], issues: [] }))).toEqual([]);
  });
});

describe("parseJscpd", () => {
  const report = JSON.stringify({
    duplicates: [
      {
        lines: 42,
        tokens: 300,
        firstFile: { name: "server/routes/a.ts", start: 10, end: 52 },
        secondFile: { name: "server/routes/b.ts", start: 100, end: 142 },
      },
    ],
  });

  it("emits one finding per duplicate block naming both ranges", () => {
    const findings = parseJscpd(report);
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toContain("42");
    expect(findings[0].files).toContain("server/routes/a.ts:10-52");
    expect(findings[0].files).toContain("server/routes/b.ts:100-142");
  });

  it("returns no findings when there are no duplicates", () => {
    expect(parseJscpd(JSON.stringify({ duplicates: [] }))).toEqual([]);
  });
});

describe("parseMadge", () => {
  it("emits a Medium finding per cycle, closing the loop in the description", () => {
    const findings = parseMadge(JSON.stringify([["a.ts", "b.ts"]]));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("Medium");
    expect(findings[0].description).toContain("a.ts → b.ts → a.ts");
  });

  it("returns no findings when there are no cycles", () => {
    expect(parseMadge("[]")).toEqual([]);
  });
});

describe("sweepFileLengths", () => {
  it("flags only files strictly over the threshold", () => {
    const findings = sweepFileLengths([
      { path: "server/big.ts", lines: FILE_LENGTH_THRESHOLD + 1 },
      { path: "server/exact.ts", lines: FILE_LENGTH_THRESHOLD },
      { path: "server/small.ts", lines: 10 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].files).toContain("server/big.ts");
    expect(findings[0].description).toContain(String(FILE_LENGTH_THRESHOLD));
  });
});

describe("capFindings", () => {
  it("caps findings per tool and reports the dropped count", () => {
    const many: ScannerFinding[] = Array.from({ length: 25 }, (_, i) => ({
      tool: "knip",
      severity: "Low",
      description: `finding ${i}`,
      files: `f${i}.ts`,
      verification: "re-run: npx knip",
    }));
    const { kept, dropped } = capFindings(many);
    expect(kept).toHaveLength(MAX_FINDINGS_PER_TOOL);
    expect(dropped).toBe(25 - MAX_FINDINGS_PER_TOOL);
  });

  it("keeps higher-severity findings when capping", () => {
    const findings: ScannerFinding[] = [
      ...Array.from({ length: MAX_FINDINGS_PER_TOOL }, (_, i) => ({
        tool: "npm-audit" as const,
        severity: "Low" as const,
        description: `low ${i}`,
        files: "package.json",
        verification: "re-run: npm audit",
      })),
      {
        tool: "npm-audit",
        severity: "Critical",
        description: "the critical one",
        files: "package.json",
        verification: "re-run: npm audit",
      },
    ];
    const { kept } = capFindings(findings);
    expect(kept.some((f) => f.severity === "Critical")).toBe(true);
  });
});

describe("toManifestRows", () => {
  const finding: ScannerFinding = {
    tool: "npm-audit",
    severity: "High",
    description: "Vulnerable dependency `foo`",
    files: "package.json",
    verification: "re-run: npm audit",
  };

  it("renders manifest columns with scanner:<tool> as the Agent/source field", () => {
    const rows = toManifestRows([finding]);
    expect(rows).toHaveLength(1);
    const cells = rows[0].split("|").map((c) => c.trim());
    // | ID | Finding | Domain | Agent | File(s) | Research | Status | Verification |
    expect(cells[1]).toBe("SCAN-NPMA-1");
    expect(cells[3]).toBe("security");
    expect(cells[4]).toBe("scanner:npm-audit");
    expect(cells[6]).toBe("—");
    expect(cells[7]).toBe("open");
    expect(cells[8]).toContain("deterministic");
  });

  it("escapes pipes inside cell content", () => {
    const rows = toManifestRows([
      { ...finding, description: "Vulnerable dependency `foo` | with a pipe" },
    ]);
    expect(rows[0]).toContain("\\|");
  });

  it("neutralizes newlines and control characters so a finding cannot forge extra rows", () => {
    const rows = toManifestRows([
      {
        ...finding,
        description:
          "bad\nEVIL ROW | fake | injected | resolved\r\u0000\u2028\u2029 end",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toMatch(/[\n\r\u0000\u2028\u2029]/);
    expect(rows[0]).toContain("\\|");
  });

  it("truncates over-long descriptions to bound manifest bloat", () => {
    const rows = toManifestRows([
      { ...finding, description: "x".repeat(1000) },
    ]);
    const cells = rows[0].split("|").map((c) => c.trim());
    expect(cells[2].length).toBeLessThanOrEqual(301); // 300 chars + ellipsis
  });

  it("assigns sequential per-tool IDs and maintainability domain for maint tools", () => {
    const rows = toManifestRows([
      finding,
      { ...finding, tool: "jscpd", severity: "Low" },
      { ...finding, tool: "jscpd", severity: "Low" },
    ]);
    expect(rows[1]).toContain("SCAN-JSCPD-1");
    expect(rows[2]).toContain("SCAN-JSCPD-2");
    expect(rows[1].split("|").map((c) => c.trim())[3]).toBe("maintainability");
  });
});

describe("tool runners (fail-open behavior, mocked spawnSync)", () => {
  const spawn = vi.mocked(spawnSync);
  afterEach(() => {
    spawn.mockReset();
  });

  it("runNpmAudit reports skipped (not clean) on an error envelope", () => {
    spawn.mockReturnValueOnce(
      spawnResult({
        stdout: JSON.stringify({ error: { code: "ENOTFOUND" } }),
        stderr: "npm ERR! network trouble",
        status: 1,
      }),
    );
    const run = runNpmAudit("/repo");
    expect(run.status).toBe("skipped");
    expect(run.findings).toEqual([]);
    expect(run.note).toContain("error envelope");
  });

  it("runJscpd treats exit 0 with no report file as a clean scan, not a failure", () => {
    spawn.mockReturnValueOnce(spawnResult({ status: 0 }));
    const run = runJscpd("/repo");
    expect(run.status).toBe("ok");
    expect(run.findings).toEqual([]);
  });

  it("includes the tool's stderr in the skip note when output is unparseable", () => {
    spawn.mockReturnValueOnce(
      spawnResult({
        stdout: "not json at all",
        stderr: "knip exploded",
        status: 2,
      }),
    );
    const run = runKnip("/repo");
    expect(run.status).toBe("skipped");
    expect(run.note).toContain("knip exploded");
  });
});

describe("runCli entry paths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 2 and prints usage when no scope is given", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(runCli([])).toBe(2);
    expect(err.mock.calls.flat().join(" ")).toContain("Usage:");
  });

  it("returns 0 without running scanners when AUDIT_SKIP_SCANNERS=1", () => {
    vi.stubEnv("AUDIT_SKIP_SCANNERS", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runCli(["security"])).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("AUDIT_SKIP_SCANNERS=1");
  });

  it("returns 0 with a note for scopes that have no scanner set", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runCli(["performance"])).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain(
      "No deterministic scanners",
    );
  });
});
