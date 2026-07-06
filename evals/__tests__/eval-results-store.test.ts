import { createHash } from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EvalCaseResult, EvalRunResult } from "../types";

const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();
// A regular function (not an arrow) — `new Client(...)` in the module under test invokes
// this via construction, and arrow functions cannot be used as constructors.
const MockClient = vi.fn().mockImplementation(function () {
  return { connect: mockConnect, query: mockQuery, end: mockEnd };
});

vi.mock("pg", () => ({
  default: { Client: MockClient },
}));

// Hermetic control over getCommitHash/isDirtyWorkingTree — without this, those functions
// would shell out to the real `git` in whatever repo state happens to be ambient when the
// test runs, making the commit/dirty-suffix behavior untestable and non-deterministic.
const mockExecSync = vi.fn((command: string): string => {
  if (command.includes("rev-parse")) return "abc1234\n";
  return ""; // `git status --porcelain`: clean tree by default
});

vi.mock("child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(args[0] as string),
}));

const { persistResults } = await import("../lib/eval-results-store");

function mockCase(overrides: Partial<EvalCaseResult> = {}): EvalCaseResult {
  return {
    testCaseId: "case-1",
    category: "helpfulness",
    description: "",
    inputSummary: "",
    output: "the service's response text",
    assertions: { passed: true, failures: [] },
    rubricScores: [
      { dimension: "safety", score: 8, reasoning: "fine" },
      { dimension: "tone", score: 6, reasoning: "ok" },
    ],
    judgeModel: "claude-sonnet-4-6",
    timestamp: "2026-07-06T00:00:00.000Z",
    latencyMs: 100,
    wordCount: 10,
    ...overrides,
  };
}

function mockRunResult(cases: EvalCaseResult[]): EvalRunResult {
  return {
    runId: "coach-2026-07-06T00-00-00",
    timestamp: "2026-07-06T00:00:00.000Z",
    judgeModel: "claude-sonnet-4-6",
    totalCases: cases.length,
    samplesPerCase: 1,
    assertionPassRate: 1,
    dimensionAverages: {},
    dimensionConfidenceIntervals: {},
    weightedOverall: 7,
    categoryBreakdown: {},
    cases,
    lowestScoringCases: [],
  };
}

// Column order emitted by persistResults' INSERT (see evals/lib/eval-results-store.ts):
// run_id, ts, commit, case_id, service, judge_model, samples, score, pass, notes, output_hash
const COLUMNS_PER_ROW = 11;

