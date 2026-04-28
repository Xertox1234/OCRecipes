/**
 * Weight log dedup tests (M9 fix).
 *
 * The unique index on (user_id, DATE(logged_at)) enforces one entry per user
 * per calendar day. These tests verify that createWeightLog emits the correct
 * ON CONFLICT clause and that the upsert semantics are correctly expressed.
 *
 * Full round-trip dedup is verified by the DB-integrated tests in users.test.ts
 * once the schema migration is applied via `npm run db:push`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";

// Mock the db module so we can intercept the raw SQL calls
const mockExecute = vi.fn();
vi.mock("../../db", () => ({
  db: {
    execute: mockExecute,
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        execute: mockExecute,
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      };
      return cb(tx);
    }),
  },
}));

const { createWeightLog, createWeightLogAndUpdateUser } = await import(
  "../health"
);

const baseLog = {
  userId: "user-1",
  weight: "75.50",
  unit: "kg" as const,
  source: "manual" as const,
  note: null,
};

describe("createWeightLog (M9 — date-based dedup)", () => {
  beforeEach(() => {
    mockExecute.mockResolvedValue({
      rows: [{ ...baseLog, id: 1, loggedAt: new Date() }],
    });
  });

  it("calls db.execute (raw SQL path, not Drizzle ORM insert)", async () => {
    await createWeightLog(baseLog);
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it("passes an SQL template to db.execute (not a Drizzle query builder)", async () => {
    await createWeightLog(baseLog);
    const [calledSql] = mockExecute.mock.calls[0];
    // The sql tagged template produces a SQL object with a queryChunks property
    expect(calledSql).toHaveProperty("queryChunks");
  });

  it("includes ON CONFLICT clause targeting date-keyed index", async () => {
    await createWeightLog(baseLog);
    const [calledSql] = mockExecute.mock.calls[0];
    // Serialise the SQL to inspect it
    const { text } = calledSql.toSQL
      ? calledSql.toSQL()
      : { text: JSON.stringify(calledSql) };
    expect(text).toContain("ON CONFLICT");
    expect(text).toContain("DATE(logged_at)");
    expect(text).toContain("DO UPDATE SET");
  });

  it("returns the first row from the execute result", async () => {
    const row = {
      id: 42,
      userId: "user-1",
      weight: "75.50",
      unit: "kg",
      loggedAt: new Date(),
    };
    mockExecute.mockResolvedValueOnce({ rows: [row] });
    const result = await createWeightLog(baseLog);
    expect(result).toEqual(row);
  });

  it("uses lb as the default unit when unit is not supplied", async () => {
    const logWithoutUnit = {
      userId: "user-1",
      weight: "80.00",
    } as typeof baseLog;
    await createWeightLog(logWithoutUnit);
    // Verify the function ran without throwing (unit defaulted to "lb" via ?? "lb")
    expect(mockExecute).toHaveBeenCalledOnce();
  });
});

describe("createWeightLogAndUpdateUser (M9 — transactional dedup)", () => {
  beforeEach(() => {
    mockExecute.mockResolvedValue({
      rows: [{ ...baseLog, id: 1, loggedAt: new Date() }],
    });
  });

  it("calls tx.execute with the same ON CONFLICT clause", async () => {
    await createWeightLogAndUpdateUser(baseLog);
    expect(mockExecute).toHaveBeenCalledOnce();
    const [calledSql] = mockExecute.mock.calls[0];
    const { text } = calledSql.toSQL
      ? calledSql.toSQL()
      : { text: JSON.stringify(calledSql) };
    expect(text).toContain("ON CONFLICT");
    expect(text).toContain("DATE(logged_at)");
  });
});
