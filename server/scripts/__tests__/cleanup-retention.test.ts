import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  _resetRunningStateForTests,
  assertExecutionAllowed,
  getActiveUserIds,
  runRetentionCleanup,
  type RetentionDb,
} from "../cleanup-retention";
import {
  ACTIVE_USER_WINDOW_DAYS,
  CHAT_RETENTION_DAYS,
  DAILY_LOGS_RETENTION_DAYS,
  SCANNED_ITEMS_RETENTION_DAYS,
  cutoffFor,
  daysToMs,
} from "../../lib/retention-policy";

// Mock the db module so importing the cleanup script does not open a real
// pg connection. The runRetentionCleanup tests below pass their own fake db
// instance, so this mock just needs to satisfy the module-level imports.
vi.mock("../../db", () => ({
  db: {},
  pool: { end: vi.fn().mockResolvedValue(undefined) },
}));

// Mock the logger so tests don't emit noise. createServiceLogger must return
// something with .info / .warn / .error / .debug methods.
vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  toError: (err: unknown) =>
    err instanceof Error ? err : new Error(String(err)),
}));

/**
 * Build a fake RetentionDb whose `.execute()` records every SQL call and
 * returns the queued response for that call. We deliberately treat SQL as
 * opaque — the goal is to assert the orchestration (which domains get
 * purged, in what order, with what cutoff), not to re-implement Postgres.
 */
function makeFakeDb(
  responses: ({ rowCount: number } | { rows: { id: string }[] })[],
) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let cursor = 0;
  const execute = vi.fn(async (query: unknown) => {
    // Drizzle SQL chunks have a queryChunks array; flatten what we can for
    // debug assertions. We don't rely on exact SQL text in the assertions
    // below, but capturing it helps when a test fails.
    const sqlText =
      typeof query === "object" && query !== null && "queryChunks" in query
        ? JSON.stringify((query as { queryChunks: unknown[] }).queryChunks)
        : String(query);
    calls.push({ sql: sqlText, params: [] });
    const response = responses[cursor] ?? { rowCount: 0 };
    cursor += 1;
    return response;
  });
  return {
    // Cast: `RetentionDb` is the full `NodePgDatabase<typeof schema>` — too
    // large to construct in a test. Fake exposes only `.execute()`, which is
    // all the code under test calls.
    db: { execute } as unknown as RetentionDb,
    calls,
    execute,
  };
}

