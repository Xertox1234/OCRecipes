import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  getTestTx,
} from "../../../test/db-test-utils";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { claimSchedulerRun } = await import("../scheduler-runs");

describe("scheduler-runs storage", () => {
  beforeEach(async () => {
    await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("first claim of a (job, slot) wins, the second loses", async () => {
    expect(await claimSchedulerRun("job-a", "2026-11-01T09")).toBe(true);
    expect(await claimSchedulerRun("job-a", "2026-11-01T09")).toBe(false);
  });

  it("two concurrent claims of the same slot: exactly one wins", async () => {
    const results = await Promise.all([
      claimSchedulerRun("job-b", "2026-11-01T10"),
      claimSchedulerRun("job-b", "2026-11-01T10"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("a different slot or a different job claims independently", async () => {
    expect(await claimSchedulerRun("job-c", "2026-11-01T09")).toBe(true);
    expect(await claimSchedulerRun("job-c", "2026-11-01T10")).toBe(true);
    expect(await claimSchedulerRun("job-d", "2026-11-01T09")).toBe(true);
  });
});
