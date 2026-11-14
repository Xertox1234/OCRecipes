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
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { coachWeeklyReports, coachWeeklyReportSettings } from "@shared/schema";
import {
  createMockWeeklyFacts,
  createMockWeeklyReportContent,
} from "../../__tests__/factories";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getUserDataExport } = await import("../export");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

describe("data export — coach weekly reports", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("includes the user's reports and report settings, not other users'", async () => {
    const other = await createTestUser(tx);
    const row = (userId: string) => ({
      userId,
      weekStart: "2026-11-01",
      weekEnd: "2026-11-07",
      facts: createMockWeeklyFacts({ daysActive: 3 }),
      content: createMockWeeklyReportContent({ headline: "Mine" }),
      source: "template" as const,
    });
    await tx.insert(coachWeeklyReports).values([row(user.id), row(other.id)]);
    await tx
      .insert(coachWeeklyReportSettings)
      .values({ userId: user.id, pushEnabled: false });

    const exp = await getUserDataExport(user.id);
    expect(exp.weeklyReports.reports).toHaveLength(1);
    expect(exp.weeklyReports.reports[0]).toMatchObject({
      weekStart: "2026-11-01",
      content: { headline: "Mine" },
    });
    expect(exp.weeklyReports.settings).toMatchObject({ pushEnabled: false });
  });

  it("settings is null when the user never changed them", async () => {
    const exp = await getUserDataExport(user.id);
    expect(exp.weeklyReports).toEqual({ reports: [], settings: null });
  });
});