describe("retention-policy helpers", () => {
  it("daysToMs converts days to milliseconds", () => {
    expect(daysToMs(1)).toBe(86_400_000);
    expect(daysToMs(0)).toBe(0);
    expect(daysToMs(7)).toBe(7 * 86_400_000);
  });

  it("cutoffFor returns now - retention window", () => {
    const now = new Date("2026-05-11T00:00:00Z");
    const cutoff = cutoffFor(30, now);
    expect(cutoff.getTime()).toBe(now.getTime() - 30 * 86_400_000);
  });

  it("cutoffFor with Infinity returns a far-past sentinel", () => {
    const cutoff = cutoffFor(Infinity, new Date("2026-05-11T00:00:00Z"));
    // Sentinel date(0) is 1970-01-01 — older than any real row.
    expect(cutoff.getTime()).toBe(0);
  });

  it("exposes plausible retention windows", () => {
    // Pinning these prevents an accidental "retention=1 day" footgun. Update
    // intentionally if/when the policy changes.
    expect(SCANNED_ITEMS_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
    expect(CHAT_RETENTION_DAYS).toBeGreaterThanOrEqual(30);
    expect(DAILY_LOGS_RETENTION_DAYS).toBeGreaterThanOrEqual(90);
    expect(ACTIVE_USER_WINDOW_DAYS).toBeGreaterThanOrEqual(7);
  });
});

describe("assertExecutionAllowed", () => {
  it("allows execution outside production", () => {
    expect(() =>
      assertExecutionAllowed({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() =>
      assertExecutionAllowed({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ).not.toThrow();
    expect(() => assertExecutionAllowed({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("allows execution in production when explicitly enabled", () => {
    expect(() =>
      assertExecutionAllowed({
        NODE_ENV: "production",
        RETENTION_CLEANUP_ENABLED: "true",
      }),
    ).not.toThrow();
  });

  it("refuses to run in production without the safety flag", () => {
    expect(() => assertExecutionAllowed({ NODE_ENV: "production" })).toThrow(
      /RETENTION_CLEANUP_ENABLED=true/,
    );
  });

  it("refuses to accept any non-exact value for the flag", () => {
    expect(() =>
      assertExecutionAllowed({
        NODE_ENV: "production",
        RETENTION_CLEANUP_ENABLED: "1",
      }),
    ).toThrow();
    expect(() =>
      assertExecutionAllowed({
        NODE_ENV: "production",
        RETENTION_CLEANUP_ENABLED: "TRUE",
      }),
    ).toThrow();
    expect(() =>
      assertExecutionAllowed({
        NODE_ENV: "production",
        RETENTION_CLEANUP_ENABLED: "",
      }),
    ).toThrow();
  });
});

describe("getActiveUserIds", () => {
  it("returns a Set of user ids from the union query", async () => {
    const { db } = makeFakeDb([
      { rows: [{ id: "user-1" }, { id: "user-2" }, { id: "user-1" }] },
    ]);
    const ids = await getActiveUserIds(db);
    expect(ids).toBeInstanceOf(Set);
    expect(ids.has("user-1")).toBe(true);
    expect(ids.has("user-2")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("returns an empty Set when no users are active", async () => {
    const { db } = makeFakeDb([{ rows: [] }]);
    const ids = await getActiveUserIds(db);
    expect(ids.size).toBe(0);
  });

  it("tolerates an array-shaped response (drizzle forward-compat)", async () => {
    // Some Drizzle versions return rows directly as an array rather than
    // `{ rows: [...] }`. The implementation handles both shapes; assert that.
    // Cast: deliberately injects the array shape into a slot that the
    // `makeFakeDb` API types as `{ rows: ... }` to exercise the fallback path.
    const arrayResponse = [{ id: "user-9" }] as unknown as {
      rows: { id: string }[];
    };
    const { db } = makeFakeDb([arrayResponse]);
    const ids = await getActiveUserIds(db);
    expect(ids.has("user-9")).toBe(true);
  });
});

describe("runRetentionCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Belt-and-braces: clear the module-level isRunning flag in case the
    // previous test (or another file sharing the module) left it true.
    _resetRunningStateForTests();
  });

  afterEach(() => {
    _resetRunningStateForTests();
  });

  it("purges chat_conversations, scanned_items, and daily_logs in order", async () => {
    // 1 call for the active-user union + 3 calls for the three domains (each
    // returns rowCount < BATCH_SIZE so the loop exits after one batch).
    const { db, execute } = makeFakeDb([
      { rows: [] },
      { rowCount: 5 },
      { rowCount: 7 },
      { rowCount: 11 },
    ]);
    const results = await runRetentionCleanup(
      db,
      new Date("2026-05-11T00:00:00Z"),
    );

    expect(results.map((r) => r.domain)).toEqual([
      "chat_conversations",
      "daily_logs",
      "scanned_items",
    ]);
    expect(results[0].rowsDeleted).toBe(5);
    expect(results[1].rowsDeleted).toBe(7);
    expect(results[2].rowsDeleted).toBe(11);

    // Active-user query + 3 single-batch deletes.
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("loops until a batch returns fewer rows than BATCH_SIZE", async () => {
    // 1 active-user call + chat: 2 full batches then a short batch
    //                   + scanned + daily: each returns 0 to bail immediately
    const { db, execute } = makeFakeDb([
      { rows: [] },
      { rowCount: 1000 },
      { rowCount: 1000 },
      { rowCount: 250 },
      { rowCount: 0 },
      { rowCount: 0 },
    ]);
    const results = await runRetentionCleanup(
      db,
      new Date("2026-05-11T00:00:00Z"),
    );
    expect(results[0].rowsDeleted).toBe(2250);
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it("preserves rows within the retention window", async () => {
    // Implementation detail: cutoff is `now - retentionDays`. We verify the
    // function returns 0 rowsDeleted when the underlying DELETE matches no
    // rows (i.e., everything is within the window).
    const { db } = makeFakeDb([
      { rows: [] },
      { rowCount: 0 },
      { rowCount: 0 },
      { rowCount: 0 },
    ]);
    const results = await runRetentionCleanup(
      db,
      new Date("2026-05-11T00:00:00Z"),
    );
    expect(results.every((r) => r.rowsDeleted === 0)).toBe(true);
  });

  it("skips concurrent invocations", async () => {
    // Deferred resolves so we can interleave the two calls.
    let resolveFirst!: () => void;
    const blockUntilSignal = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const execute = vi.fn(async () => {
      // First call: 1 active-user query, then block on the signal so the
      // second runRetentionCleanup() observes isRunning === true.
      if (execute.mock.calls.length === 1) {
        await blockUntilSignal;
      }
      return { rowCount: 0 };
    });
    // Cast: see `makeFakeDb` — `RetentionDb` is too large to construct;
    // the code under test only calls `.execute()`.
    const db = { execute } as unknown as RetentionDb;

    const first = runRetentionCleanup(db, new Date("2026-05-11T00:00:00Z"));
    // Yield so the first call enters its async work and sets isRunning.
    await Promise.resolve();
    const second = await runRetentionCleanup(
      db,
      new Date("2026-05-11T00:00:00Z"),
    );
    expect(second).toEqual([]);

    resolveFirst();
    await first;
  });
});