describe("persistResults", () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockQuery.mockReset();
    mockEnd.mockReset();
    MockClient.mockClear();
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue(undefined);

    mockExecSync.mockReset();
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes("rev-parse")) return "abc1234\n";
      return ""; // clean tree by default
    });
  });

  it("connects (with a bounded connect + query timeout) and issues one buffered INSERT with one row per case-sample", async () => {
    const runResult = mockRunResult([
      mockCase({ testCaseId: "case-1" }),
      mockCase({ testCaseId: "case-2" }),
    ]);

    await persistResults(runResult, "coach", {});

    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(MockClient).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeoutMillis: expect.any(Number),
        query_timeout: expect.any(Number),
      }),
    );

    const [sql, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO dev.eval_results");
    expect(sql).toContain(
      "(run_id, ts, commit, case_id, service, judge_model, samples, score, pass, notes, output_hash)",
    );
    expect(values).toHaveLength(2 * COLUMNS_PER_ROW);

    const [
      runId,
      ts,
      commit,
      caseId,
      service,
      judgeModel,
      samples,
      score,
      pass,
      notes,
      outputHash,
    ] = values;
    expect(runId).toBe("coach-2026-07-06T00-00-00");
    expect(ts).toBe("2026-07-06T00:00:00.000Z");
    expect(commit).toBe("abc1234"); // clean tree — no -dirty suffix
    expect(caseId).toBe("case-1");
    expect(service).toBe("coach");
    expect(judgeModel).toBe("claude-sonnet-4-6");
    expect(samples).toBe(1);
    expect(score).toBe(7); // (8 + 6) / 2 — no weights supplied, both default to 1
    expect(pass).toBe(true);
    expect(JSON.parse(notes as string)).toEqual({
      rubricScores: [
        { dimension: "safety", score: 8, reasoning: "fine" },
        { dimension: "tone", score: 6, reasoning: "ok" },
      ],
      failures: [],
    });
    expect(outputHash).toBe(
      createHash("sha256").update("the service's response text").digest("hex"),
    );
  });

  it("appends -dirty to the commit when the working tree has uncommitted changes", async () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes("rev-parse")) return "abc1234\n";
      return " M evals/some-file.ts\n"; // dirty tree
    });
    const runResult = mockRunResult([mockCase()]);

    await persistResults(runResult, "coach", {});

    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(values[2]).toBe("abc1234-dirty");
  });

  it("falls back to 'unknown' when git itself fails (e.g. not a git repo)", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });
    const runResult = mockRunResult([mockCase()]);

    await persistResults(runResult, "coach", {});

    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(values[2]).toBe("unknown");
  });

  it("applies dimensionWeights the same way aggregateResults' weightedOverall does", async () => {
    const runResult = mockRunResult([
      mockCase({
        rubricScores: [
          { dimension: "safety", score: 4, reasoning: "unsafe" },
          { dimension: "tone", score: 8, reasoning: "fine" },
        ],
      }),
    ]);

    await persistResults(runResult, "coach", { safety: 2, tone: 1 });

    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    const score = values[7];
    // weighted = (4*2 + 8*1) / (2+1) = 16/3, NOT the unweighted mean of 6.
    expect(score).toBeCloseTo(16 / 3, 5);
    expect(score).not.toBe(6);
  });

  it("strips a multi-sample suffix from case_id so all samples of one case share a trend key", async () => {
    const runResult = mockRunResult([
      mockCase({ testCaseId: "case-2#1" }),
      mockCase({ testCaseId: "case-2#2" }),
    ]);

    await persistResults(runResult, "coach", {});

    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    const firstCaseId = values[3];
    const secondCaseId = values[3 + COLUMNS_PER_ROW];
    expect(firstCaseId).toBe("case-2");
    expect(secondCaseId).toBe("case-2");
  });

  it("stores a null score for a case with no rubric scores (e.g. errored before judging)", async () => {
    const runResult = mockRunResult([
      mockCase({
        testCaseId: "errored-case",
        rubricScores: [],
        assertions: { passed: false, failures: ["threw"] },
      }),
    ]);

    await persistResults(runResult, "coach", {});

    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    const score = values[7];
    const pass = values[8];
    const notes = values[9];
    expect(score).toBeNull();
    expect(pass).toBe(false);
    expect(JSON.parse(notes as string).failures).toEqual(["threw"]);
  });

  it("does not connect or query when the run has zero cases", async () => {
    const runResult = mockRunResult([]);

    await persistResults(runResult, "coach", {});

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not connect when LAB_DATABASE_URL resolves to a real app database (nutricam)", async () => {
    const prev = process.env.LAB_DATABASE_URL;
    process.env.LAB_DATABASE_URL = "postgresql://localhost/nutricam";
    try {
      const runResult = mockRunResult([mockCase()]);
      await expect(
        persistResults(runResult, "coach", {}),
      ).resolves.toBeUndefined();
      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.LAB_DATABASE_URL;
      else process.env.LAB_DATABASE_URL = prev;
    }
  });

  it("does not let a query string smuggle a real app database name past the safety rail", async () => {
    const prev = process.env.LAB_DATABASE_URL;
    process.env.LAB_DATABASE_URL =
      "postgresql://localhost/nutricam?sslmode=require";
    try {
      const runResult = mockRunResult([mockCase()]);
      await expect(
        persistResults(runResult, "coach", {}),
      ).resolves.toBeUndefined();
      expect(mockConnect).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.LAB_DATABASE_URL;
      else process.env.LAB_DATABASE_URL = prev;
    }
  });

  it("fails silently (no throw) when connect() rejects — DB unreachable", async () => {
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));
    const runResult = mockRunResult([mockCase()]);

    await expect(
      persistResults(runResult, "coach", {}),
    ).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("fails silently (no throw) when the INSERT itself errors — e.g. table missing", async () => {
    mockQuery.mockRejectedValue(
      new Error('relation "dev.eval_results" does not exist'),
    );
    const runResult = mockRunResult([mockCase()]);

    await expect(
      persistResults(runResult, "coach", {}),
    ).resolves.toBeUndefined();
    // Connection is still cleaned up even though the query failed.
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("still ends the client when end() itself rejects", async () => {
    mockEnd.mockRejectedValue(new Error("already closed"));
    const runResult = mockRunResult([mockCase()]);

    await expect(
      persistResults(runResult, "coach", {}),
    ).resolves.toBeUndefined();
  });
});
