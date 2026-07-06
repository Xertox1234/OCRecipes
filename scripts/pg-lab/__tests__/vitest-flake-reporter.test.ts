import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TestCase, TestRunEndReason } from "vitest/node";

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

vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(args[0] as string),
}));

// COLUMNS_PER_ROW is the column order emitted by persistTestRuns' INSERT (see
// ../vitest-flake-reporter.ts): ts, commit, test_name, file, duration_ms, retry_count,
// flaky, state. Imported (not redeclared) so this test can't silently drift from the
// module's own constant.
const {
  persistTestRuns,
  FlakeLedgerReporter,
  ROWS_PER_BATCH,
  COLUMNS_PER_ROW,
} = await import("../vitest-flake-reporter");

function fakeTestCase(
  overrides: {
    fullName?: string;
    file?: string;
    duration?: number;
    retryCount?: number;
    flaky?: boolean;
    state?: "passed" | "failed" | "skipped";
  } = {},
): TestCase {
  return {
    fullName: overrides.fullName ?? "some test > does a thing",
    module: { relativeModuleId: overrides.file ?? "some/file.test.ts" },
    diagnostic: () => ({
      slow: false,
      heap: undefined,
      duration: overrides.duration ?? 123,
      startTime: 0,
      retryCount: overrides.retryCount ?? 0,
      repeatCount: 0,
      flaky: overrides.flaky ?? false,
    }),
    result: () => ({ state: overrides.state ?? "passed", errors: undefined }),
    // `vitest/node`'s TestCase/TestModule are classes with #private fields — no plain
    // object can structurally satisfy them, so a double-cast is the only way to build a
    // fake here (no type guard or discriminated union closes that gap).
  } as unknown as TestCase;
}

describe("persistTestRuns", () => {
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

  it("connects (with a bounded connect + query timeout) and issues one buffered INSERT with one row per test", async () => {
    await persistTestRuns([
      {
        testName: "test A",
        file: "a.test.ts",
        durationMs: 10,
        retryCount: 0,
        flaky: false,
        state: "passed",
      },
      {
        testName: "test B",
        file: "b.test.ts",
        durationMs: 20,
        retryCount: 1,
        flaky: true,
        state: "passed",
      },
    ]);

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
    expect(sql).toContain("INSERT INTO dev.test_runs");
    expect(sql).toContain(
      "(ts, commit, test_name, file, duration_ms, retry_count, flaky, state)",
    );
    expect(values).toHaveLength(2 * COLUMNS_PER_ROW);

    const [ts, commit, testName, file, duration, retryCount, flaky, state] =
      values;
    expect(typeof ts).toBe("string");
    expect(commit).toBe("abc1234"); // clean tree — no -dirty suffix
    expect(testName).toBe("test A");
    expect(file).toBe("a.test.ts");
    expect(duration).toBe(10);
    expect(retryCount).toBe(0);
    expect(flaky).toBe(false);
    expect(state).toBe("passed");

    // second row's commit shares the same run timestamp/commit
    expect(values[COLUMNS_PER_ROW]).toBe(ts);
    expect(values[COLUMNS_PER_ROW + 1]).toBe("abc1234");
  });

  it("chunks a run larger than ROWS_PER_BATCH into multiple sequential INSERTs, one connect/end for the whole run", async () => {
    const rows = Array.from({ length: ROWS_PER_BATCH + 1 }, (_, i) => ({
      testName: `test ${i}`,
      file: "many.test.ts",
      durationMs: 1,
      retryCount: 0,
      flaky: false,
      state: "passed" as const,
    }));

    await persistTestRuns(rows);

    // One connection for the whole run regardless of how many INSERTs it takes to flush.
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalledTimes(1);
    // ROWS_PER_BATCH rows in the first batch, the 1 remaining row in a second batch —
    // never a single statement whose parameter count could exceed Postgres's cap.
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [, firstBatchValues] = mockQuery.mock.calls[0] as [string, unknown[]];
    const [, secondBatchValues] = mockQuery.mock.calls[1] as [
      string,
      unknown[],
    ];
    expect(firstBatchValues).toHaveLength(ROWS_PER_BATCH * COLUMNS_PER_ROW);
    expect(secondBatchValues).toHaveLength(1 * COLUMNS_PER_ROW);
    // The row split at the batch boundary: last row of batch 1, first row of batch 2.
    expect(firstBatchValues[(ROWS_PER_BATCH - 1) * COLUMNS_PER_ROW + 2]).toBe(
      `test ${ROWS_PER_BATCH - 1}`,
    );
    expect(secondBatchValues[2]).toBe(`test ${ROWS_PER_BATCH}`);
  });

  it("appends -dirty to the commit when the working tree has uncommitted changes", async () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command.includes("rev-parse")) return "abc1234\n";
      return " M scripts/pg-lab/vitest-flake-reporter.ts\n"; // dirty tree
    });

    await persistTestRuns([
      {
        testName: "t",
        file: "f.test.ts",
        durationMs: 1,
        retryCount: 0,
        flaky: false,
        state: "passed",
      },
    ]);

    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(values[1]).toBe("abc1234-dirty");
  });

  it("falls back to 'unknown' when git itself fails (e.g. not a git repo)", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    await persistTestRuns([
      {
        testName: "t",
        file: "f.test.ts",
        durationMs: 1,
        retryCount: 0,
        flaky: false,
        state: "passed",
      },
    ]);

    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(values[1]).toBe("unknown");
  });

  it("does not connect or query when there are zero rows", async () => {
    await persistTestRuns([]);

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not connect when LAB_DATABASE_URL resolves to a real app database (nutricam)", async () => {
    const prev = process.env.LAB_DATABASE_URL;
    process.env.LAB_DATABASE_URL = "postgresql://localhost/nutricam";
    try {
      await expect(
        persistTestRuns([
          {
            testName: "t",
            file: "f.test.ts",
            durationMs: 1,
            retryCount: 0,
            flaky: false,
            state: "passed",
          },
        ]),
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
      await expect(
        persistTestRuns([
          {
            testName: "t",
            file: "f.test.ts",
            durationMs: 1,
            retryCount: 0,
            flaky: false,
            state: "passed",
          },
        ]),
      ).resolves.toBeUndefined();
      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.LAB_DATABASE_URL;
      else process.env.LAB_DATABASE_URL = prev;
    }
  });

  it("fails silently (no throw) when connect() rejects — DB unreachable", async () => {
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      persistTestRuns([
        {
          testName: "t",
          file: "f.test.ts",
          durationMs: 1,
          retryCount: 0,
          flaky: false,
          state: "passed",
        },
      ]),
    ).resolves.toBeUndefined();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("fails silently (no throw) when the INSERT itself errors — e.g. table missing", async () => {
    mockQuery.mockRejectedValue(
      new Error('relation "dev.test_runs" does not exist'),
    );

    await expect(
      persistTestRuns([
        {
          testName: "t",
          file: "f.test.ts",
          durationMs: 1,
          retryCount: 0,
          flaky: false,
          state: "passed",
        },
      ]),
    ).resolves.toBeUndefined();
    // Connection is still cleaned up even though the query failed.
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it("still ends the client when end() itself rejects", async () => {
    mockEnd.mockRejectedValue(new Error("already closed"));

    await expect(
      persistTestRuns([
        {
          testName: "t",
          file: "f.test.ts",
          durationMs: 1,
          retryCount: 0,
          flaky: false,
          state: "passed",
        },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe("FlakeLedgerReporter", () => {
  const originalCI = process.env.CI;

  beforeEach(() => {
    mockConnect.mockReset();
    mockQuery.mockReset();
    mockEnd.mockReset();
    MockClient.mockClear();
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue(undefined);
    delete process.env.CI;
  });

  afterEach(() => {
    if (originalCI === undefined) delete process.env.CI;
    else process.env.CI = originalCI;
  });

  it("buffers one row per onTestCaseResult call and flushes a single INSERT in onTestRunEnd", async () => {
    const reporter = new FlakeLedgerReporter();
    reporter.onTestCaseResult(
      fakeTestCase({ fullName: "a", retryCount: 1, flaky: true }),
    );
    reporter.onTestCaseResult(fakeTestCase({ fullName: "b" }));

    await reporter.onTestRunEnd([], [], "passed" as TestRunEndReason);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, values] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(values).toHaveLength(2 * COLUMNS_PER_ROW);
    expect(values[2]).toBe("a");
    expect(values[2 + COLUMNS_PER_ROW]).toBe("b");
  });

  it("clears its buffer after flushing, so a second run does not resend old rows", async () => {
    const reporter = new FlakeLedgerReporter();
    reporter.onTestCaseResult(fakeTestCase({ fullName: "a" }));
    await reporter.onTestRunEnd([], [], "passed" as TestRunEndReason);
    mockQuery.mockClear();

    await reporter.onTestRunEnd([], [], "passed" as TestRunEndReason);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not buffer or persist anything when CI is set", async () => {
    process.env.CI = "1";
    const reporter = new FlakeLedgerReporter();
    reporter.onTestCaseResult(fakeTestCase());

    await reporter.onTestRunEnd([], [], "passed" as TestRunEndReason);

    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
